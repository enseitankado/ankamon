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

# Şema göçlerini sırayla uygular; uygulananları schema_migrations'ta izler.
# Göç dosyaları betiğin bulunduğu dizinden okunur (DB_DIR ile değiştirilebilir).
set -eu

DB_DIR="${DB_DIR:-$(cd "$(dirname "$0")" && pwd)}"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"

$PSQL -c "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"

for f in "$DB_DIR"/migrations/*.sql; do
    name=$(basename "$f")
    if [ "$($PSQL -At -c "SELECT 1 FROM schema_migrations WHERE name = '$name'")" = "1" ]; then
        continue
    fi
    echo "göç uygulanıyor: $name"
    # Tek işlem (-1) kullanılmaz: sürekli özet (continuous aggregate) tanımları işlem bloğunda çalışmaz.
    $PSQL -f "$f" > /dev/null
    $PSQL -c "INSERT INTO schema_migrations (name) VALUES ('$name')"
done

# Eklenti göçleri: ext/<ad>/db/migrations/*.sql — çekirdek numaralarından bağımsız; schema_migrations'a
# "ext:<ad>:<dosya>" olarak izlenir (çakışmasın diye). Eklentiler idempotent DDL (IF NOT EXISTS) yazmalı.
for extmig in /opt/ankamon/ext/*/db/migrations; do
    [ -d "$extmig" ] || continue
    ext=$(basename "$(dirname "$(dirname "$extmig")")")
    for f in "$extmig"/*.sql; do
        [ -f "$f" ] || continue
        name="ext:$ext:$(basename "$f")"
        [ "$($PSQL -At -c "SELECT 1 FROM schema_migrations WHERE name = '$name'")" = "1" ] && continue
        echo "eklenti göçü uygulanıyor: $name"
        $PSQL -f "$f" > /dev/null
        $PSQL -c "INSERT INTO schema_migrations (name) VALUES ('$name')"
    done
done

$PSQL \
    -v grafana_password="$PG_GRAFANA_PASSWORD" \
    -v readonly_password="$PG_READONLY_PASSWORD" \
    -v metrics_raw_days="$METRICS_RAW_DAYS" \
    -v metrics_5m_days="$METRICS_5M_DAYS" \
    -v metrics_1h_days="$METRICS_1H_DAYS" \
    -v log_days="$LOG_DAYS" \
    -f "$DB_DIR"/post.sql > /dev/null

echo "veritabanı hazır"
