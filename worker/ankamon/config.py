"""Ortam değişkenlerinden okunan yapılandırma."""

import os

PG_DSN = "host={} port={} dbname={} user={} password={}".format(
    os.environ.get("PG_HOST", "postgres"),
    os.environ.get("PG_PORT", "5432"),
    os.environ.get("PG_DB", "ankamon"),
    os.environ.get("PG_USER", "ankamon"),
    os.environ.get("PG_PASSWORD", ""),
)

# Telegraf'ın izlediği hedef dosyası (paylaşılan dizin).
TELEGRAF_TARGETS = os.environ.get("TELEGRAF_TARGETS", "/targets/targets.conf")

# Görev döngüsünün aralığı (saniye): tahta keşfi, MAC/kimlik, Telegraf hedefleri, kuyruktaki görevler.
TICK_SECONDS = int(os.environ.get("WORKER_TICK_SECONDS", "60"))

# board_status (SSH/sensör portu yoklaması) bundan ayrı, daha sık çalışır: çevrimdışı tespiti
# TICK_SECONDS'ı (60 sn) beklemesin. Düşürülürse board_status.py'deki FAILS_BEFORE_OFFLINE ile
# birlikte değerlendirilmeli (çok kısa aralık + düşük histerezis, ağ sıçramasında grid'i titretir).
STATUS_TICK_SECONDS = int(os.environ.get("WORKER_STATUS_TICK_SECONDS", "10"))
