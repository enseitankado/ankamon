#!/bin/sh
# Postgres hazır olunca: veritabanı/rolleri (ilk açılış), şema göçlerini ve etapadmin hesabını kurar,
# sonra /run/ankamon/db-ready bayrağını bırakır. Diğer servisler bu bayrağı bekler. Tek sefer çalışır.
set -eu

export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=ankamon PGPASSWORD="$POSTGRES_PASSWORD"

echo "ankamon: PostgreSQL bekleniyor…"
for _ in $(seq 1 60); do
    pg_isready -q && break
    sleep 1
done
pg_isready -q || { echo "ankamon: PostgreSQL açılmadı." >&2; exit 1; }

# --- Eski ad göçü: tihamon -> ankamon (yeniden adlandırma; mevcut PGDATA'da BİR KEZ) ---
# Yeni kurulumda superuser zaten 'ankamon' (POSTGRES_USER); eski kurulumda 'tihamon'. Eskiyse, eski
# superuser'la bağlanıp rol+veritabanını yeniden adlandırırız. Kendi rolünü yeniden adlandıramadığından
# geçici superuser (ankamon_migrate) kullanılır; TimescaleDB arka plan işçileri yeniden bağlanmasın diye
# önce ALLOW_CONNECTIONS false + oturum kesme (bkz. not). SCRAM parola yeniden adlandırmada korunur.
if PGUSER=tihamon psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='tihamon'" 2>/dev/null | grep -q 1 \
   && ! PGUSER=tihamon psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='ankamon'" 2>/dev/null | grep -q 1; then
    echo "ankamon: eski 'tihamon' rol/veritabanı 'ankamon'a göç ediliyor…"
    PGUSER=tihamon psql -d postgres -q -v ON_ERROR_STOP=1 \
        -c "CREATE ROLE ankamon_migrate SUPERUSER LOGIN PASSWORD '$POSTGRES_PASSWORD'"
    PGUSER=ankamon_migrate psql -d postgres -q -v ON_ERROR_STOP=1 <<'SQL'
ALTER DATABASE tihamon WITH ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'tihamon' AND pid <> pg_backend_pid();
ALTER DATABASE tihamon RENAME TO ankamon;
ALTER DATABASE ankamon WITH ALLOW_CONNECTIONS true;
ALTER ROLE tihamon RENAME TO ankamon;
SQL
    PGUSER=ankamon_migrate psql -d postgres -q -c "ALTER ROLE tihamon_ro RENAME TO ankamon_ro" 2>/dev/null || true
    PGUSER=ankamon psql -d postgres -q -c "DROP ROLE ankamon_migrate" || true
    echo "ankamon: ad göçü tamam."
fi

# ankamon veritabanı yoksa oluştur (ilk açılış). psql -tc + gexec kalıbı.
if [ "$(psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='ankamon'")" != "1" ]; then
    echo "ankamon: ankamon veritabanı oluşturuluyor…"
    psql -d postgres -q -c "CREATE DATABASE ankamon"
fi
psql -d ankamon -q -c "CREATE EXTENSION IF NOT EXISTS timescaledb"
# İmaj yeni bir TimescaleDB getirdiyse veritabanındaki eklentiyi ona yükselt (imaj eski sürümlerin
# kitaplıklarını da taşıdığı için yükseltilmeden de açılır, ama yeni sürümün düzeltmeleri devreye girmez).
# Komut oturumun ilk komutu olmalı (-X: psqlrc yok). Başarısızlık açılışı durdurmaz; eski sürümle sürer.
if [ "$(psql -d ankamon -tAc "SELECT extversion <> default_version FROM pg_extension e
        JOIN pg_available_extensions a ON a.name = e.extname WHERE e.extname = 'timescaledb'")" = "t" ]; then
    echo "ankamon: TimescaleDB eklentisi yükseltiliyor…"
    psql -X -d ankamon -q -c "ALTER EXTENSION timescaledb UPDATE" \
        || echo "ankamon: UYARI: TimescaleDB eklentisi yükseltilemedi; eski sürümle devam ediliyor." >&2
fi

# Göçler (migrations + roller + saklama süreleri) ve etapadmin hesabı. İkisi de yeniden çalıştırılabilir.
export PGDATABASE=ankamon
PG_GRAFANA_PASSWORD="$PG_GRAFANA_PASSWORD" PG_READONLY_PASSWORD="$PG_READONLY_PASSWORD" \
    METRICS_RAW_DAYS="$METRICS_RAW_DAYS" METRICS_5M_DAYS="$METRICS_5M_DAYS" \
    METRICS_1H_DAYS="$METRICS_1H_DAYS" LOG_DAYS="$LOG_DAYS" \
    sh /opt/ankamon/db/migrate.sh

PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=ankamon PG_USER=ankamon PG_PASSWORD="$POSTGRES_PASSWORD" \
    php /opt/ankamon/app/bin/bootstrap.php

touch /run/ankamon/db-ready
echo "ankamon: veritabanı hazır."
