#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Merkezi log alıcısı (TCP+UDP 514 → Postgres). Yapılandırma docker/rsyslog/rsyslog.conf'tan gelir;
# tek konteynerde veritabanı 127.0.0.1'dedir, o yüzden hedef çalışma anında yeniden yazılır.
set -eu

. /opt/ankamon/services/wait-db.sh

# Veritabanı parolası rsyslog.conf içinde `echo $PG_PASSWORD` ile okunur.
export PG_PASSWORD="$POSTGRES_PASSWORD"

# Kuyruk bind mount üzerinde (/data/rsyslog) kalmalı; konteyner yeniden oluşturulsa da bekleyen
# kayıtlar kaybolmasın. workDirectory yapılandırmada /var/spool/rsyslog; çalışma anında yeniden yazılır.
SPOOL=/data/rsyslog
QI="$SPOOL/ankamon_pg.qi"

# Ani güç kesintisi .qi konum dosyasını yarım bırakabilir; rsyslog onu okuyamazsa kuyruğu başlatamaz ve
# gelen bütün kayıtları sessizce atar. Bozuk kuyruk dosyaları açılıştan önce kenara alınır.
qi_ok() {
    head -n 1 "$QI" | grep -q '^<OPB:1:qqueue:' && tail -n 2 "$QI" | head -n 1 | grep -q '^>End$'
}
if [ -f "$QI" ] && ! qi_ok; then
    dir="$SPOOL/bozuk-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$dir"
    mv "$SPOOL"/ankamon_pg.* "$dir"/
    echo "ankamon: kuyruk konum dosyası okunamadı, kuyruk dosyaları $dir altına alındı"
fi

# Tek konteynerde Postgres localhost'ta ve kuyruk /data/rsyslog'da; yapılandırma buna göre uyarlanır.
# SYSLOG_PORT (.env) burada gerçek dinleme portu olur: host ağında (bkz. docker-compose.yml) artık
# Docker'ın kendi port eşlemesi yok, rsyslog'un doğrudan bu porttan dinlemesi gerekir.
sed -e 's/server="postgres"/server="127.0.0.1"/' \
    -e 's#workDirectory="/var/spool/rsyslog"#workDirectory="/data/rsyslog"#' \
    -e "s/__SYSLOG_PORT__/${SYSLOG_PORT:-514}/g" \
    /etc/ankamon/rsyslog.conf > /run/ankamon/rsyslog.conf

exec rsyslogd -n -i NONE -f /run/ankamon/rsyslog.conf
