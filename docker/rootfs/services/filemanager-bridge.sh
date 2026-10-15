#!/bin/sh
# Dosya yöneticisi köprüsü: tahta açıldığında onu sshfs ile bağlar (bkz. worker/tihamon/filemanager).
# Yalnız 127.0.0.1:8894 dinler; nginx /filemanager-mount ile oturum + "filemanager" yetkisiyle vekiller.
set -eu

. /opt/tiha-mon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=tihamon PG_USER=tihamon PG_PASSWORD="$POSTGRES_PASSWORD"
export PYTHONUNBUFFERED=1

cd /opt/tiha-mon/worker
exec python3 -m tihamon.filemanager
