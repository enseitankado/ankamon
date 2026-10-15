#!/bin/sh
# Ani güç kesintisi kuyruğun konum dosyasını (.qi) yarım bırakabilir. rsyslog okunamayan bir .qi ile
# açılır ama kuyruğu başlatamaz ve gelen bütün kayıtları sessizce atar; bu yüzden bozuk kuyruk
# dosyaları açılıştan önce kenara alınır (içindeki bekleyen kayıtlar kaybedilir, alıcı çalışır kalır).
set -eu

SPOOL=/var/spool/rsyslog
QI="$SPOOL/tihamon_pg.qi"

qi_ok() {
    head -n 1 "$QI" | grep -q '^<OPB:1:qqueue:' && tail -n 2 "$QI" | head -n 1 | grep -q '^>End$'
}

if [ -f "$QI" ] && ! qi_ok; then
    dir="$SPOOL/bozuk-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$dir"
    mv "$SPOOL"/tihamon_pg.* "$dir"/
    echo "tiha-mon: kuyruk konum dosyası okunamadı, kuyruk dosyaları $dir altına alındı"
fi

exec rsyslogd -n -i NONE -f /etc/rsyslog.conf
