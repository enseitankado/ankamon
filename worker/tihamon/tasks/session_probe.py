"""Çevrimiçi tahtaların anlık oturum durumunu (kullanıcı + kilit) SSH ile periyodik yoklar.

Tahtalar grid'inin "Oturum" sütunu için (bkz. executor/session_probe.py). Worker'ın hızlı döngüsünde
(STATUS_TICK_SECONDS) çağrılır ama yalnız INTERVAL_SECONDS'ta bir gerçekten çalışır — her tahtaya
10 sn'de bir SSH açmak gereksiz yük olurdu. Tahtalar paralel yoklanır (eşzamanlılık konteynerin o
anki yüküne göre, bkz. whoami.dynamic_concurrency); veritabanına yazma ana iş parçacığında yapılır.
"""

from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor

from ..executor import session_probe, whoami
from ..executor.jobs import _board_access

log = logging.getLogger(__name__)

INTERVAL_SECONDS = int(os.environ.get("SESSION_PROBE_SECONDS", "30"))
_last = 0.0


def run(conn) -> None:
    global _last
    now = time.monotonic()
    if now - _last < INTERVAL_SECONDS:
        return
    _last = now
    boards = conn.execute(
        "SELECT id AS board_id, host(ip) AS ip FROM boards WHERE online AND ip IS NOT NULL AND monitor_enabled"
    ).fetchall()
    if not boards:
        return
    user, password = _board_access(conn)
    if not password:
        return
    n = max(1, min(whoami.dynamic_concurrency(), len(boards)))
    with ThreadPoolExecutor(max_workers=n) as pool:
        results = list(pool.map(lambda b: (b["board_id"], session_probe.probe(dict(b), user, password)), boards))
    for board_id, res in results:
        if res["ok"]:
            session_probe.store(conn, board_id, res["user"], res["locked"])
