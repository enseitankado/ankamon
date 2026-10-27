#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# nginx: derlenmiş qooxdoo arayüzü (varsayılan 80), /api → php-fpm, /grafana → grafana vekili.
set -eu

# HTTP_PORT (.env) burada gerçek dinleme portu olur: host ağında (bkz. docker-compose.yml) artık
# Docker'ın kendi port eşlemesi yok, nginx'in doğrudan bu porttan dinlemesi gerekir.
CONF=/etc/nginx/http.d/default.conf
sed -i "s/__HTTP_PORT__/${HTTP_PORT:-80}/" "$CONF"
sed -i "s/__CAST_WEBRTC_PORT__/${CAST_WEBRTC_PORT:-8897}/" "$CONF"

# HTTPS (ekran yansıtma için gerekli: tarayıcı ekran yakalamayı yalnız güvenli bağlamda verir).
HTTPS_PORT=${HTTPS_PORT:-443}
if [ "$HTTPS_PORT" = 0 ]; then
    sed -i '/#https$/d' "$CONF"
else
    /opt/ankamon/services/tls.sh
    suffix=
    [ "$HTTPS_PORT" = 443 ] || suffix=":$HTTPS_PORT"
    sed -i -e "s/__HTTPS_PORT__/$HTTPS_PORT/" -e "s/__HTTPS_SUFFIX__/$suffix/" "$CONF"
fi

exec nginx -g 'daemon off;'
