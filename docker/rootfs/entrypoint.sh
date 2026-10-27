#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
# Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
# https://github.com/enseitankado/ankamon
#
# Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
# GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
# daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
# değiştirebilirsiniz.
#
# Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
# YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
# verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
#
# Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
# dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
# adresine bakınız.
#
# Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
# parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
# lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
# korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
# kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).

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
