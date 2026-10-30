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

"""Yedek dosyasından tahtada kullanıcı hesabını yeniden oluşturur: hesap, ev dizini, parola, PIN anahtarı.

Sağ menü "Yedekle/Geri al" ▸ Geri al (bkz. frontend ui/homebackup): dosya files servisine akışla yüklenir
(new_upload/upload_summary), "restore_home" görevi runner'da tahtaları SIRAYLA işler (restore_home).

Yüklenen dosyaya GÜVENİLMEZ: "boards.restore" yetkili biri elle hazırlanmış arşivle tahtada root yetkisi
kazanmaya çalışabilir. Bu yüzden hesap bilgisinin her alanı kalıba göre doğrulanır (_validate_meta — parola özeti
chpasswd satırına, adlar komut argümanına gider) ve arşivin bütün üyeleri tahtaya gönderilmeden taranır
(_scan_members: ev dizini dışına yol, aygıt dosyası, setuid/setgid dosya reddedilir). tar'ın --xattrs'ı açarken yalnız
user.* yazar (security.capability yazılmaz). Yönetici olmayan kullanıcı yetkili hesap (etapadmin, sudo grubu…)
geri alamaz, yetkili bir grup ekleyemez; böyle bir hesabın üzerine de yazamaz (bkz. HOME_RESTORE_PRIVILEGED).

Tek SSH oturumu: tahtada Python betiği çalışır, stdin'den önce tek satır JSON (hesap bilgisi — parola özeti ve PIN
komut satırında görünmesin diye argüman değil), ardından gzip'li arşiv gelir; arşivi tar doğrudan stdin'den açar.
İlerleme gönderilen bayttan hesaplanır. Hesap varsa ya da ev dizini duruyorsa, "overwrite" verilmedikçe hiçbir şey
değiştirilmez; açık süreci olan hesabın üzerine hiç yazılmaz. Kimlikler boşsa korunur, tahtada başka hesapta ise
yenisi alınır ve dosyaların sahipliği ona çevrilir.
"""

from __future__ import annotations

import json
import os
import posixpath
import queue
import re
import secrets
import shlex
import shutil
import stat
import subprocess
import tarfile
import threading
import time

from .accounts import USERNAME_RE
from .backup import BASE_DIR, HOME_BACKUP_META, TIMEOUT_SECONDS, _SSH_OPTS, _progress, home_backup_size_text

_ARCHIVE = "yedek.tar.gz"
_OWNER = "sahip"
_CHUNK = 256 * 1024
_DISK_RESERVE = 1 << 30
_META_LIMIT = 64 * 1024

HOME_RESTORE_PRIVILEGED = {"root", "sudo", "adm", "wheel", "admin", "shadow", "disk", "docker", "lxd", "libvirt"}

_GROUP_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,31}$")
_HOME_RE = re.compile(r"^/home/[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$")
_SHELL_RE = re.compile(r"^/[A-Za-z0-9/_.-]{1,64}$")
_HASH_RE = re.compile(r"^\$[A-Za-z0-9./$=,+-]{1,512}$")
_OTP_RE = re.compile(r"^[A-Za-z0-9=]{4,256}$")


class HomeRestoreRefused(Exception):
    """Kullanıcıya gösterilebilir (Türkçe) ret nedeni."""


def merge_home_backup_results(parts: list[dict]) -> dict:
    """Bir tahtadaki hesap başına yedek sonuçlarını tek tahta sonucuna indirger (bkz. runner "backup_home")."""
    done = [p for p in parts if p["status"] != "skipped"]
    if not done:
        return {"status": "failed", "rc": None, "output": "Seçilen hesaplar bu tahtada yok."}
    bad = next((p for p in done if p["status"] != "ok"), None)
    return {"status": bad["status"] if bad else "ok", "rc": (bad or done[-1])["rc"],
            "output": "\n".join(p["output"] for p in parts)}


def _upload_dir(token: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{32}", token or ""):
        raise HomeRestoreRefused("Geçersiz yedek dosyası.")
    return os.path.join(BASE_DIR, "restore-" + token)


def new_upload(owner: str, size: int) -> tuple[str, str]:
    """Yükleme alanı açar. Döner: (jeton, arşivin yazılacağı yol). Yer yoksa yükleme hiç başlamaz."""
    os.makedirs(BASE_DIR, mode=0o755, exist_ok=True)
    free = shutil.disk_usage(BASE_DIR).free - _DISK_RESERVE
    if size > free:
        raise HomeRestoreRefused(f"Sunucuda yeterli boş disk alanı yok: {home_backup_size_text(size)} yüklenecek, "
                                 f"{home_backup_size_text(max(0, free))} kullanılabilir (1 GB pay hariç).")
    token = secrets.token_hex(16)
    path = _upload_dir(token)
    os.makedirs(path, mode=0o700)
    with open(os.path.join(path, _OWNER), "w", encoding="utf-8") as f:
        f.write(owner)
    return token, os.path.join(path, _ARCHIVE)


def discard_upload(token: str) -> None:
    try:
        shutil.rmtree(_upload_dir(token), ignore_errors=True)
    except HomeRestoreRefused:
        pass


def _validate_meta(meta) -> dict:
    def bad(what):
        raise HomeRestoreRefused(f"Yedek dosyasının hesap bilgisi geçersiz ({what}).")
    if not isinstance(meta, dict) or meta.get("format") != 1:
        bad("biçim")
    name = meta.get("username")
    if not isinstance(name, str) or not USERNAME_RE.match(name) or name == "root":
        bad("kullanıcı adı")
    uid, gid = meta.get("uid"), meta.get("gid")
    if type(uid) is not int or not 1000 <= uid < 60000:
        bad("kullanıcı kimliği")
    if type(gid) is not int or not 100 <= gid < 60000:
        bad("grup kimliği")
    if not isinstance(meta.get("group"), str) or not _GROUP_RE.match(meta["group"]):
        bad("grup")
    if not isinstance(meta.get("home"), str) or not _HOME_RE.match(meta["home"]) or meta["home"].endswith("/.."):
        bad("yalnız /home altındaki ev dizinleri geri alınabilir")
    if not isinstance(meta.get("shell"), str) or not _SHELL_RE.match(meta["shell"]) or ".." in meta["shell"]:
        bad("kabuk")
    gecos = meta.get("gecos", "")
    if not isinstance(gecos, str) or len(gecos) > 256 or any(c in gecos for c in ":\n\r\0"):
        bad("tam ad")
    groups = meta.get("groups", [])
    if not isinstance(groups, list) or not all(isinstance(g, str) and _GROUP_RE.match(g) for g in groups):
        bad("gruplar")
    shadow = meta.get("shadow") or ""
    if not isinstance(shadow, str):
        bad("parola özeti")
    # Kilitli hesap ("!", "*") parola taşımaz; kalıba uymayan özet chpasswd'ye asla gitmez.
    shadow = shadow if _HASH_RE.match(shadow) else ""
    otp = meta.get("otp")
    if otp is not None and (not isinstance(otp, str) or not _OTP_RE.match(otp)):
        bad("PIN anahtarı")
    return dict(meta, gecos=gecos, groups=groups, shadow=shadow, otp=otp, expire=meta.get("expire") is True)


def _read_meta(path: str) -> dict:
    try:
        with tarfile.open(path, "r|gz") as tar:
            first = tar.next()
            if first is None or first.name != HOME_BACKUP_META or not first.isfile() or first.size > _META_LIMIT:
                raise HomeRestoreRefused(
                    "Bu dosyada hesap bilgisi yok: Ankamon'un \"Yedekle/Geri al\" penceresiyle alınmış bir yedek seçin "
                    "(eski yedekler yalnız ev dizinini içerir, elle açılabilir).")
            return _validate_meta(json.loads(tar.extractfile(first).read()))
    except (tarfile.TarError, EOFError, OSError, ValueError) as exc:
        raise HomeRestoreRefused("Dosya okunamadı: geçerli bir .tar.gz yedeği değil.") from exc


def upload_summary(token: str) -> dict:
    """Yüklenen dosyanın kullanıcıya gösterilecek özeti; gizli alanlar (parola özeti, PIN) dönmez."""
    path = os.path.join(_upload_dir(token), _ARCHIVE)
    meta = _read_meta(path)
    return {
        "token": token, "username": meta["username"], "full_name": meta["gecos"].split(",")[0],
        "uid": meta["uid"], "home": meta["home"], "groups": meta["groups"], "has_otp": bool(meta["otp"]),
        "has_password": bool(meta["shadow"]), "hostname": str(meta.get("hostname") or "")[:64],
        "created_at": meta.get("created_at") if type(meta.get("created_at")) is int else None,
        "size": os.path.getsize(path),
    }


def _scan_members(path: str, meta: dict) -> None:
    """Arşivin bütün üyelerini denetler: yalnız hesabın ev dizini altında sıradan dosya/dizin/bağ."""
    base = posixpath.basename(meta["home"])

    def inside(name: str) -> bool:
        parts = name.split("/")
        return parts[0] == base and ".." not in parts

    try:
        with tarfile.open(path, "r|gz") as tar:
            for member in tar:
                if member.name == HOME_BACKUP_META:
                    continue
                name = member.name.rstrip("/")
                if not inside(name):
                    raise HomeRestoreRefused(f"Yedek reddedildi: ev dizini dışına yazan öğe var ({member.name[:120]}).")
                if member.isdev():
                    raise HomeRestoreRefused(f"Yedek reddedildi: aygıt dosyası var ({member.name[:120]}).")
                if member.islnk() and not inside(member.linkname):
                    raise HomeRestoreRefused(f"Yedek reddedildi: ev dizini dışına sabit bağ var ({member.name[:120]}).")
                if member.isfile() and member.mode & (stat.S_ISUID | stat.S_ISGID):
                    raise HomeRestoreRefused(f"Yedek reddedildi: setuid/setgid dosya var ({member.name[:120]}).")
    except (tarfile.TarError, EOFError, OSError) as exc:
        raise HomeRestoreRefused("Yedek dosyası bozuk: sonuna kadar okunamadı.") from exc


def prepare_home_restore(token: str, owner: str, is_admin: bool) -> tuple[str, dict]:
    """Görev başında bir kez: dosyanın sahibi, hesap bilgisi ve üyeler denetlenir. Döner: (arşiv yolu, hesap bilgisi)."""
    directory = _upload_dir(token)
    try:
        with open(os.path.join(directory, _OWNER), encoding="utf-8") as f:
            if f.read() != owner:
                raise HomeRestoreRefused("Yedek dosyası bu kullanıcıya ait değil.")
    except OSError as exc:
        raise HomeRestoreRefused("Yedek dosyası sunucuda bulunamadı (süresi dolmuş olabilir); yeniden yükleyin.") from exc
    path = os.path.join(directory, _ARCHIVE)
    meta = _read_meta(path)
    _scan_members(path, meta)
    meta["restricted"] = not is_admin
    if not is_admin:
        if meta["username"] == "etapadmin" or meta["group"] in HOME_RESTORE_PRIVILEGED:
            raise HomeRestoreRefused("Yetkili bir hesabın yedeğini yalnız yönetici geri alabilir.")
        meta["groups"] = [g for g in meta["groups"] if g not in HOME_RESTORE_PRIVILEGED]
    return path, meta


# Tahtada root olarak çalışır. Çıktı satırları: "I <bilgi>", "W <uyarı>", "E <hata>" (sonra çıkış 3).
_REMOTE = r"""
import grp, json, os, pwd, subprocess, sys, tempfile

OTP_FILE = "/etc/otp-secrets.json"
EXPIRE_DIR = "/var/lib/eta/expire-uid"

def say(kind, text):
    print(kind, text, flush=True)

def die(text):
    say("E", text)
    sys.exit(3)

def run(*args, data=None):
    p = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       stdin=None if data is not None else subprocess.DEVNULL)
    return p.returncode, p.stdout.decode("utf-8", "replace").strip()

def must(*args, data=None):
    rc, out = run(*args, data=data)
    if rc:
        die(args[0] + " başarısız: " + out[-300:])

def lookup(fn, key):
    try:
        return fn(key)
    except KeyError:
        return None

raw = b""
while True:
    c = os.read(0, 1)
    if not c:
        die("Hesap bilgisi gelmedi.")
    if c == b"\n":
        break
    raw += c
req = json.loads(raw)
m = req["meta"]
name, home = m["username"], m["home"]
ent = lookup(pwd.getpwnam, name)
if ent:
    if not req["overwrite"]:
        die(name + " hesabı bu tahtada zaten var; değiştirilmedi. Üzerine yazmak için seçeneği işaretleyin.")
    if ent.pw_dir != home:
        die(name + " hesabının ev dizini farklı (" + ent.pw_dir + "); geri alınmadı.")
    if run("pgrep", "-u", str(ent.pw_uid))[0] == 0:
        die(name + " hesabının açık oturumu ya da çalışan süreci var; önce oturumu kapatın.")
    if m.get("restricted"):
        held = {g.gr_name for g in grp.getgrall() if name in g.gr_mem} | {grp.getgrgid(ent.pw_gid).gr_name}
        if ent.pw_uid == 0 or name == "etapadmin" or held & set(req["privileged"]):
            die("Yetkili bir hesabın üzerine yalnız yönetici yazabilir.")
elif os.path.lexists(home) and not req["overwrite"]:
    die(home + " zaten var (hesabı yok); değiştirilmedi. Üzerine yazmak için seçeneği işaretleyin.")

created = False
if not ent:
    if not lookup(grp.getgrnam, m["group"]):
        args = ["groupadd"]
        if not lookup(grp.getgrgid, m["gid"]):
            args += ["-g", str(m["gid"])]
        must(*args, m["group"])
    shell = m["shell"] if os.path.exists(m["shell"]) else "/bin/bash"
    args = ["useradd", "-M", "-g", m["group"], "-d", home, "-s", shell, "-c", m["gecos"]]
    if lookup(pwd.getpwuid, m["uid"]):
        say("W", "Kullanıcı kimliği " + str(m["uid"]) + " bu tahtada başka hesapta; yeni kimlik verildi.")
    else:
        args += ["-u", str(m["uid"])]
    must(*args, name)
    ent = pwd.getpwnam(name)
    created = True
    say("I", name + " hesabı oluşturuldu (kimlik " + str(ent.pw_uid) + ").")

say("I", "Ev dizini açılıyor: " + home)
tar = subprocess.run(
    ["tar", "--extract", "--gzip", "--file=-", "--preserve-permissions", "--same-owner", "--numeric-owner",
     "--acls", "--xattrs", "--warning=no-timestamp", "--anchored", "--exclude=" + req["meta_name"],
     "-C", os.path.dirname(home)],
    stdin=0, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=dict(os.environ, LC_ALL="C"))
for line in tar.stdout.decode("utf-8", "replace").splitlines()[-5:]:
    say("W", line)
if not os.path.isdir(home):
    die("Ev dizini açılamadı.")

if ent.pw_gid != m["gid"]:
    must("find", home, "-xdev", "-gid", str(m["gid"]), "-exec", "chown", "-h", ":" + str(ent.pw_gid), "{}", "+")
if ent.pw_uid != m["uid"]:
    must("find", home, "-xdev", "-uid", str(m["uid"]), "-exec", "chown", "-h", str(ent.pw_uid), "{}", "+")

have = [g for g in m["groups"] if lookup(grp.getgrnam, g)]
gone = [g for g in m["groups"] if g not in have]
if have:
    must("usermod", "-a", "-G", ",".join(have), name)
if gone:
    say("W", "Bu tahtada olmayan gruplar atlandı: " + ", ".join(gone))

if m["shadow"]:
    must("chpasswd", "-e", data=(name + ":" + m["shadow"] + "\n").encode())
    say("I", "Parola geri yüklendi.")
else:
    say("W", "Yedekte parola yok: hesaba giriş için parola ayarlayın.")

if m["otp"]:
    secrets_map = {}
    if os.path.exists(OTP_FILE):
        try:
            with open(OTP_FILE) as f:
                secrets_map = json.load(f)
        except ValueError:
            die(OTP_FILE + " bozuk; PIN anahtarı yazılmadı.")
    secrets_map[name] = m["otp"]
    fd, tmp = tempfile.mkstemp(dir="/etc", prefix=".otp-secrets.")
    with os.fdopen(fd, "w") as f:
        json.dump(secrets_map, f)
    os.chmod(tmp, 0o600)
    os.replace(tmp, OTP_FILE)
    say("I", "PIN anahtarı " + OTP_FILE + " dosyasına yazıldı.")
else:
    say("I", "Yedekte PIN anahtarı yok.")

# ETAP'ın "ilk girişte parola değiştir" işareti UID'ye bağlıdır ve userdel silmez: eski hesaptan kalmış olabilir.
if os.path.isdir(EXPIRE_DIR):
    mark = os.path.join(EXPIRE_DIR, str(ent.pw_uid))
    if m["expire"]:
        open(mark, "a").close()
    elif os.path.exists(mark):
        os.remove(mark)

if tar.returncode:
    die("Hesap hazır ama bazı dosyalar açılamadı (tar çıkış " + str(tar.returncode) + "; ayrıntı yukarıda).")
say("I", "Yeni hesap hazır." if created else "Var olan hesabın üzerine yazıldı.")
"""


def restore_home(board: dict, user: str, password: str, archive: str, meta: dict, overwrite: bool, events) -> dict:
    """Tek tahtaya geri alır; olaylar `events`'e. Döner: {"status", "rc", "output"} (job_targets için)."""
    if not board.get("ip"):
        events.add("fail", "Tahtanın IP adresi yok.")
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    name = meta["username"]
    target = f"{user}@{board['ip']}"
    events.add("info", f"Bağlanılıyor: {target} — {name} hesabı geri alınacak")
    header = {"meta": meta, "overwrite": overwrite, "meta_name": HOME_BACKUP_META,
              "privileged": sorted(HOME_RESTORE_PRIVILEGED)}
    proc = subprocess.Popen(
        ["sshpass", "-e", "ssh", *_SSH_OPTS, target,
         "PYTHONIOENCODING=utf-8 python3 -c " + shlex.quote(_REMOTE)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password})
    timer = threading.Timer(TIMEOUT_SECONDS, proc.kill)
    timer.start()
    # Olaylar veritabanı bağlantısıyla yazılır, o da yalnız bu iş parçacığında kullanılır: okuyucu yalnız kuyruğa koyar.
    lines: queue.Queue = queue.Queue()

    def reader():
        for raw in iter(proc.stdout.readline, b""):
            lines.put(raw.decode("utf-8", "replace").rstrip())

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    last_error = ""

    def drain():
        nonlocal last_error
        while True:
            try:
                line = lines.get_nowait()
            except queue.Empty:
                return
            kind, _, text = line.partition(" ")
            if kind == "I":
                events.add("info", text)
            elif kind == "W":
                events.add("err", text)
            elif kind == "E":
                last_error = text
            elif line:
                last_error = line
                events.add("err", line)

    total = os.path.getsize(archive)
    sent = 0
    started = time.monotonic()
    last_progress = 0.0
    try:
        proc.stdin.write(json.dumps(header, ensure_ascii=False).encode() + b"\n")
        proc.stdin.flush()
        with open(archive, "rb") as f:
            while chunk := f.read(_CHUNK):
                proc.stdin.write(chunk)
                sent += len(chunk)
                drain()
                now = time.monotonic()
                if now - last_progress >= 1.5:
                    last_progress = now
                    _progress(events, min(99, sent * 100 // max(total, 1)), sent, total, total)
        proc.stdin.close()
    except (BrokenPipeError, ValueError):
        pass  # tahta erken vazgeçti (ör. hesap zaten var): neden çıktıda
    rc = proc.wait()
    timer.cancel()
    thread.join(timeout=10)
    drain()
    elapsed = time.monotonic() - started

    if rc == 0:
        _progress(events, 100, total, total, total)
        text = f"{name} geri alındı — {home_backup_size_text(total)} ({elapsed:.0f} sn)"
        events.add("ok", text)
        return {"status": "ok", "rc": rc, "output": text}
    if rc == 5:
        status, text = "unreachable", "Bağlanılamadı: SSH parolası reddedildi (Ayarlar → SSH erişimi)."
    elif rc == 255:
        status, text = "unreachable", "Bağlanılamadı: " + (last_error or "SSH bağlantısı kurulamadı.")
    else:
        status, text = "failed", last_error or f"Geri alma başarısız: çıkış kodu {rc}"
    events.add("fail", text)
    return {"status": status, "rc": rc, "output": text}
