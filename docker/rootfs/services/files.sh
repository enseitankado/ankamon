#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Dosya gezgini ("Bilgisayarlar arasında kopyala"): cihazlarda listeleme/silme/ad değiştirme ve cihazdan cihaza
# ilerlemeli kopyalama (bkz. worker/ankamon/files). Yalnız 127.0.0.1:8895 dinler; nginx /files-api/ ile
# oturum + "filemanager" yetkisiyle vekiller.
set -eu

. /opt/ankamon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=ankamon PG_USER=ankamon PG_PASSWORD="$POSTGRES_PASSWORD"
export PYTHONUNBUFFERED=1

cd /opt/ankamon/worker
exec python3 -m ankamon.files
