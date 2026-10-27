#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# PHP-FPM: REST API. 127.0.0.1:9000 üzerinden nginx'e hizmet verir.
set -eu

. /opt/ankamon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=ankamon PG_USER=ankamon PG_PASSWORD="$POSTGRES_PASSWORD"
export ACTIONS_DIR=/opt/ankamon/app/actions
# FPM havuzu "nobody" ile çalışır (fpm.conf); /run/ankamon'un geri kalanı root'a ait olduğundan
# (bkz. entrypoint.sh) SystemApi'nin örnek-arası durumu (sysstat-prev.json) için ayrı, yazılabilir
# bir alt dizin gerekir.
mkdir -p /run/ankamon/php && chown nobody:nobody /run/ankamon/php
exec php-fpm84 --nodaemonize --fpm-config /etc/php84/php-fpm.conf
