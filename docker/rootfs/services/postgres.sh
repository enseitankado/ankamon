#!/bin/sh
# PostgreSQL + TimescaleDB. İlk açılışta PGDATA'yı ilklendirir, sonra sunucuyu ön planda çalıştırır.
# Yalnız konteyner içine (127.0.0.1 + unix soketi) dinler; 5432 dışarı açılmaz.
set -eu

export PGDATA=/data/postgres
PWFILE=/run/tiha-mon/pg-pw

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "tiha-mon: PostgreSQL ilklendiriliyor…"
    printf '%s' "$POSTGRES_PASSWORD" > "$PWFILE"
    chown postgres "$PWFILE"
    su-exec postgres initdb --username=tihamon --pwfile="$PWFILE" \
        --data-checksums --encoding=UTF8 --locale=C
    rm -f "$PWFILE"
    {
        echo "local all all trust"
        echo "host all all 127.0.0.1/32 scram-sha-256"
        echo "host all all ::1/128 scram-sha-256"
    } > "$PGDATA/pg_hba.conf"
    chown postgres "$PGDATA/pg_hba.conf"
fi

# Güç kesintisi direnci: fsync/full_page_writes/synchronous_commit açık. Veri sayfası sağlama toplamları
# initdb'de etkinleştirildi. Yalnız yerel dinleme.
exec su-exec postgres postgres -D "$PGDATA" \
    -c listen_addresses=127.0.0.1 \
    -c fsync=on -c full_page_writes=on -c synchronous_commit=on \
    -c wal_compression=on -c max_wal_size=1GB -c checkpoint_timeout=5min \
    -c shared_preload_libraries=timescaledb \
    -c timescaledb.telemetry_level=off \
    -c log_min_duration_statement=2000
