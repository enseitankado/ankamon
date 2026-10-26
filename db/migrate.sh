#!/bin/sh
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
