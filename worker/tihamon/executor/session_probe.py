"""Tahtadaki grafik oturumun ANLIK durumu: kim oturum açmış, ekran kilitli mi (SSH + loginctl).

Tahtalar grid'inin "Oturum" sütununu besler (bkz. tasks/session_probe.py periyodik yoklama,
boards.session_username/session_locked/session_checked_at — migration 012).

ETAP'ta ekran kilidi LightDM'in `dm-tool lock`'udur (Cinnamon'un custom-screensaver-command'ı):
kilitlenince kullanıcının oturumu AÇIK kalır ama pasifleşir, seat0'da giriş ekranı (greeter) aktif
olur. Bu yüzden "kilitli" = seat0'da kullanıcı oturumu var ama hiçbiri aktif değil — ya da logind'in
LockedHint'i (başka bir kilit programı kullanılırsa) "yes". Uzak (SSH, Seat boş) oturumlar sayılmaz.
"""

from __future__ import annotations

import os
import subprocess

_SCRIPT = r"""
for s in $(loginctl list-sessions --no-legend 2>/dev/null | awk '$4 == "seat0" {print $1}'); do
  echo "S"
  loginctl show-session "$s" -p Name -p Class -p Active -p LockedHint 2>/dev/null
done
"""

_SSH_OPTS = [
    "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
]


def parse(output: str) -> tuple[str | None, bool]:
    """loginctl çıktısından (kullanıcı ya da None, kilitli mi)."""
    sessions: list[dict] = []
    for line in output.splitlines():
        line = line.strip()
        if line == "S":
            sessions.append({})
        elif "=" in line and sessions:
            key, _, value = line.partition("=")
            sessions[-1][key] = value
    users = [s for s in sessions if s.get("Class") == "user" and s.get("Name") and s.get("Name") != "lightdm"]
    if not users:
        return None, False
    active = next((s for s in users if s.get("Active") == "yes"), None)
    if active:
        return active["Name"], active.get("LockedHint") == "yes"
    return users[0]["Name"], True   # oturum açık ama seat0'da greeter aktif: dm-tool lock


def probe(board: dict, user: str, password: str, timeout: int = 8) -> dict:
    """Döner: {"ok": bool, "user": str|None, "locked": bool, "error": str}."""
    if not board.get("ip"):
        return {"ok": False, "user": None, "locked": False, "error": "IP yok"}
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, "-o", f"ConnectTimeout={min(timeout, 6)}",
           f"{user}@{board['ip']}", _SCRIPT]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"ok": False, "user": None, "locked": False, "error": "zaman aşımı"}
    if proc.returncode != 0:
        return {"ok": False, "user": None, "locked": False, "error": f"ssh çıkış kodu {proc.returncode}"}
    name, locked = parse(proc.stdout.decode("utf-8", "replace"))
    return {"ok": True, "user": name, "locked": locked, "error": ""}


def store(conn, board_id: int, user: str | None, locked: bool | None = None) -> None:
    """Tahtanın oturum durumunu yazar. user boş/None = oturum kapalı. locked None ise (ör. `who`
    tabanlı "Oturumları sorgula" kilidi bilmez) kullanıcı değişmediyse önceki kilit durumu korunur,
    değiştiyse kilitsiz sayılır — bir sonraki periyodik yoklama kesinleştirir."""
    conn.execute(
        """UPDATE boards SET
               session_locked = CASE WHEN %(locked)s::boolean IS NOT NULL THEN %(locked)s::boolean
                                     WHEN session_username IS NOT DISTINCT FROM %(user)s THEN session_locked
                                     ELSE false END,
               session_username = %(user)s,
               session_checked_at = now()
           WHERE id = %(id)s""",
        {"user": (user or "").strip() or None, "locked": locked, "id": board_id})
