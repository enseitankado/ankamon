#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Rutin yedekleme döngüsü (pg_dump → /data/backups).
set -eu

. /opt/ankamon/services/wait-db.sh

export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=ankamon PGPASSWORD="$POSTGRES_PASSWORD"
export BACKUP_DIR=/data/backups
exec sh /opt/ankamon/backup/backup.sh
