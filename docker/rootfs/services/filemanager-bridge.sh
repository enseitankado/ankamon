#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Dosya yöneticisi köprüsü: tahta açıldığında onu sshfs ile bağlar (bkz. worker/ankamon/filemanager).
# Yalnız 127.0.0.1:8894 dinler; nginx /filemanager-mount ile oturum + "filemanager" yetkisiyle vekiller.
set -eu

. /opt/ankamon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=ankamon PG_USER=ankamon PG_PASSWORD="$POSTGRES_PASSWORD"
export PYTHONUNBUFFERED=1

cd /opt/ankamon/worker
exec python3 -m ankamon.filemanager
