"""Postgres bağlantısı (psycopg 3)."""

import psycopg
from psycopg.rows import dict_row

from . import config


def connect() -> psycopg.Connection:
    return psycopg.connect(config.PG_DSN, autocommit=True, row_factory=dict_row)
