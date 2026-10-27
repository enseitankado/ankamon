# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
# Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
# https://github.com/enseitankado/ankamon
#
# Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
# GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
# daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
# değiştirebilirsiniz.
#
# Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
# YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
# verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
#
# Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
# dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
# adresine bakınız.
#
# Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
# parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
# lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
# korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
# kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).

"""Dosya yöneticisi köprüsü: http://127.0.0.1:8894 (nginx /filemanager-mount ile vekiller).

POST /mount/<tahta id>  → tahtayı /run/ankamon/filemanager/<takma ad>/ altına sshfs ile bağlar
                          (zaten bağlıysa anında döner), {"ok": true, "path": "<takma ad>/"} döner.
                          Dizin adı FileBrowser'da tahtanın adı olarak görünür (ör. "A Blok - Lab 1");
                          aynı adlı iki tahta bağlıysa ikincisine " (<ip>)" eklenir.

Tek FileBrowser Quantum örneği (filemanager.sh) /run/ankamon/filemanager/ kökünü sürekli sunar;
bağlama/ayırma burada, FileBrowser'dan bağımsız olur — yeni bir alt dizin belirince FileBrowser
onu bir sonraki dizin listelemesinde görür (dizin listesi canlı okunur, önceden indekslenmiş
önbelleğe dayanmaz). Yetki nginx auth_request'te (oturum + "filemanager") denetlenir; köprü yalnız
127.0.0.1'i dinler. Boşta kalan bağlar IDLE_MINUTES sonra kendiliğinden ayrılır (bkz. _sweep).
"""

from __future__ import annotations

import asyncio
import logging
import os
import posixpath
import re
import subprocess
import time

import tornado.web

from .. import activity, db
from ..executor.jobs import _board_access
from . import writes
from .ownership import Fixer

log = logging.getLogger("ankamon.filemanager")

PORT = int(os.environ.get("FILEMANAGER_PORT", "8894"))
ROOT = "/run/ankamon/filemanager"
IDLE_MINUTES = int(os.environ.get("FILEMANAGER_IDLE_MINUTES", "15"))

# allow_other gerekmez: bağlayan (bu süreç) ve okuyan (FileBrowser Quantum) ikisi de root.
_SSHFS_OPTS = (
    "password_stdin,StrictHostKeyChecking=no,UserKnownHostsFile=/dev/null,LogLevel=ERROR,"
    "reconnect,ServerAliveInterval=15,ServerAliveCountMax=3,"
    # Sembolik bağlar tahtada çözülür ve hedefleri gibi görünür. sshfs 3.7.6'nın varsayılanı
    # (contain_symlinks) mutlak ya da ".." içeren bağları EPERM ile reddediyor; ör. ETAP'ın her ev
    # dizinindeki "ortak-alan" (/ortak-alan'a bağ) okunamayan bir dosya gibi görünüyor, kopyalama
    # "could not resolve source path" ile düşüyordu. no_contain_symlinks KULLANILMAZ: bağ bu makinede
    # çözülürdü ve "../../.." ile başlayan bir bağ konteynerin kendi dosya sistemini açardı.
    "follow_symlinks"
)

# board_id -> son erişim (time.monotonic) / bağlama noktası. Yalnız bu süreçte tutulur; süreç yeniden
# başlarsa önceki bağlar açılışta temizlenir (bkz. _cleanup_stale).
_last_used: dict[int, float] = {}
_mount_paths: dict[int, str] = {}
_mount_lock = asyncio.Lock()

# Dizin adında sorun çıkaracak karakterler (yol ayırıcı, URL'de özel anlamlı olanlar, denetim karakterleri).
_UNSAFE = re.compile(r'[\x00-\x1f\x7f/\\?#%*:|"<>]+')


def _mount_point(board_id: int, name: str, ip: str) -> str:
    """Tahtanın takma adından dizin adı üretir; başka bir bağlı tahtayla çakışırsa IP'yi ekler."""
    base = " ".join(_UNSAFE.sub("-", name).split()).strip(" .")[:100] or ip
    taken = {p for b, p in _mount_paths.items() if b != board_id}
    path = os.path.join(ROOT, base)
    if path in taken:
        path = os.path.join(ROOT, f"{base} ({ip})")
    return path


def _is_mounted(path: str) -> bool:
    # /proc/mounts boşluk, sekme, \ ve satır sonunu sekizlik kaçışla yazar (ör. "B\040Blok").
    unescape = lambda s: re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), s)
    with open("/proc/mounts", encoding="utf-8") as f:
        return any(unescape(line.split(" ")[1]) == path for line in f)


def _rmdir_quiet(path: str) -> None:
    try:
        os.rmdir(path)
    except OSError:
        pass


def _lookup(board_id: int):
    with db.connect() as conn:
        board = conn.execute(
            "SELECT host(ip) AS ip, coalesce(nullif(label, ''), hostname, host(ip)) AS name FROM boards WHERE id = %s",
            (board_id,),
        ).fetchone()
        if not board or not board["ip"]:
            return None
        ssh_user, password = _board_access(conn)
        return board, ssh_user, password


async def _mount(board_id: int, username: str) -> tuple[bool, str]:
    """İdempotent: zaten bağlıysa hemen döner. Döner: (başarılı mı, hata ya da bağlama noktası)."""
    async with _mount_lock:
        looked_up = await asyncio.to_thread(_lookup, board_id)
        if looked_up is None:
            return False, "Tahta bulunamadı ya da IP'si yok."
        board, ssh_user, password = looked_up

        old = _mount_paths.get(board_id)
        if old and old == _mount_point(board_id, board["name"], board["ip"]) and _is_mounted(old):
            _last_used[board_id] = time.monotonic()
            return True, old
        if old:
            # Takma ad bağlıyken değişmiş (ya da bağ kopmuş): eski dizini ayırıp yeni adla bağla.
            await _unmount(board_id)
        path = _mount_point(board_id, board["name"], board["ip"])

        if not password:
            return False, "SSH parolası tanımlı değil (Ayarlar → SSH erişimi)."

        os.makedirs(path, exist_ok=True)
        proc = await asyncio.create_subprocess_exec(
            "sshfs", "-o", _SSHFS_OPTS, f"{ssh_user}@{board['ip']}:/", path,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(password.encode() + b"\n"), timeout=15)
        except asyncio.TimeoutError:
            proc.kill()
            _rmdir_quiet(path)
            return False, "Tahtaya bağlanırken zaman aşımı."
        if proc.returncode != 0:
            _rmdir_quiet(path)
            hint = (out or b"").decode("utf-8", "replace").strip().splitlines()[-1:] or ["sshfs"]
            return False, f"Bağlanılamadı: {hint[0][:200]}"

        _mount_paths[board_id] = path
        _last_used[board_id] = time.monotonic()
        await asyncio.to_thread(_record, board_id, board["name"], username)
        return True, path


def _record(board_id: int, name: str, username: str) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO command_log (board_id, board_name, username, source, command, status)"
            " VALUES (%s, %s, %s, 'filemanager', 'dosya yöneticisi bağlandı', 'ok')",
            (board_id, name, username or "—"),
        )
        activity.record(conn, f"Dosya yöneticisi: {username or '—'} → {name}", "warn")


async def _unmount(board_id: int) -> None:
    path = _mount_paths.pop(board_id, None)
    _last_used.pop(board_id, None)
    if not path:
        return
    if _is_mounted(path):
        proc = await asyncio.create_subprocess_exec("fusermount3", "-u", path)
        await proc.wait()
    if not _is_mounted(path):
        _rmdir_quiet(path)


async def _sweep() -> None:
    """Boşta kalan bağları periyodik olarak ayırır."""
    while True:
        await asyncio.sleep(60)
        deadline = time.monotonic() - IDLE_MINUTES * 60
        for board_id in [b for b, t in _last_used.items() if t < deadline]:
            log.info("boşta kalan tahta #%s ayrılıyor", board_id)
            try:
                await _unmount(board_id)
            except Exception:
                log.exception("ayırma başarısız: #%s", board_id)


class MountHandler(tornado.web.RequestHandler):
    # Oturum/yetki denetimi nginx auth_request'te zaten yapıldı; köprü yalnız 127.0.0.1'i dinler.
    # X-Auth-User nginx tarafından oturumdan doldurulur (istemcininki varsa ezilir).
    async def post(self, board_id: str):
        username = self.request.headers.get("X-Auth-User", "")
        ok, res = await _mount(int(board_id), username)
        if not ok:
            self.set_status(502)
            self.write({"ok": False, "error": res})
            return
        self.write({"ok": True, "path": os.path.basename(res) + "/"})


def _locate(fb_path: str):
    """FileBrowser yolu ("/<bağlama dizini>/home/…") → (tahta id, tahtadaki yol, bu makinedeki yol)."""
    name, _, rest = fb_path.lstrip("/").partition("/")
    for board_id, path in _mount_paths.items():
        if os.path.basename(path) == name:
            _last_used[board_id] = time.monotonic()
            remote = posixpath.normpath("/" + rest)
            return board_id, remote, os.path.join(path, remote.lstrip("/"))
    return None


async def _access(board_id: int):
    looked_up = await asyncio.to_thread(_lookup, board_id)
    if looked_up is None or not looked_up[2]:
        return None
    board, ssh_user, password = looked_up
    return {"ip": board["ip"], "user": ssh_user, "password": password}


def _cleanup_stale() -> None:
    """Önceki süreçten kalan (çoğu zaman kopuk) bağları ve dizinleri temizler: ad eşlemesi
    (_mount_paths) yalnız bellekte tutulduğundan bunlar FileBrowser'da sahipsiz klasör olarak kalırdı."""
    for entry in os.listdir(ROOT):
        path = os.path.join(ROOT, entry)
        if _is_mounted(path):
            subprocess.run(["fusermount3", "-uz", path], check=False)
        try:
            os.rmdir(path)
        except OSError:
            log.warning("artık dizin silinemedi: %s", path)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    os.makedirs(ROOT, exist_ok=True)
    _cleanup_stale()
    fixer = Fixer(_access)
    proxy = {"locate": _locate, "fixer": fixer}
    # FileBrowser yazmaları (sahiplik düzeltmesi, bkz. writes.py) — yollar nginx'teki /filemanager/ ile aynı.
    app = tornado.web.Application([
        (r"/mount/(\d+)", MountHandler),
        (r"/filemanager/api/resources", writes.ResourcesProxy, proxy),
        (r"/filemanager/api/resources/(archive|unarchive)", writes.ResourcesProxy, proxy),
    ])
    # Düzenleyiciden kaydedilen dosyalar (PUT) gövdeyle gelir; büyük yüklemeler köprüden geçmez.
    app.listen(PORT, address="127.0.0.1", max_body_size=256 * 1024 * 1024)
    log.info("dosya yöneticisi köprüsü 127.0.0.1:%d (boşta %d dk sonra ayrılır)", PORT, IDLE_MINUTES)
    loop = asyncio.get_event_loop()
    loop.create_task(_sweep())
    loop.run_until_complete(writes.listen_uploads(_locate, fixer))
    loop.run_forever()


if __name__ == "__main__":
    main()
