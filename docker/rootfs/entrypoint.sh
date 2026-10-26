#!/bin/sh
# Tek konteynerin PID 1'i. Bağlı veri dizinlerini ve sahipliklerini hazırlar, sonra bütün süreçleri
# yöneten supervisord'yi devralır. Veritabanı ilklendirmesi ve göçler dbinit servisinde yapılır.
set -eu

for env_key in POSTGRES_PASSWORD; do
    eval "val=\${$env_key:-}"
    [ -n "$val" ] || { echo "Hata: $env_key tanımlı değil." >&2; exit 1; }
done

mkdir -p /data/postgres /data/grafana /data/rsyslog /data/telegraf /data/backups /data/files /run/ankamon
# Yeniden başlatmada eski hazır bayrağı kalmasın; göçler yeniden denetlensin.
rm -f /run/ankamon/db-ready

# PGDATA yalnız postgres kullanıcısına açık olmalı (initdb aksi halde reddeder).
chown postgres:postgres /data/postgres
chmod 700 /data/postgres
# -R: eski çok konteynerli kurulumdan kalan (uid 472) png/csv/pdf/plugins alt dizinleri de devralınır.
chown -R grafana:grafana /data/grafana

# Eski ad artıkları (tihamon -> ankamon). rsyslog'un disk kuyruğu dosya adı değişti (tihamon_pg ->
# ankamon_pg). Yeni kuyruk henüz yoksa eskisi bekleyen kayıtlarıyla devralınır: adlar eşit uzunlukta
# olduğundan .qi'deki uzunluk önekli alan bozulmadan değiştirilir. Yeni kuyruk zaten varsa eskisi boşsa
# silinir, kayıt bekliyorsa kenara alınır (kaybolmasın).
if [ -f /data/rsyslog/tihamon_pg.qi ]; then
    if [ ! -e /data/rsyslog/ankamon_pg.qi ]; then
        for f in /data/rsyslog/tihamon_pg.*; do mv "$f" "/data/rsyslog/ankamon_pg.${f##*/tihamon_pg.}"; done
        sed -i 's/:tihamon_pg:/:ankamon_pg:/' /data/rsyslog/ankamon_pg.qi
    elif grep -q '^+iQueueSize:2:1:0:$' /data/rsyslog/tihamon_pg.qi; then
        rm -f /data/rsyslog/tihamon_pg.*
    else
        mkdir -p /data/rsyslog/eski-tihamon_pg
        mv /data/rsyslog/tihamon_pg.* /data/rsyslog/eski-tihamon_pg/
    fi
fi
# Güncelleme öncesi yedekler: döndürme (install.sh, PRE_UPDATE_KEEP) yalnız *-ankamon.dump'ları sayar.
for f in /data/backups/pre-update-*-tihamon.dump; do
    if [ -e "$f" ]; then mv "$f" "${f%-tihamon.dump}-ankamon.dump"; fi
done
# rsyslog, telegraf hedef dosyası ve yedekler root süreçlerince yazılır.
chmod 755 /data/telegraf /data/files
chmod 700 /data/backups
[ -f /data/telegraf/targets.conf ] || echo '# ankamon worker tarafından üretilir' > /data/telegraf/targets.conf

exec /usr/bin/supervisord -c /opt/ankamon/supervisord.conf
