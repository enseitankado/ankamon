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

"""Tahtadaki bir hesabın ev dizinini, erişim izinleri ve dosya/dizin sahiplikleriyle tar.gz olarak yedekler.

Tahtalar/Ekranlar sağ menüsü "Yedekle" → hesap (bkz. frontend ui/BoardOps.js) "backup_home" görevini
açar; runner tahtaları SIRAYLA bu modülle işler (bkz. runner/__main__.py).

Tek SSH oturumu: tahtada önce `du` ile ev dizininin toplam boyutu ölçülür, ardından GNU tar arşivi
gzip'leyip stdout'a yazar — sıkıştırma tahtada yapılır (ağ ve konteyner CPU'su az kullanılır), akış
doğrudan sunucudaki dosyaya iner (Python belleğinden geçmez). tar'ın --checkpoint'i her CHECKPOINT
kayıtta (kayıt = 10240 bayt, sıkıştırılmamış) stderr'e bir satır yazar; ilerleme yüzdesi buradan,
du'nun toplamına oranla hesaplanır. Tahtada nice/ionice ile en düşük öncelikte çalışır.

Arşiv: izinler, sahiplik (ad + sayısal kimlik), ACL ve genişletilmiş öznitelikler korunur. Geri yükleme:
  tar --extract --gzip --preserve-permissions --same-owner --acls --xattrs -f <dosya> -C /home
Dosyalar BASE_DIR/job-<görev>/ altına yazılır, KEEP_HOURS sonra silinir (bkz. cleanup).

Yalnız .tar.gz (Linux'a geri yükleme biçimi) üretilir — kullanıcı kararı; Windows için ayrı .zip
kopyası bir süre üretildi, sonra kaldırıldı. Not: WinRAR tar'daki UTF-8 pax adlarını okumuyor, Türkçe
adlar orada bozuk görünür — arşivin kendisi doğrudur, 7-Zip ve Linux'taki tar doğru açar.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time

from .accounts import USERNAME_RE

BASE_DIR = "/data/home-backups"
KEEP_HOURS = int(os.environ.get("HOME_BACKUP_KEEP_HOURS", "72"))
TIMEOUT_SECONDS = 6 * 3600
CHECKPOINT = 500               # kayıt (500 × 10240 bayt ≈ 5 MB sıkıştırılmamış veri) başına bir ilerleme satırı
_RECORD = 10240
_PROGRESS_EVERY = 1.5          # sn — ilerleme çubuğu olayı en sık bu aralıkla

_SSH_OPTS = [
    "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4",
    "-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
]

# --one-file-system: ev dizinindeki FUSE/ağ bağlamaları (ör. gvfs) arşive girmesin, takılmasın.
# --ignore-failed-read + uyarı susturma: kullanım sırasında değişen/silinen dosya yedeği bozmasın
# (tar o durumda 1 ile çıkar — yedek geçerlidir, bkz. backup()).
_SCRIPT = r"""
set -u
U='{user}'
H=$(getent passwd "$U" | cut -d: -f6)
if [ -z "$H" ] || [ ! -d "$H" ]; then echo "ANKAMON_ERR Hesap ya da ev dizini bulunamadı: $U" >&2; exit 3; fi
SIZE=$(du -sbx "$H" 2>/dev/null | cut -f1)
echo "ANKAMON_SIZE ${{SIZE:-0}} $H" >&2
cd "$(dirname "$H")" || exit 3
exec env LC_ALL=C nice -n 19 ionice -c3 tar --create --gzip --file=- \
  --preserve-permissions --acls --xattrs --one-file-system --ignore-failed-read \
  --warning=no-file-changed --warning=no-file-removed --warning=no-file-shrank --warning=no-file-ignored --warning=no-xdev \
  --checkpoint={checkpoint} --checkpoint-action=echo \
  "$(basename "$H")"
"""

_CHECKPOINT_RE = re.compile(r"checkpoint (\d+)\s*$")


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def job_dir(job_id: int) -> str:
    return os.path.join(BASE_DIR, f"job-{int(job_id)}")


def cleanup(now: float | None = None) -> int:
    """KEEP_HOURS'tan eski görev dizinlerini siler (disk dolmasın). Döner: silinen dizin sayısı."""
    now = now or time.time()
    removed = 0
    try:
        entries = os.listdir(BASE_DIR)
    except FileNotFoundError:
        return 0
    for name in entries:
        path = os.path.join(BASE_DIR, name)
        if name.startswith("job-") and os.path.isdir(path) and now - os.path.getmtime(path) > KEEP_HOURS * 3600:
            shutil.rmtree(path, ignore_errors=True)
            removed += 1
    return removed


def _safe(text: str) -> str:
    # "A Blok - Lab 1" → "A-Blok-Lab-1" (ardışık ayraçlar tek tireye iner).
    return re.sub(r"[^A-Za-z0-9._]+", "-", text or "").strip("-")[:60] or "tahta"


def backup(board: dict, user: str, password: str, username: str, job_id: int, events) -> dict:
    """Yedekler; olayları `events`'e yazar ("info"/"err"/"ok"/"fail" satırları + ilerleme çubuğu için
    "progress" ve indirilecek dosya için "file" — ikisi de JSON metinli, bkz. frontend ui/Jobs.js).
    Döner: {"status", "rc", "output"} (job_targets için)."""
    if not USERNAME_RE.match(username or ""):
        events.add("fail", f"Geçersiz kullanıcı adı: {username}")
        return {"status": "failed", "rc": None, "output": "Geçersiz kullanıcı adı."}
    if not board.get("ip"):
        events.add("fail", "Tahtanın IP adresi yok.")
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}

    out_dir = job_dir(job_id)
    os.makedirs(out_dir, mode=0o755, exist_ok=True)
    os.chmod(BASE_DIR, 0o755)
    name = f"{_safe(board.get('name') or board.get('hostname') or '')}_{username}_{time.strftime('%Y%m%d-%H%M')}.tar.gz"
    path = os.path.join(out_dir, name)

    target = f"{user}@{board['ip']}"
    events.add("info", f"Bağlanılıyor: {target} — {username} hesabının ev dizini yedeklenecek")
    script = _SCRIPT.format(user=username, checkpoint=CHECKPOINT)
    started = time.monotonic()
    with open(path, "wb") as out:
        proc = subprocess.Popen(
            ["sshpass", "-e", "ssh", *_SSH_OPTS, target, "sh -c " + _quote(script)],
            stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.PIPE,
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password})
        total = 0
        home = ""
        last_progress = 0.0
        next_report = 10
        err_tail: list[str] = []
        warnings = 0
        for raw in iter(proc.stderr.readline, b""):
            line = raw.decode("utf-8", errors="replace").rstrip()
            if time.monotonic() - started > TIMEOUT_SECONDS:
                proc.kill()
                break
            if line.startswith("ANKAMON_SIZE "):
                parts = line.split(" ", 2)
                total = int(parts[1]) if parts[1].isdigit() else 0
                home = parts[2] if len(parts) > 2 else ""
                events.add("info", f"Bağlandı. Ev dizini: {home} — toplam {human(total)}; arşivleniyor ve sıkıştırılıyor…")
                _progress(events, 0, 0, total, 0)
                continue
            if line.startswith("ANKAMON_ERR "):
                err_tail.append(line[len("ANKAMON_ERR "):])
                events.add("err", err_tail[-1])
                continue
            m = _CHECKPOINT_RE.search(line)
            if m:
                done = int(m.group(1)) * _RECORD
                pct = min(99, int(done * 100 / total)) if total else 0
                now = time.monotonic()
                if now - last_progress >= _PROGRESS_EVERY:
                    last_progress = now
                    _progress(events, pct, done, total, _size(path))
                if total and pct >= next_report:
                    events.add("info", f"%{pct} — {human(done)} / {human(total)} işlendi, arşiv şu an {human(_size(path))}")
                    next_report = (pct // 10 + 1) * 10
                continue
            if line:
                warnings += 1
                err_tail = (err_tail + [line])[-5:]
                if warnings <= 50:
                    events.add("err", line)
        rc = proc.wait()
    elapsed = time.monotonic() - started
    size = _size(path)

    # tar: 0 = tamam, 1 = bazı dosyalar okunurken değişti/silindi (arşiv geçerli). SSH: 5 = parola, 255 = bağlantı.
    if rc in (0, 1) and size > 0 and total >= 0 and home:
        os.chmod(path, 0o644)
        note = " (bazı dosyalar yedeklenirken değişti/okunamadı — ayrıntı yukarıda)" if rc == 1 or warnings else ""
        _progress(events, 100, total, total, size)
        events.add("file", json.dumps({"name": name, "size": size}, ensure_ascii=False))
        text = f"Yedek hazır: {name} — {human(total)} → {human(size)} ({elapsed:.0f} sn){note}"
        events.add("ok", text)
        return {"status": "ok", "rc": rc, "output": text}

    try:
        os.remove(path)
    except OSError:
        pass
    if rc == 5:
        status, text = "unreachable", "Bağlanılamadı: SSH parolası reddedildi (Ayarlar → SSH erişimi)."
    elif rc == 255 and not home:
        status, text = "unreachable", "Bağlanılamadı: " + (err_tail[-1] if err_tail else "SSH bağlantısı kurulamadı.")
    elif elapsed > TIMEOUT_SECONDS:
        status, text = "failed", f"Zaman aşımı: {TIMEOUT_SECONDS // 3600} saatte bitmedi, durduruldu."
    else:
        status, text = "failed", "Yedekleme başarısız: " + (err_tail[-1] if err_tail else f"çıkış kodu {rc}")
    events.add("fail", text)
    return {"status": status, "rc": rc, "output": text}


def _progress(events, pct: int, done: int, total: int, gz: int) -> None:
    events.add("progress", json.dumps({"pct": pct, "done": done, "total": total, "gz": gz}))
    events.flush()


def _size(path: str) -> int:
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def _quote(text: str) -> str:
    return "'" + text.replace("'", "'\"'\"'") + "'"
