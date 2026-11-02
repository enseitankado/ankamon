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

"""Sağ menü Ekran ▸ "Ekran görüntüsü al": tahtanın etkin X ekranından tek kare JPEG (tahtadaki ffmpeg, kurulum yok).

Dosya /data/screenshots/<tahta id>/<zaman>-<rastgele>.jpg olarak saklanır, satırı `screenshots` tablosundadır
(zaman çizelgesi ve Disk kullanımı oradan okur). Oturum kayıtları silinse de görüntünün kimliği kaybolmasın
diye bilgiler JPEG'in yorum (COM) bölümüne JSON olarak gömülür: hangi bilgisayar, hangi oturum, ne zaman, kim çekti
(okumak için: exiftool -Comment, identify -format %c ya da read_embedded_meta).
"""

from __future__ import annotations

import json
import os
import pwd
import secrets
import shlex
import struct
import subprocess
from datetime import datetime

from .accounts import _SSH_OPTS
from .display import _ACTIVE_X

BASE_DIR = os.environ.get("SCREENSHOT_DIR", "/data/screenshots")
META_KEY = "ankamon_screenshot"

_CAPTURE = _ACTIVE_X + r"""
command -v ffmpeg >/dev/null 2>&1 || { echo "Tahtada ffmpeg yok." >&2; exit 4; }
exec ffmpeg -nostdin -hide_banner -loglevel error -f x11grab -i "$DISPLAY" -frames:v 1 -q:v 3 -f image2pipe -c:v mjpeg -
"""


def embed_meta(jpeg: bytes, meta: dict) -> bytes:
    """JPEG'e SOI'dan hemen sonra COM bölümü ekler (bölüm en çok 65533 bayt — meta bunun çok altında)."""
    payload = json.dumps({META_KEY: 1, **meta}, ensure_ascii=False).encode("utf-8")
    return jpeg[:2] + b"\xff\xfe" + struct.pack(">H", len(payload) + 2) + payload + jpeg[2:]


def read_embedded_meta(jpeg: bytes) -> dict | None:
    """embed_meta'nın yazdığı bilgiyi okur (yoksa None)."""
    if jpeg[:4] != b"\xff\xd8\xff\xfe":
        return None
    size = struct.unpack(">H", jpeg[4:6])[0]
    try:
        meta = json.loads(jpeg[6:4 + size].decode("utf-8"))
    except ValueError:
        return None
    return meta if META_KEY in meta else None


def _session_of(conn, board_id: int) -> dict | None:
    """Tahtadaki açık oturum: log tabanlı kaydın kimliği + kullanıcı; kayıt yoksa anlık yoklamadaki kullanıcı."""
    row = conn.execute(
        """SELECT id, username, extract(epoch FROM started_at)::bigint AS started_at FROM board_sessions
           WHERE board_id = %s AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1""", (board_id,)).fetchone()
    if row:
        return dict(row)
    row = conn.execute("SELECT session_username FROM boards WHERE id = %s", (board_id,)).fetchone()
    return {"id": None, "username": row["session_username"], "started_at": None} if row and row["session_username"] else None


def _store(path: str, data: bytes) -> None:
    """PHP (nobody) silebilsin, nginx verebilsin; gizli veri sayılır (herkese açık değil)."""
    uid = pwd.getpwnam("nobody").pw_uid
    import grp
    gid = grp.getgrnam("nginx").gr_gid
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    os.chown(folder, uid, gid)
    os.chmod(folder, 0o750)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())          # ani güç kesintisine karşı: yarım dosya kayda geçmesin
    os.chown(tmp, uid, gid)
    os.chmod(tmp, 0o640)
    os.rename(tmp, path)


def take(conn, board: dict, user: str, password: str, taken_by: str) -> dict:
    """Görüntüyü alır, kimliği gömüp kaydeder. Döner: {"status", "rc", "output"} (bkz. accounts._ssh)."""
    if not board.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, "-o", "ConnectTimeout=8", f"{user}@{board['ip']}", "sh -c " + shlex.quote(_CAPTURE)]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=30)
    except subprocess.TimeoutExpired:
        return {"status": "failed", "rc": None, "output": "Zaman aşımı (30 sn)."}
    if proc.returncode in (5, 255):
        return {"status": "unreachable", "rc": proc.returncode, "output": "SSH ile ulaşılamadı."}
    if proc.returncode != 0 or proc.stdout[:2] != b"\xff\xd8":
        text = (proc.stderr or proc.stdout[:300]).decode("utf-8", "replace").strip()
        return {"status": "failed", "rc": proc.returncode, "output": text or "Görüntü alınamadı."}

    now = datetime.now().astimezone()
    extra = conn.execute("SELECT hostname, host(ip) AS ip, mac::text AS mac FROM boards WHERE id = %s", (board["board_id"],)).fetchone() or {}
    session = _session_of(conn, board["board_id"])
    meta = {
        "board": {"id": board["board_id"], "name": board.get("name"), "hostname": extra.get("hostname"),
                  "ip": extra.get("ip"), "mac": extra.get("mac")},
        "session": session,
        "taken_at": now.isoformat(timespec="seconds"),
        "taken_by": taken_by,
    }
    rel = f"{board['board_id']}/{now.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(4)}.jpg"
    data = embed_meta(proc.stdout, meta)
    _store(os.path.join(BASE_DIR, rel), data)
    conn.execute(
        """INSERT INTO screenshots (board_id, board_name, session_id, session_username, taken_at, taken_by, file, bytes)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (board["board_id"], board.get("name") or "?", session["id"] if session else None,
         session["username"] if session else None, now, taken_by, rel, len(data)))
    who = f"oturum: {session['username']}" if session else "oturum yok"
    return {"status": "ok", "rc": 0, "output": f"Ekran görüntüsü alındı ({len(data) // 1024} KB, {who})."}
