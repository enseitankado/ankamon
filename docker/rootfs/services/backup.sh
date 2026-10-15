#!/bin/sh
# Rutin yedekleme döngüsü (pg_dump → /data/backups).
set -eu

. /opt/tiha-mon/services/wait-db.sh

export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=tihamon PGPASSWORD="$POSTGRES_PASSWORD"
export BACKUP_DIR=/data/backups
exec sh /opt/tiha-mon/backup/backup.sh
