#!/bin/sh
# Ekran köprüsü: tarayıcıdaki noVNC ↔ (SSH) ↔ tahtadaki x11vnc. nginx /screen/ws/ ile vekillenir ve
# oturum + "screen" yetkisiyle korunur. Yalnız 127.0.0.1:8890 dinler; dışarı açılmaz.
set -eu

. /opt/tiha-mon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=tihamon PG_USER=tihamon PG_PASSWORD="$POSTGRES_PASSWORD"
export PYTHONUNBUFFERED=1

cd /opt/tiha-mon/worker
exec python3 -m tihamon.screen
