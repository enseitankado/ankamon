#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# "Ankamon logs" toplayıcısı (bkz. worker/ankamon/logwatch): supervisord olay dinleyicisi. Servislerin
# çıktılarındaki uyarı/hataları, çökmeleri ve darboğazları activity_log'a yazar. Veritabanını BEKLEMEZ:
# postgres'in açılış hataları da yakalanabilsin diye hemen başlar, kayıtlar veritabanı açılana dek bellekte durur.
# stdout supervisord ile olay protokolü kanalıdır; bu betik oraya hiçbir şey yazmamalı.
set -eu

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=ankamon PG_USER=ankamon PG_PASSWORD="$POSTGRES_PASSWORD"
export PYTHONUNBUFFERED=1

cd /opt/ankamon/worker
exec nice -n 10 python3 -m ankamon.logwatch
