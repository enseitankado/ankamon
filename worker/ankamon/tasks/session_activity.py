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

"""Oturum hareketleri: loglar, sensörler ve Ankamon işlemleri → session_activity (Oturumlar ▸ Hareketler).

Artımlıdır (task_cursors): her turda yalnız yeni satırlar işlenir, ilk çalışmada eldeki bütün loglar birkaç tura yayılarak
taranır. Ekran bu tablodan okur; süzmede loglara hiç gidilmez. Olay, o anda o bilgisayarda açık olan oturuma yazılır
(oturum yoksa kullanıcısız); silinen satır yeniden üretilmez, çünkü imleç geri gitmez.
"""

from __future__ import annotations

import datetime
import logging
import re
import subprocess

from .. import session_activity_rules as rules

log = logging.getLogger(__name__)

_BATCH = 5000
_MAX_BATCHES = 20
_LAG = datetime.timedelta(seconds=20)         # oturum kaydı önce yazılsın (board_sessions hızlı döngüde)
_SENSOR_LAG = datetime.timedelta(minutes=15)  # 5 dk özetleri gecikmeli tazelenir
_EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)

NET_MB = 200       # 5 dakikada bu kadar MB ağ trafiği "yoğun" sayılır
_REPEAT = datetime.timedelta(minutes=10)   # süren yüksek yük her 5 dk'da bir ayrı olay olmasın


def _local_addresses() -> set[str]:
    """Bu sunucunun adresleri: Ankamon'un kendi SSH bağlantıları hareket sayılmaz."""
    try:
        out = subprocess.run(["ip", "-o", "-4", "addr"], capture_output=True, text=True, timeout=5).stdout
    except OSError:
        return set()
    return set(re.findall(r"inet (\d+\.\d+\.\d+\.\d+)/", out))


def _cursor(conn, name: str) -> datetime.datetime:
    row = conn.execute("SELECT value FROM task_cursors WHERE name = %s", (name,)).fetchone()
    return row["value"] if row else _EPOCH


def _save_cursor(conn, name: str, value) -> None:
    conn.execute(
        """INSERT INTO task_cursors (name, value, updated_at) VALUES (%s, %s, now())
           ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""", (name, value))


class _Sessions:
    """Bir zaman aralığındaki oturumlar: tahta/host + an → oturum."""

    def __init__(self, conn, start, end):
        rows = conn.execute(
            """SELECT id, host, board_id, username, started_at, ended_at FROM board_sessions
               WHERE started_at <= %s AND (ended_at IS NULL OR ended_at >= %s)""", (end, start)).fetchall()
        self.by_host: dict[str, list] = {}
        self.by_board: dict[int, list] = {}
        for r in rows:
            self.by_host.setdefault(r["host"].lower(), []).append(r)
            if r["board_id"]:
                self.by_board.setdefault(r["board_id"], []).append(r)

    @staticmethod
    def _at(rows, when):
        hit = [r for r in rows or [] if r["started_at"] <= when and (r["ended_at"] is None or r["ended_at"] >= when)]
        return max(hit, key=lambda r: r["started_at"]) if hit else None

    def host(self, host, when):
        return self._at(self.by_host.get(host), when)

    def board(self, board_id, when):
        return self._at(self.by_board.get(board_id), when)


def _insert(conn, rows: list[tuple]) -> None:
    if rows:
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO session_activity (at, board_id, board_name, session_id, username, kind, summary, detail, source)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""", rows)


def _boards(conn):
    rows = conn.execute(
        """SELECT id, lower(hostname) AS host, COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name,
                  COALESCE((facts->>'cpu_cores')::int, 4) AS cores FROM boards""").fetchall()
    return {r["host"]: r for r in rows if r["host"]}, {r["id"]: r for r in rows}


def _from_logs(conn, by_host) -> None:
    own = _local_addresses()
    seen_apps: set = set()
    for _ in range(_MAX_BATCHES):
        since = _cursor(conn, "session_activity.logs")
        rows = conn.execute(
            """SELECT received_at, host, program, message FROM logs
               WHERE received_at > %s AND received_at < %s AND program = ANY(%s)
               ORDER BY received_at LIMIT %s""",
            (since, datetime.datetime.now(datetime.timezone.utc) - _LAG, rules.PROGRAMS, _BATCH)).fetchall()
        if not rows:
            return
        sessions = _Sessions(conn, rows[0]["received_at"], rows[-1]["received_at"])
        out = []
        for r in rows:
            host = (r["host"] or "").lower()
            message = r["message"] or ""
            session = sessions.host(host, r["received_at"])
            if r["program"] in rules.APP_PROGRAMS:
                # Uygulama logu: oturumda (yoksa o saatte) yalnız ilk görülüşü "açıldı" sayılır.
                key = (host, r["program"], session["id"] if session else r["received_at"].strftime("%F %H"))
                if key in seen_apps:
                    continue
                seen_apps.add(key)
                hit = ("uygulama", f"Uygulama çalışıyor: {rules.APP_PROGRAMS[r['program']]}", None)
            else:
                hit = rules.classify(r["program"], message)
            if not hit or (r["program"] == "sshd" and any(f"({ip})" in hit[1] for ip in own)):
                continue
            board = by_host.get(host)
            out.append((r["received_at"], board["id"] if board else None, board["name"] if board else r["host"],
                        session["id"] if session else None, session["username"] if session else hit[2],
                        hit[0], hit[1], message[:1000], r["program"]))
        with conn.transaction():
            _insert(conn, out)
            _save_cursor(conn, "session_activity.logs", rows[-1]["received_at"])
        if len(rows) < _BATCH:
            return


def _from_ankamon(conn, by_id) -> None:
    """Ankamon'dan o tahtaya yapılan işlemler: komutlar, ekran izleme, dosya işlemleri, ekran görüntüsü, sohbet."""
    since = _cursor(conn, "session_activity.ankamon")
    rows = conn.execute(
        """SELECT at, board_id, board_name, kind, text, source FROM (
             SELECT time AS at, board_id, board_name, 'komut' AS kind, username || ': ' || left(command, 240) AS text, source
               FROM command_log WHERE time > %(s)s AND board_id IS NOT NULL
             UNION ALL SELECT taken_at, board_id, board_name, 'goruntu', taken_by || ': ekran görüntüsü aldı', 'screenshot'
               FROM screenshots WHERE taken_at > %(s)s AND board_id IS NOT NULL
             UNION ALL SELECT sent_at, board_id, board_name, 'sohbet', author || ': sohbet iletisi', 'chat'
               FROM chat_messages WHERE sent_at > %(s)s AND board_id IS NOT NULL
           ) x WHERE at < now() ORDER BY at LIMIT %(n)s""", {"s": since, "n": _BATCH}).fetchall()
    if not rows:
        return
    sessions = _Sessions(conn, rows[0]["at"], rows[-1]["at"])
    out = []
    for r in rows:
        session = sessions.board(r["board_id"], r["at"])
        out.append((r["at"], r["board_id"], r["board_name"], session["id"] if session else None,
                    session["username"] if session else None, "ankamon", "Ankamon — " + r["text"], None, r["source"]))
    with conn.transaction():
        _insert(conn, out)
        _save_cursor(conn, "session_activity.ankamon", rows[-1]["at"])


def _from_sensors(conn, by_id) -> None:
    """5 dk özetlerinden: yüksek işlemci yükü ve yoğun ağ trafiği (ne zaman ağır iş yapıldığına işaret)."""
    since = _cursor(conn, "session_activity.sensors")
    if since == _EPOCH:
        since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30)
    until = datetime.datetime.now(datetime.timezone.utc) - _SENSOR_LAG
    rows = conn.execute(
        r"""SELECT t.board_id::int AS board_id, m.time, t.name,
                   CASE WHEN t.name = 'node_load1' THEN max(m.max) ELSE sum(m.max - m.min) END AS v
            FROM metrics_5m m JOIN metrics_tag t USING (tag_id)
            WHERE m.time > %s AND m.time <= %s AND t.board_id ~ '^\d+$'
              AND (t.name = 'node_load1' OR (t.name IN ('node_network_receive_bytes_total', 'node_network_transmit_bytes_total')
                   AND t.device <> 'lo' AND t.device !~ '^(docker|veth|br-)'))
            GROUP BY 1, 2, 3 ORDER BY 2 LIMIT 50000""", (since, until)).fetchall()
    if not rows:
        return
    sessions = _Sessions(conn, rows[0]["time"], rows[-1]["time"])
    out, last = [], {}
    for r in rows:
        board = by_id.get(r["board_id"])
        if not board or r["v"] is None:
            continue
        if r["name"] == "node_load1":
            if r["v"] < board["cores"]:
                continue
            source, text = "sensor:cpu", f"Yüksek işlemci yükü (yük {r['v']:.1f}, {board['cores']} çekirdek)"
        else:
            mb = r["v"] / 1048576
            if mb < NET_MB:
                continue
            down = "receive" in r["name"]
            source, text = "sensor:rx" if down else "sensor:tx", f"Yoğun ağ {'indirme' if down else 'yükleme'} (5 dakikada {mb:.0f} MB)"
        key = (r["board_id"], source)
        if key in last and r["time"] - last[key] <= _REPEAT:
            continue
        last[key] = r["time"]
        session = sessions.board(r["board_id"], r["time"])
        out.append((r["time"], r["board_id"], board["name"], session["id"] if session else None,
                    session["username"] if session else None, "sensor", text, None, source))
    with conn.transaction():
        _insert(conn, out)
        _save_cursor(conn, "session_activity.sensors", rows[-1]["time"])


def run(conn) -> None:
    by_host, by_id = _boards(conn)
    _from_logs(conn, by_host)
    _from_ankamon(conn, by_id)
    _from_sensors(conn, by_id)
