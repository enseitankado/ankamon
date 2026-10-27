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
            session_probe.store_display(conn, board_id, res["display"])
            session_probe.store_extras(conn, board_id, res)
