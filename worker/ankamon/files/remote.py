"""Tahtalara SSH ile dosya işlemleri (listeleme, silme, ad değiştirme, klasör oluşturma).

Bağlantılar OpenSSH ControlMaster ile tahta başına paylaşılır: ilk komut asıl bağlantıyı açar (parola
sshpass ile), sonrakiler aynı bağlantı üzerinde ~20 ms'de çalışır — gezinirken her tıklamada yeni bir
SSH el sıkışması (~0,5 sn) olmaz. Ortak bağlantı boşta CONTROL_PERSIST saniye sonra kendiliğinden kapanır.

Tahtada çalışan her betik `sh -c '<betik>' sh <arg>…` biçiminde çağrılır: yollar/adlar betiğe metin olarak
gömülmez, konumsal argüman olarak geçer (tırnak/boşluk/özel karakter güvenli).
"""

from __future__ import annotations

import asyncio
import os
import posixpath
import shlex

CM_DIR = "/run/ankamon/files"
CONTROL_PERSIST = int(os.environ.get("FILES_SSH_PERSIST", "300"))

_SSH_OPTS = [
    "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
    "-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
    "-o", "ControlMaster=auto", "-o", f"ControlPath={CM_DIR}/%C", "-o", f"ControlPersist={CONTROL_PERSIST}",
]


class RemoteError(Exception):
    """Kullanıcıya gösterilebilir (Türkçe) hata."""


def check_path(path: str) -> str:
    """Mutlak, normalize edilmiş yol döner; göreli ya da NUL içeren yolu reddeder."""
    if not isinstance(path, str) or not path.startswith("/") or "\0" in path:
        raise RemoteError("Geçersiz yol.")
    return posixpath.normpath(path) if path != "/" else "/"


def check_name(name: str) -> str:
    """Tek bir dizin girdisi adı: boş, ".", "..", "/" ya da NUL içeremez."""
    if not isinstance(name, str) or name in ("", ".", "..") or "/" in name or "\0" in name or len(name) > 255:
        raise RemoteError("Geçersiz ad.")
    return name


def ssh_command(access: dict, script: str, *args: str) -> tuple[list[str], dict]:
    """sshpass+ssh komut satırı ve ortamı. access: {ip, user, password}."""
    remote = "sh -c " + shlex.quote(script) + " sh " + " ".join(shlex.quote(a) for a in args)
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, f"{access['user']}@{access['ip']}", remote]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": access["password"]}
    return cmd, env


def _error(rc: int, err: str) -> RemoteError:
    if rc == 5:
        return RemoteError("SSH parolası reddedildi.")
    if rc == 255:
        return RemoteError("Tahtaya SSH ile ulaşılamadı.")
    lines = [line for line in err.strip().splitlines() if line.strip()]
    return RemoteError(lines[-1][:300] if lines else f"İşlem başarısız (çıkış {rc}).")


async def run(access: dict, script: str, *args: str, timeout: float = 60) -> bytes:
    """Betiği tahtada çalıştırır; başarıda stdout döner, başarısızlıkta RemoteError fırlatır."""
    cmd, env = ssh_command(access, script, *args)
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, env=env,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise RemoteError(f"Zaman aşımı ({int(timeout)} sn).")
    if proc.returncode != 0:
        raise _error(proc.returncode, err.decode("utf-8", "replace"))
    return out


# Dizin listesi: girdi başına "tür\thedef türü\tboyut\tsahip\tgrup\tizin(sekizlik)\tmtime\tad\0".
# Sahip/grup adları tahtanın kendi kullanıcı veritabanından çözülür (sayısal uid değil). İlk satır
# dizinin kendisi (sahip/grup/izin + gerçek yol).
_LIST = r"""
cd -- "$1" 2>/dev/null || { echo "Dizin açılamadı: $1" >&2; exit 3; }
printf '%s\t%s\t%s\t%s\0' "$(stat -c '%U' .)" "$(stat -c '%G' .)" "$(stat -c '%a' .)" "$(pwd -P)"
find . -mindepth 1 -maxdepth 1 -printf '%y\t%Y\t%s\t%u\t%g\t%m\t%T@\t%f\0' 2>/dev/null
exit 0
"""


async def listdir(access: dict, path: str) -> dict:
    path = check_path(path)
    out = await run(access, _LIST, path, timeout=30)
    records = out.split(b"\0")
    head = records[0].decode("utf-8", "replace").split("\t")
    items = []
    for rec in records[1:]:
        if not rec:
            continue
        parts = rec.decode("utf-8", "replace").split("\t", 7)
        if len(parts) != 8:
            continue
        kind, target, size, user, group, mode, mtime, name = parts
        is_dir = kind == "d" or (kind == "l" and target == "d")
        items.append({
            "name": name,
            "type": "dir" if is_dir else ("link" if kind == "l" else "file"),
            "link": kind == "l",
            "size": int(size) if size.isdigit() else 0,
            "user": user,
            "group": group,
            "mode": _mode_text(kind, mode),
            "octal": mode,
            "mtime": int(float(mtime)) if mtime.replace(".", "", 1).isdigit() else 0,
        })
    return {
        "path": path,
        "real": head[3] if len(head) > 3 else path,
        "owner": head[0] if head else "",
        "group": head[1] if len(head) > 1 else "",
        "mode": _mode_text("d", head[2]) if len(head) > 2 else "",
        "items": items,
    }


def _mode_text(kind: str, octal: str) -> str:
    """"755" → "drwxr-xr-x" (ls -l biçimi; özel bitler s/t olarak)."""
    try:
        m = int(octal, 8)
    except ValueError:
        return octal
    text = {"d": "d", "l": "l"}.get(kind, "-")
    for shift, special, ch in ((6, 0o4000, "s"), (3, 0o2000, "s"), (0, 0o1000, "t")):
        bits = (m >> shift) & 7
        x = bits & 1
        sp = m & special
        text += ("r" if bits & 4 else "-") + ("w" if bits & 2 else "-")
        text += (ch if x else ch.upper()) if sp else ("x" if x else "-")
    return text


_PROTECTED = {"/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/proc", "/root", "/run",
              "/sbin", "/sys", "/tmp", "/usr", "/var"}


async def delete(access: dict, paths: list[str]) -> None:
    paths = [check_path(p) for p in paths]
    if not paths:
        raise RemoteError("Silinecek öğe seçilmedi.")
    bad = [p for p in paths if p in _PROTECTED]
    if bad:
        raise RemoteError(f"Sistem dizini silinemez: {bad[0]}")
    await run(access, 'rm -rf -- "$@"', *paths, timeout=300)


async def rename(access: dict, path: str, new_name: str) -> str:
    path = check_path(path)
    new_name = check_name(new_name)
    if path in _PROTECTED:
        raise RemoteError("Sistem dizininin adı değiştirilemez.")
    target = posixpath.join(posixpath.dirname(path), new_name)
    # -n + varlık denetimi: aynı adlı bir öğenin üzerine yazılmaz.
    await run(access, '[ -e "$2" ] && { echo "Bu adda bir öğe zaten var." >&2; exit 4; }; mv -n -T -- "$1" "$2"',
              path, target, timeout=30)
    return target


async def mkdir(access: dict, parent: str, name: str) -> str:
    parent = check_path(parent)
    name = check_name(name)
    target = posixpath.join(parent, name)
    # Yeni klasör, içinde oluşturulduğu dizinin sahibine verilir (ör. /home/ali altında ali:ali).
    await run(access, 'mkdir -- "$2" && chown --reference="$1" -- "$2"', parent, target, timeout=30)
    return target
