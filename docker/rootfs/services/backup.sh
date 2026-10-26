#!/bin/sh
# Rutin yedekleme döngüsü (pg_dump → /data/backups).
set -eu

. /opt/ankamon/services/wait-db.sh

export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=ankamon PGPASSWORD="$POSTGRES_PASSWORD"
export BACKUP_DIR=/data/backups
exec sh /opt/ankamon/backup/backup.sh
