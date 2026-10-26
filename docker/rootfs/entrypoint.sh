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
chown grafana:grafana /data/grafana
# rsyslog, telegraf hedef dosyası ve yedekler root süreçlerince yazılır.
chmod 755 /data/telegraf /data/files
chmod 700 /data/backups
[ -f /data/telegraf/targets.conf ] || echo '# ankamon worker tarafından üretilir' > /data/telegraf/targets.conf

exec /usr/bin/supervisord -c /opt/ankamon/supervisord.conf
