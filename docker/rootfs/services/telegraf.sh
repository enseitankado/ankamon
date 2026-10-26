#!/bin/sh
# Tahtaların node_exporter uçlarını okuyup Postgres'e yazar. Hedefler worker tarafından
# /data/telegraf/targets.conf içine üretilir; --watch-config ile değişince yeniden yüklenir.
set -eu

. /opt/ankamon/services/wait-db.sh

export PG_PASSWORD="$POSTGRES_PASSWORD" SCRAPE_INTERVAL="${SCRAPE_INTERVAL:-60s}"
exec telegraf \
    --config /etc/ankamon/telegraf.conf \
    --config /data/telegraf/targets.conf \
    --watch-config poll
