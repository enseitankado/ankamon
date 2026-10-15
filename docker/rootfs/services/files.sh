#!/bin/sh
# Dosya gezgini ("Dosyaları kopyala"): tahtalarda listeleme/silme/ad değiştirme ve tahtadan tahtaya
# ilerlemeli kopyalama (bkz. worker/tihamon/files). Yalnız 127.0.0.1:8895 dinler; nginx /files-api/ ile
# oturum + "filemanager" yetkisiyle vekiller.
set -eu

. /opt/tiha-mon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=tihamon PG_USER=tihamon PG_PASSWORD="$POSTGRES_PASSWORD"
export PYTHONUNBUFFERED=1

cd /opt/tiha-mon/worker
exec python3 -m tihamon.files
