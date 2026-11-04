# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Postgres bağlantısı (psycopg 3)."""

import logging
import random
import time

import psycopg
from psycopg.rows import dict_row

from . import config

log = logging.getLogger(__name__)

# Toplu işlerde her tahta iş parçacığı kendi bağlantısını açar (runner); paralellik yüke göre 20'ye
# çıkabildiğinden bağlantı sınırı anlık dolabilir. "too many clients" geçici: kısa, artan beklemelerle
# yeniden denenir, iş düşmez (toplam en çok ~20 sn). Başka bağlantı hataları hemen yükselir.
_FULL_RETRY_DELAYS = (0.2, 0.4, 0.8, 1.5, 2.5, 4, 5, 5)


def _is_full(exc: psycopg.OperationalError) -> bool:
    return getattr(exc, "sqlstate", None) == "53300" or "too many clients" in str(exc)


def connect() -> psycopg.Connection:
    for attempt, delay in enumerate(_FULL_RETRY_DELAYS + (None,)):
        try:
            return psycopg.connect(config.PG_DSN, autocommit=True, row_factory=dict_row)
        except psycopg.OperationalError as e:
            if delay is None or not _is_full(e):
                raise
            if attempt == 0:
                log.warning("Postgres bağlantı sınırı dolu; yeniden denenecek")
            time.sleep(delay + random.uniform(0, delay / 2))
    raise AssertionError("ulaşılmaz")
