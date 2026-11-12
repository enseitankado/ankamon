#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Cihazların node_exporter uçlarını okuyup Postgres'e yazar. Hedefler worker tarafından
# /data/telegraf/targets.conf içine üretilir; --watch-config ile değişince yeniden yüklenir.
set -eu

. /opt/ankamon/services/wait-db.sh

export PG_PASSWORD="$POSTGRES_PASSWORD" SCRAPE_INTERVAL="${SCRAPE_INTERVAL:-60s}"
# Terim geçişi (2026-11-12, göç 053): eski hedef dosyasındaki board_id etiketi device_id olur — yoksa worker dosyayı
# yeniden yazana dek Telegraf metrics_tag'e eski adla yeni sütun açardı.
[ -f /data/telegraf/targets.conf ] && sed -i 's/^\( *\)board_id = /\1device_id = /' /data/telegraf/targets.conf || true
exec telegraf \
    --config /etc/ankamon/telegraf.conf \
    --config /data/telegraf/targets.conf \
    --watch-config poll
