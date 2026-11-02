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

"""Sağ menü Ekran ▸ "Ekranı başka bilgisayara aktar": bir tahtanın ekranı seçili tahtalarda tam ekran görünür.

Akış: kaynak tahtada ffmpeg (hazır gelir) etkin X ekranını yakalar, H.264 ile MediaMTX'e RTSP yayınlar (yol adı
"r-<rastgele>", bkz. services/mediamtx.sh); hedef tahtalarda "Ekranımı yansıt"ın oynatıcısı (executor/cast.py: kaplama +
mpv, kısa kesintilerde yeniden bağlanır, bitince ekranı eski hâline getirir) aynı yolu okur. Yeniden kodlama yok, sunucuda
işlemci yükü çok düşük; yük kaynak tahtadadır (bir kodlayıcı, hedef sayısından bağımsız).

Kaynakta sarmalayıcı (/run/ankamon-relay/run.sh): etkin VT değişirse (oturum açma, kullanıcı değiştirme) yeni ekrana geçer.
Durum `screen_relays` tablosunda (hedef başına bir satır); durdurma hedefi de kaynağı da kabul eder ve geride hedefi
kalmayan kaynaktaki yayını da kapatır. /run tahta yeniden başlayınca silinir: kapanan tahtada yayın kendiliğinden biter.
Görüntü aktarılır, ses aktarılmaz.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.request

from . import cast
from .accounts import _ssh

API_PORT = int(os.environ.get("CAST_API_PORT", "9997"))
STREAM_RE = re.compile(r"^r-[A-Za-z0-9]{24,64}$")

# Kaynak: yakalama ve kodlama. 1920 genişlik sınırı: tahta yazıları okunur kalsın; ultrafast + zerolatency: zayıf
# işlemcide de gecikme düşük; ana profil dışı özellik kullanmaz, mpv donanımsal çözebilir.
_WRAPPER = r"""#!/bin/sh
URL=__URL__
DIR=/run/ankamon-relay
echo $$ > "$DIR/pid"
export HOME="$DIR"
ff=
trap '[ -n "$ff" ] && kill "$ff" 2>/dev/null; rm -f "$DIR/pid"; exit 0' TERM INT HUP
while :; do
  vt=$(cat /sys/class/tty/tty0/active 2>/dev/null)
  set -- $(ps -eo args= | awk -v vt="vt${vt#tty}" '
    $1 ~ /(^|\/)Xorg$/ { d = ""; a = ""; m = 0
      for (i = 2; i <= NF; i++) { if ($i ~ /^:[0-9]+$/) d = $i; if ($i == "-auth") a = $(i + 1); if ($i == vt) m = 1 }
      if (m && d != "") { print d, a; exit } }')
  if [ -z "$1" ]; then sleep 2; continue; fi
  DISPLAY="$1" XAUTHORITY="$2" ffmpeg -nostdin -hide_banner -loglevel warning -f x11grab -framerate 15 -i "$1" \
    -vf "scale='min(1920,iw)':-2" -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 30 \
    -b:v 3000k -maxrate 4000k -bufsize 2000k -an -f rtsp -rtsp_transport tcp "$URL" &
  ff=$!
  while kill -0 "$ff" 2>/dev/null; do
    sleep 2
    now=$(cat /sys/class/tty/tty0/active 2>/dev/null)
    if [ "$now" != "$vt" ]; then kill "$ff" 2>/dev/null; break; fi
  done
  wait "$ff" 2>/dev/null
  ff=
  sleep 1
done
"""

_START = r"""
command -v ffmpeg >/dev/null 2>&1 || { echo "Kaynak tahtada ffmpeg yok." >&2; exit 3; }
DIR=/run/ankamon-relay
mkdir -p "$DIR"; chmod 700 "$DIR"
[ -s "$DIR/pid" ] && pkill -TERM -g "$(cat "$DIR/pid")" 2>/dev/null && sleep 1
cat > "$DIR/run.sh" <<'ANKAMON_EOF'
__WRAPPER__
ANKAMON_EOF
setsid sh "$DIR/run.sh" >"$DIR/log" 2>&1 </dev/null &
echo "Kaynak ekran yakalanıyor."
"""

_STOP = r"""
DIR=/run/ankamon-relay
if [ -s "$DIR/pid" ]; then
  p=$(cat "$DIR/pid")
  pkill -TERM -g "$p" 2>/dev/null
  i=0; while kill -0 "$p" 2>/dev/null && [ $i -lt 10 ]; do sleep 0.3; i=$((i + 1)); done
  pkill -KILL -g "$p" 2>/dev/null
fi
rm -rf "$DIR"
echo "Kaynak ekran yayını durduruldu."
"""


def _published(stream: str, wait_seconds: int = 12) -> bool:
    """MediaMTX'te yayın başladı mı (denetim API'si yalnız 127.0.0.1)."""
    url = f"http://127.0.0.1:{API_PORT}/v3/paths/get/{stream}"
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as res:
                if json.load(res).get("ready"):
                    return True
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    return False


def start_source(board: dict, user: str, password: str, stream: str) -> dict:
    """Kaynakta yayını başlatır, MediaMTX'te görünene dek bekler. Döner: {"status", "rc", "output"}."""
    if not STREAM_RE.match(stream):
        return {"status": "failed", "rc": None, "output": "Geçersiz yayın adı."}
    wrapper = _WRAPPER.replace("__URL__", cast.stream_url(board["ip"], stream))
    result = _ssh(board, user, password, _START.replace("__WRAPPER__", wrapper), timeout=20)
    if result["status"] != "ok":
        return result
    if not _published(stream):
        stop_source(board, user, password)
        return {"status": "failed", "rc": None, "output": "Kaynak tahtadan yayın gelmedi (ffmpeg başlamadı ya da sunucuya ulaşamadı)."}
    return result


def stop_source(board: dict, user: str, password: str) -> dict:
    return _ssh(board, user, password, _STOP, timeout=15)


def _board(conn, board_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id AS board_id, host(ip) AS ip, COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name FROM boards WHERE id = %s",
        (board_id,)).fetchone()
    return dict(row) if row else None


def start(conn, source_id: int, targets: list[dict], stream: str, started_by: str, user: str, password: str, on_target) -> None:
    """Kaynağı başlatır, sonra hedefleri on_target'a devreder: on_target(work) her hedef için `work(t) -> sonuç` çalıştırır
    (runner paralel yürütür, sonuçları {tahta: sonuç} döner); başarılılar tabloya yazılır."""
    source = _board(conn, source_id)
    if source is None or not source["ip"]:
        raise RuntimeError("Kaynak tahta bulunamadı.")
    # Aynı kaynağın önceki yayını sürüyorsa hedefleri korunur: yeni yayın adına geçilir.
    previous = conn.execute("SELECT target_board_id FROM screen_relays WHERE source_board_id = %s", (source_id,)).fetchall()
    # Hedefler başka bir kaynaktan buraya geçebilir: o kaynakta hedef kalmazsa yayını sonda kapatılır.
    moved_from = {r["source_board_id"] for r in conn.execute(
        "SELECT source_board_id FROM screen_relays WHERE target_board_id = ANY(%s) AND source_board_id <> %s",
        ([t["board_id"] for t in targets], source_id)).fetchall()}
    res = start_source(source, user, password, stream)
    if res["status"] != "ok":
        raise RuntimeError(f"{source['name']}: {res['output']}")

    def work(t):
        return cast.start(t, user, password, stream, False)

    done = on_target(work)
    for t in targets:
        if done.get(t["board_id"], {}).get("status") == "ok":
            conn.execute(
                """INSERT INTO screen_relays (target_board_id, source_board_id, stream, started_by) VALUES (%s, %s, %s, %s)
                   ON CONFLICT (target_board_id) DO UPDATE SET source_board_id = EXCLUDED.source_board_id,
                       stream = EXCLUDED.stream, started_by = EXCLUDED.started_by, started_at = now()""",
                (t["board_id"], source_id, stream, started_by))
    # Önceki hedefler yeni yayını da göstersin (kaynak ffmpeg'i yeniden başladı).
    wanted = {t["board_id"] for t in targets}
    for row in previous:
        if row["target_board_id"] not in wanted:
            old = _board(conn, row["target_board_id"])
            if old and cast.start(old, user, password, stream, False)["status"] == "ok":
                conn.execute("UPDATE screen_relays SET stream = %s WHERE target_board_id = %s", (stream, row["target_board_id"]))
    if not conn.execute("SELECT 1 FROM screen_relays WHERE source_board_id = %s LIMIT 1", (source_id,)).fetchone():
        stop_source(source, user, password)
        raise RuntimeError("Hiçbir hedef tahtada görüntü açılamadı.")
    _release_orphans(conn, user, password, moved_from)


def stop(conn, board: dict, user: str, password: str) -> dict:
    """Bu tahtadaki aktarımı durdurur: kaynaksa bütün hedefleri, hedefse yalnız kendisini normale döndürür."""
    lines = []
    rows = conn.execute(
        "SELECT target_board_id, source_board_id FROM screen_relays WHERE source_board_id = %s OR target_board_id = %s",
        (board["board_id"], board["board_id"])).fetchall()
    sources = {r["source_board_id"] for r in rows}
    for row in rows:
        target = _board(conn, row["target_board_id"])
        res = cast.stop(target, user, password) if target else {"status": "ok", "output": ""}
        name = target["name"] if target else row["target_board_id"]
        if res["status"] == "ok":
            lines.append(f"{name}: ekran normale döndü.")
        else:
            # Kapalı hedef: yayın zaten bitti; kaydı tutmanın anlamı yok.
            lines.append(f"{name}: ulaşılamadı ({res['output']}); yayın bitince oynatıcı kendisi kapanır.")
        conn.execute("DELETE FROM screen_relays WHERE target_board_id = %s", (row["target_board_id"],))
    if not rows:
        res = stop_source(board, user, password)    # kayıt yok ama kalmış olabilir
        return {"status": res["status"], "rc": res["rc"], "output": "Bu tahtada ekran aktarımı yoktu."}
    # Hedef durdurulduysa kaynağında başka hedef kalmamış olabilir; kaynaksa kendisi.
    lines.extend(_release_orphans(conn, user, password, sources | {board["board_id"]}))
    return {"status": "ok", "rc": 0, "output": "\n".join(lines)}


def _release_orphans(conn, user: str, password: str, candidates: set[int]) -> list[str]:
    """Verilen tahtalardan hedefi kalmayanlarda kaynak yayınını kapatır."""
    out = []
    for board_id in candidates:
        if conn.execute("SELECT 1 FROM screen_relays WHERE source_board_id = %s LIMIT 1", (board_id,)).fetchone():
            continue
        board = _board(conn, board_id)
        if board and board["ip"]:
            res = stop_source(board, user, password)
            if res["status"] == "ok":
                out.append(f"{board['name']}: {res['output']}")
    return out
