#!/bin/sh
# Grafana: sensör grafikleri. Durumunu da Postgres'te tutar; oturum nginx auth_request ile devralınır.
# Yapılandırmanın tamamı ortam değişkenleriyle (GF_*) verilir.
set -eu

. /opt/tiha-mon/services/wait-db.sh

export \
    GF_PATHS_DATA=/data/grafana \
    GF_PATHS_PROVISIONING=/etc/tiha-mon/grafana/provisioning \
    GF_SERVER_HTTP_ADDR=127.0.0.1 \
    GF_SERVER_HTTP_PORT=3000 \
    GF_SERVER_ROOT_URL="http://localhost/grafana/" \
    GF_SERVER_SERVE_FROM_SUB_PATH=true \
    GF_DATABASE_TYPE=postgres \
    GF_DATABASE_HOST=127.0.0.1:5432 \
    GF_DATABASE_NAME=grafana \
    GF_DATABASE_USER=grafana \
    GF_DATABASE_PASSWORD="$PG_GRAFANA_PASSWORD" \
    GF_DATABASE_SSL_MODE=disable \
    GF_SECURITY_ADMIN_USER=etapadmin \
    GF_SECURITY_ADMIN_PASSWORD="$GRAFANA_ADMIN_PASSWORD" \
    GF_SECURITY_ALLOW_EMBEDDING=true \
    GF_AUTH_PROXY_ENABLED=true \
    GF_AUTH_PROXY_HEADER_NAME=X-WEBAUTH-USER \
    GF_AUTH_PROXY_HEADER_PROPERTY=username \
    GF_AUTH_PROXY_AUTO_SIGN_UP=true \
    GF_AUTH_PROXY_HEADERS=Role:X-WEBAUTH-ROLE \
    GF_AUTH_DISABLE_LOGIN_FORM=true \
    GF_AUTH_DISABLE_SIGNOUT_MENU=true \
    GF_USERS_ALLOW_SIGN_UP=false \
    GF_USERS_DEFAULT_THEME=light \
    GF_USERS_DEFAULT_LANGUAGE=tr-TR \
    GF_ANALYTICS_REPORTING_ENABLED=false \
    GF_ANALYTICS_CHECK_FOR_UPDATES=false \
    GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES=false \
    GF_NEWS_NEWS_FEED_ENABLED=false \
    GF_PLUGINS_PREINSTALL_DISABLED=true \
    GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/etc/tiha-mon/grafana/dashboards/tahta-genel-bakis.json \
    TIHAMON_RO_PASSWORD="$PG_READONLY_PASSWORD"

exec grafana server --homepath=/usr/share/grafana --config=/etc/grafana.ini
