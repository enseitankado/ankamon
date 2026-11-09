# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Ağ envanteri ▸ "Son log" sütunu: cihazın (IP'sinden) son log gönderme zamanı → net_devices.last_log_at.

Her turda (TICK_SECONDS) son birkaç dakikanın logları kaynak IP'ye göre toplanır ve aynı IP'deki cihaz(lar)a yazılır;
worker başladıktan sonraki ilk turda geriye doğru BACKFILL kadar bakılır (sıkıştırılmış eski bölümler pahalı — ötesi
tutulmaz). Arayüz sorgusu böylece logs tablosuna dokunmaz (bkz. backend NetworkApi::devices). Tahtaya bağlı cihazda
API ayrıca boards.last_log_at'e de bakar (tahta logu bilgisayar adıyla eşleşir, IP değişse de).
"""

import logging

log = logging.getLogger(__name__)

BACKFILL = "7 days"
WINDOW = "5 minutes"
_backfilled = False

UPDATE = """
    UPDATE net_devices d SET last_log_at = x.at
    FROM (SELECT from_ip, max(received_at) AS at FROM logs
          WHERE received_at > now() - %s::interval AND from_ip ~ '^[0-9]{1,3}(\\.[0-9]{1,3}){3}$'
          GROUP BY from_ip) x
    WHERE d.ip = x.from_ip::inet AND (d.last_log_at IS NULL OR d.last_log_at < x.at)
"""


def run(conn) -> None:
    global _backfilled
    window = WINDOW if _backfilled else BACKFILL
    n = conn.execute(UPDATE, (window,)).rowcount
    _backfilled = True
    if n:
        log.debug("son log zamanı güncellendi: %d cihaz", n)
