#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Görev yürütücüsü: kuyruğa yazılan komut/işlem/kapat/WoL görevlerini (pg_notify ile) anında alır,
# tahtalarda SSH ile paralel çalıştırır ve her adımı canlı olay olarak job_events'e yazar.
set -eu

. /opt/ankamon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=ankamon PG_USER=ankamon PG_PASSWORD="$POSTGRES_PASSWORD"
export ACTIONS_DIR=/opt/ankamon/app/actions
export PYTHONUNBUFFERED=1

cd /opt/ankamon/worker
exec python3 -m ankamon.runner
