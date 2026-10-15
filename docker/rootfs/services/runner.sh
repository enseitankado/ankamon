#!/bin/sh
# Görev yürütücüsü: kuyruğa yazılan komut/işlem/kapat/WoL görevlerini (pg_notify ile) anında alır,
# tahtalarda SSH ile paralel çalıştırır ve her adımı canlı olay olarak job_events'e yazar.
set -eu

. /opt/tiha-mon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=tihamon PG_USER=tihamon PG_PASSWORD="$POSTGRES_PASSWORD"
export ACTIONS_DIR=/opt/tiha-mon/app/actions
export PYTHONUNBUFFERED=1

cd /opt/tiha-mon/worker
exec python3 -m tihamon.runner
