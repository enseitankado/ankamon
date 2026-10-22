#!/bin/sh
# Postgres hazır olunca: veritabanı/rolleri (ilk açılış), şema göçlerini ve etapadmin hesabını kurar,
# sonra /run/tiha-mon/db-ready bayrağını bırakır. Diğer servisler bu bayrağı bekler. Tek sefer çalışır.
set -eu

export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=tihamon PGPASSWORD="$POSTGRES_PASSWORD"

echo "tiha-mon: PostgreSQL bekleniyor…"
for _ in $(seq 1 60); do
    pg_isready -q && break
    sleep 1
done
pg_isready -q || { echo "tiha-mon: PostgreSQL açılmadı." >&2; exit 1; }

# tihamon veritabanı yoksa oluştur (ilk açılış). psql -tc + gexec kalıbı.
if [ "$(psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='tihamon'")" != "1" ]; then
    echo "tiha-mon: tihamon veritabanı oluşturuluyor…"
    psql -d postgres -q -c "CREATE DATABASE tihamon"
fi
psql -d tihamon -q -c "CREATE EXTENSION IF NOT EXISTS timescaledb"
# İmaj yeni bir TimescaleDB getirdiyse veritabanındaki eklentiyi ona yükselt (imaj eski sürümlerin
# kitaplıklarını da taşıdığı için yükseltilmeden de açılır, ama yeni sürümün düzeltmeleri devreye girmez).
# Komut oturumun ilk komutu olmalı (-X: psqlrc yok). Başarısızlık açılışı durdurmaz; eski sürümle sürer.
if [ "$(psql -d tihamon -tAc "SELECT extversion <> default_version FROM pg_extension e
        JOIN pg_available_extensions a ON a.name = e.extname WHERE e.extname = 'timescaledb'")" = "t" ]; then
    echo "tiha-mon: TimescaleDB eklentisi yükseltiliyor…"
    psql -X -d tihamon -q -c "ALTER EXTENSION timescaledb UPDATE" \
        || echo "tiha-mon: UYARI: TimescaleDB eklentisi yükseltilemedi; eski sürümle devam ediliyor." >&2
fi

# Göçler (migrations + roller + saklama süreleri) ve etapadmin hesabı. İkisi de yeniden çalıştırılabilir.
export PGDATABASE=tihamon
PG_GRAFANA_PASSWORD="$PG_GRAFANA_PASSWORD" PG_READONLY_PASSWORD="$PG_READONLY_PASSWORD" \
    METRICS_RAW_DAYS="$METRICS_RAW_DAYS" METRICS_5M_DAYS="$METRICS_5M_DAYS" \
    METRICS_1H_DAYS="$METRICS_1H_DAYS" LOG_DAYS="$LOG_DAYS" \
    sh /opt/tiha-mon/db/migrate.sh

PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=tihamon PG_USER=tihamon PG_PASSWORD="$POSTGRES_PASSWORD" \
    php /opt/tiha-mon/app/bin/bootstrap.php

touch /run/tiha-mon/db-ready
echo "tiha-mon: veritabanı hazır."
