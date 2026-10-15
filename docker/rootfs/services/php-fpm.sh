#!/bin/sh
# PHP-FPM: REST API. 127.0.0.1:9000 üzerinden nginx'e hizmet verir.
set -eu

. /opt/tiha-mon/services/wait-db.sh

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=tihamon PG_USER=tihamon PG_PASSWORD="$POSTGRES_PASSWORD"
export ACTIONS_DIR=/opt/tiha-mon/app/actions
# FPM havuzu "nobody" ile çalışır (fpm.conf); /run/tiha-mon'un geri kalanı root'a ait olduğundan
# (bkz. entrypoint.sh) SystemApi'nin örnek-arası durumu (sysstat-prev.json) için ayrı, yazılabilir
# bir alt dizin gerekir.
mkdir -p /run/tiha-mon/php && chown nobody:nobody /run/tiha-mon/php
exec php-fpm84 --nodaemonize --fpm-config /etc/php84/php-fpm.conf
