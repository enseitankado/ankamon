"""Tahtaların açık olduğu aralıkları logs tablosundan çıkarıp board_uptime'a işler.

Bkz. db/migrations/014_board_uptime.sql. Açık bir tahta sürekli log gönderir (ölçülen en uzun olağan
boşluk ~7 dk); GAP'ten uzun sessizlik tahtanın kapalı olduğu (ya da ağdan düştüğü) anlamına gelir.
Ayrıca yeni bir açılış izi ("Startup finished in … (firmware) …" — systemd'nin sistem açılışı özeti;
kullanıcı oturumunun "Startup finished in 200ms." satırı firmware içermez) boşluk kısa olsa da
(hızlı yeniden başlatma) yeni aralık başlatır.

board_sessions gibi artımlı: task_cursors'ta son işlenen received_at tutulur, her turda yalnız ondan
sonraki satırlar (en çok _BATCH) okunur; büyük geçmiş birkaç tura yayılır. Yalnız (host, received_at,
açılış mı) okunur — mesaj gövdesi yalnız systemd satırları için denetlenir.
"""

import datetime
import logging

log = logging.getLogger(__name__)

_CURSOR = "board_uptime.watermark"
_BATCH = 50000
GAP = datetime.timedelta(minutes=15)

RECENT = """
    SELECT host, received_at,
           (program = 'systemd' AND message LIKE 'Startup finished in %%(firmware)%%') AS boot
    FROM logs
    WHERE received_at > %(since)s AND host <> ''
    ORDER BY received_at ASC
    LIMIT {batch}
""".format(batch=_BATCH)


def run(conn) -> None:
    row = conn.execute("SELECT value FROM task_cursors WHERE name = %s", (_CURSOR,)).fetchone()
    since = row["value"] if row else datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    rows = conn.execute(RECENT, {"since": since}).fetchall()
    if not rows:
        return

    # Her host'un son (açık olabilecek) aralığı: {host: [started_at, last_at, yeni_mi]}
    current = {}
    hosts = {r["host"] for r in rows}
    for r in conn.execute(
            """SELECT DISTINCT ON (host) host, started_at, last_at FROM board_uptime
               WHERE host = ANY(%s) ORDER BY host, started_at DESC""", (list(hosts),)).fetchall():
        current[r["host"]] = [r["started_at"], r["last_at"]]

    touched = {}  # (host, started_at) -> last_at; yazılacak aralıklar
    for r in rows:
        host, at = r["host"], r["received_at"]
        cur = current.get(host)
        if cur is None or at - cur[1] > GAP or (r["boot"] and at - cur[0] > GAP):
            cur = current[host] = [at, at]
        elif at > cur[1]:
            cur[1] = at
        touched[(host, cur[0])] = cur[1]

    with conn.transaction():
        for (host, started), last in touched.items():
            conn.execute(
                """INSERT INTO board_uptime (host, started_at, last_at) VALUES (%s, %s, %s)
                   ON CONFLICT (host, started_at) DO UPDATE SET last_at = GREATEST(board_uptime.last_at, EXCLUDED.last_at)""",
                (host, started, last))
        conn.execute(
            """INSERT INTO task_cursors (name, value, updated_at) VALUES (%s, %s, now())
               ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
            (_CURSOR, rows[-1]["received_at"]))
    if len(rows) == _BATCH:
        log.info("board_uptime: %d satır işlendi, geçmiş birikinti sürüyor", len(rows))
