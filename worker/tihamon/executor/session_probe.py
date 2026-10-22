"""Tahtadaki grafik oturumun ANLIK durumu: kim oturum açmış, ekran kilitli mi (SSH + loginctl).

Tahtalar grid'inin "Oturum" sütununu besler (bkz. tasks/session_probe.py periyodik yoklama,
boards.session_username/session_locked/session_checked_at — migration 012).

ETAP'ta ekran kilidi LightDM'in `dm-tool lock`'udur (Cinnamon'un custom-screensaver-command'ı):
kilitlenince kullanıcının oturumu AÇIK kalır ama pasifleşir, seat0'da giriş ekranı (greeter) aktif
olur. Bu yüzden "kilitli" = seat0'da kullanıcı oturumu var ama hiçbiri aktif değil — ya da logind'in
LockedHint'i (başka bir kilit programı kullanılırsa) "yes". Uzak (SSH, Seat boş) oturumlar sayılmaz.
"""

from __future__ import annotations

import json
import os
import subprocess

from . import autoshutdown, netif

# Son satır: etkin VT'deki X'in monitör güç durumu ("M On|Off|Standby|Suspend" — bkz. 025_board_display_state.sql;
# X seçimi screen/remote.py ile aynı).
_SCRIPT = r"""
for s in $(loginctl list-sessions --no-legend 2>/dev/null | awk '$4 == "seat0" {print $1}'); do
  echo "S"
  loginctl show-session "$s" -p Name -p Class -p Active -p LockedHint 2>/dev/null
done
vt=$(cat /sys/class/tty/tty0/active 2>/dev/null)
set -- $(ps -eo args= | awk -v vt="vt${vt#tty}" '
  $1 ~ /(^|\/)Xorg$/ { d = ""; a = ""; m = 0
    for (i = 2; i <= NF; i++) { if ($i ~ /^:[0-9]+$/) d = $i; if ($i == "-auth") a = $(i + 1); if ($i == vt) m = 1 }
    if (m && d != "") { print d, a; exit } }')
[ -n "$1" ] && echo "M $(DISPLAY="$1" XAUTHORITY="$2" xset q 2>/dev/null | awk '/Monitor is/ { print $3 }')"
""" + netif.SCRIPT + autoshutdown.SCRIPT
# Aynı SSH turunda: ağ arabirimleri (NI/ND/NM/NW/NR satırları, bkz. executor/netif.py) ve TiHA otomatik
# kapatma geri sayımı (SD satırı, bkz. executor/autoshutdown.py) — Ekranlar önizlemesinin alt barı için.

_SSH_OPTS = [
    "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
]


def display_state(output: str) -> str:
    """Betiğin "M <durum>" satırından monitör durumu ("On", "Off", "Standby", "Suspend"; bilinmiyorsa "")."""
    for line in output.splitlines():
        if line.startswith("M "):
            state = line[2:].strip()
            return state if state in ("On", "Off", "Standby", "Suspend") else ""
    return ""


def parse(output: str) -> tuple[str | None, bool]:
    """loginctl çıktısından (kullanıcı ya da None, kilitli mi)."""
    sessions: list[dict] = []
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("M "):
            continue
        if line == "S":
            sessions.append({})
        elif "=" in line and sessions:
            key, _, value = line.partition("=")
            if " " not in key:  # loginctl anahtarları boşluksuz; ek bölümlerin satırları (SD …) karışmasın
                sessions[-1][key] = value
    users = [s for s in sessions if s.get("Class") == "user" and s.get("Name") and s.get("Name") != "lightdm"]
    if not users:
        return None, False
    active = next((s for s in users if s.get("Active") == "yes"), None)
    if active:
        return active["Name"], active.get("LockedHint") == "yes"
    return users[0]["Name"], True   # oturum açık ama seat0'da greeter aktif: dm-tool lock


def probe(board: dict, user: str, password: str, timeout: int = 8) -> dict:
    """Döner: {"ok": bool, "user": str|None, "locked": bool, "display": str, "netifs": dict|None,
    "shutdown": dict|None, "error": str}."""
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
    out = proc.stdout.decode("utf-8", "replace")
    name, locked = parse(out)
    return {"ok": True, "user": name, "locked": locked, "display": display_state(out),
            "netifs": netif.parse(out), "shutdown": autoshutdown.parse(out), "error": ""}


def store_extras(conn, board_id: int, res: dict) -> None:
    """Ağ arabirimleri ve otomatik kapatma durumunu yazar (bkz. göç 026; None = bilinmiyor/yok)."""
    conn.execute(
        "UPDATE boards SET netifs = %s::jsonb, autoshutdown = %s::jsonb WHERE id = %s",
        (json.dumps(res.get("netifs")) if res.get("netifs") else None,
         json.dumps(res.get("shutdown")) if res.get("shutdown") else None, board_id))


def store_display(conn, board_id: int, state: str) -> None:
    """Monitör güç durumunu yazar ("" = bilinmiyor → NULL)."""
    conn.execute("UPDATE boards SET display_state = NULLIF(%s, '') WHERE id = %s", (state, board_id))


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
