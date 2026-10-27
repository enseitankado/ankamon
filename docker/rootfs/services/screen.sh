#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Ekran köprüsü: tarayıcıdaki noVNC ↔ (SSH) ↔ tahtadaki x11vnc. nginx /screen/ws/ ile vekillenir ve
# oturum + "screen" yetkisiyle korunur. Yalnız 127.0.0.1:8890 dinler; dışarı açılmaz.
set -eu

. /opt/ankamon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=ankamon PG_USER=ankamon PG_PASSWORD="$POSTGRES_PASSWORD"
export PYTHONUNBUFFERED=1

cd /opt/ankamon/worker
exec python3 -m ankamon.screen
