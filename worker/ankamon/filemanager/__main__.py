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

POST /mount/<cihaz id>  → cihazı /run/ankamon/filemanager/<takma ad>/ altına sshfs ile bağlar
                          (zaten bağlıysa anında döner), {"ok": true, "path": "<takma ad>/"} döner.
                          ?user=<ad>: yanıta "start" de eklenir — o kullanıcının masaüstü dizini, bağlama kökünden
                          göreli ("home/ogretmen/Masaüstü/"; bulunamazsa ev dizini, o da yoksa null). Bkz. _desktop_start.
                          Dizin adı FileBrowser'da cihazın adı olarak görünür (ör. "A Blok - Lab 1");
                          aynı adlı iki cihaz bağlıysa ikincisine " (<ip>)" eklenir.

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

from .. import activity, db, sshactivity
from ..executor.jobs import _device_access
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
    # Sembolik bağlar cihazda çözülür ve hedefleri gibi görünür. sshfs 3.7.6'nın varsayılanı
    # (contain_symlinks) mutlak ya da ".." içeren bağları EPERM ile reddediyor; ör. ETAP'ın her ev
    # dizinindeki "ortak-alan" (/ortak-alan'a bağ) okunamayan bir dosya gibi görünüyor, kopyalama
    # "could not resolve source path" ile düşüyordu. no_contain_symlinks KULLANILMAZ: bağ bu makinede
    # çözülürdü ve "../../.." ile başlayan bir bağ konteynerin kendi dosya sistemini açardı.
    "follow_symlinks"
)

# device_id -> son erişim (time.monotonic) / bağlama noktası. Yalnız bu süreçte tutulur; süreç yeniden
# başlarsa önceki bağlar açılışta temizlenir (bkz. _cleanup_stale).
_last_used: dict[int, float] = {}
_mount_paths: dict[int, str] = {}
# SSH etkinlik kaydı (alt çubuk ▸ SSH): sshfs kendi ssh sürecini başlatır, sshpass sarmalayıcısından geçmez.
_ssh_started: dict[int, int] = {}
_mount_lock = asyncio.Lock()

# Dizin adında sorun çıkaracak karakterler (yol ayırıcı, URL'de özel anlamlı olanlar, denetim karakterleri).
_UNSAFE = re.compile(r'[\x00-\x1f\x7f/\\?#%*:|"<>]+')


def _mount_point(device_id: int, name: str, ip: str) -> str:
    """Cihazın takma adından dizin adı üretir; başka bir bağlı cihazla çakışırsa IP'yi ekler."""
    base = " ".join(_UNSAFE.sub("-", name).split()).strip(" .")[:100] or ip
    taken = {p for b, p in _mount_paths.items() if b != device_id}
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


def _lookup(device_id: int):
    with db.connect() as conn:
        device = conn.execute(
            "SELECT host(ip) AS ip, coalesce(nullif(label, ''), hostname, host(ip)) AS name FROM devices WHERE id = %s",
            (device_id,),
        ).fetchone()
        if not device or not device["ip"]:
            return None
        ssh_user, password = _device_access(conn)
        # sshfs parolayı stdin'den alır (sshpass süzgecinden geçmez): cihaza özel root parolası burada.
        own = conn.execute("SELECT root_password FROM device_credentials WHERE device_id = %s", (device_id,)).fetchone()
        return device, ssh_user, (own["root_password"] if own else password)


async def _mount(device_id: int, username: str) -> tuple[bool, str]:
    """İdempotent: zaten bağlıysa hemen döner. Döner: (başarılı mı, hata ya da bağlama noktası)."""
    async with _mount_lock:
        looked_up = await asyncio.to_thread(_lookup, device_id)
        if looked_up is None:
            return False, "Cihaz bulunamadı ya da IP'si yok."
        device, ssh_user, password = looked_up

        old = _mount_paths.get(device_id)
        if old and old == _mount_point(device_id, device["name"], device["ip"]) and _is_mounted(old):
            _last_used[device_id] = time.monotonic()
            return True, old
        if old:
            # Takma ad bağlıyken değişmiş (ya da bağ kopmuş): eski dizini ayırıp yeni adla bağla.
            await _unmount(device_id)
        path = _mount_point(device_id, device["name"], device["ip"])

        if not password:
            return False, "SSH parolası tanımlı değil (Ayarlar → SSH erişimi)."

        os.makedirs(path, exist_ok=True)
        proc = await asyncio.create_subprocess_exec(
            "sshfs", "-o", _SSHFS_OPTS, f"{ssh_user}@{device['ip']}:/", path,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(password.encode() + b"\n"), timeout=15)
        except asyncio.TimeoutError:
            proc.kill()
            _rmdir_quiet(path)
            return False, "Cihaza bağlanırken zaman aşımı."
        if proc.returncode != 0:
            _rmdir_quiet(path)
            hint = (out or b"").decode("utf-8", "replace").strip().splitlines()[-1:] or ["sshfs"]
            return False, f"Bağlanılamadı: {hint[0][:200]}"

        _mount_paths[device_id] = path
        _ssh_started[device_id] = sshactivity.start(f"sshfs:{device_id}", "filemanager", "sshfs",
                                                   f"{ssh_user}@{device['ip']}", f"sshfs bağla :/ → {path} (dosya yöneticisi)")
        _last_used[device_id] = time.monotonic()
        await asyncio.to_thread(_record, device_id, device["name"], username)
        return True, path


def _record(device_id: int, name: str, username: str) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO command_log (device_id, device_name, username, source, command, status)"
            " VALUES (%s, %s, %s, 'filemanager', 'dosya yöneticisi bağlandı', 'ok')",
            (device_id, name, username or "—"),
        )
        activity.record(conn, f"Dosya yöneticisi: {username or '—'} → {name}", "warn")


async def _unmount(device_id: int) -> None:
    path = _mount_paths.pop(device_id, None)
    _last_used.pop(device_id, None)
    if device_id in _ssh_started:
        sshactivity.end(f"sshfs:{device_id}", _ssh_started.pop(device_id))
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
        for device_id in [b for b, t in _last_used.items() if t < deadline]:
            log.info("boşta kalan cihaz #%s ayrılıyor", device_id)
            try:
                await _unmount(device_id)
            except Exception:
                log.exception("ayırma başarısız: #%s", device_id)


_USER_NAME_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$")
_XDG_DESKTOP_RE = re.compile(r'^\s*XDG_DESKTOP_DIR\s*=\s*"?([^"\n]*)"?\s*$', re.M)


def _desktop_start(mount: str, user: str) -> str | None:
    """Ekranlar kutucuğundaki klasör simgesi (kullanıcı isteği 2026-11-23): dosya yöneticisi oturum açık kullanıcının
    masaüstünde açılsın. Bağlanmış cihaz dosya sisteminden (sshfs, birkaç küçük okuma) bulunur: ev dizini /etc/passwd'den,
    masaüstü ~/.config/user-dirs.dirs XDG_DESKTOP_DIR'den (ETAP Türkçe: "Masaüstü"), yoksa Masaüstü/Desktop denenir.
    Döner: bağlama kökünden göreli, "/" ile biten yol; masaüstü yoksa ev dizini; ikisi de yoksa None."""
    if not _USER_NAME_RE.match(user):
        return None
    home = None
    try:
        with open(os.path.join(mount, "etc/passwd"), encoding="utf-8", errors="replace") as f:
            for line in f:
                parts = line.rstrip("\n").split(":")
                if len(parts) >= 6 and parts[0] == user:
                    home = parts[5]
                    break
    except OSError:
        pass
    home = posixpath.normpath(home or f"/home/{user}")
    if not home.startswith("/") or home == "/":
        return None
    local = lambda remote: os.path.join(mount, remote.lstrip("/"))   # noqa: E731
    candidates = []
    try:
        with open(local(home + "/.config/user-dirs.dirs"), encoding="utf-8", errors="replace") as f:
            m = _XDG_DESKTOP_RE.search(f.read())
        if m:
            candidates.append(m.group(1).replace("$HOME", home))
    except OSError:
        pass
    candidates += [home + "/Masaüstü", home + "/Desktop"]
    for c in candidates:
        c = posixpath.normpath(c)
        # Yalnız ev dizininin altı (XDG_DESKTOP_DIR="$HOME" ise ev dizininin kendisi aşağıda).
        if c.startswith(home + "/") and os.path.isdir(local(c)):
            return c.lstrip("/") + "/"
    return home.lstrip("/") + "/" if os.path.isdir(local(home)) else None


class MountHandler(tornado.web.RequestHandler):
    # Oturum/yetki denetimi nginx auth_request'te zaten yapıldı; köprü yalnız 127.0.0.1'i dinler.
    # X-Auth-User nginx tarafından oturumdan doldurulur (istemcininki varsa ezilir).
    async def post(self, device_id: str):
        username = self.request.headers.get("X-Auth-User", "")
        ok, res = await _mount(int(device_id), username)
        if not ok:
            self.set_status(502)
            self.write({"ok": False, "error": res})
            return
        out = {"ok": True, "path": os.path.basename(res) + "/"}
        user = self.get_argument("user", "")
        if user:
            try:
                out["start"] = await asyncio.wait_for(asyncio.to_thread(_desktop_start, res, user), 10)
            except Exception:
                log.exception("masaüstü dizini bulunamadı: #%s %s", device_id, user)
                out["start"] = None
        self.write(out)


def _locate(fb_path: str):
    """FileBrowser yolu ("/<bağlama dizini>/home/…") → (cihaz id, cihazdaki yol, bu makinedeki yol)."""
    name, _, rest = fb_path.lstrip("/").partition("/")
    for device_id, path in _mount_paths.items():
        if os.path.basename(path) == name:
            _last_used[device_id] = time.monotonic()
            remote = posixpath.normpath("/" + rest)
            return device_id, remote, os.path.join(path, remote.lstrip("/"))
    return None


async def _access(device_id: int):
    looked_up = await asyncio.to_thread(_lookup, device_id)
    if looked_up is None or not looked_up[2]:
        return None
    device, ssh_user, password = looked_up
    return {"ip": device["ip"], "user": ssh_user, "password": password}


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
