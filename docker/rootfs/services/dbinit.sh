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

# --- Eski ad artıkları (tihamon -> ankamon; yeniden çalıştırılabilir, artık yoksa bir şey yapmaz) ---
# Grafana'nın eski veri kaynağı (uid tihamon, ad TihaMon): provisioning aynı adla uid ankamon isteyince
# Grafana "data source not found" ile açılmaz. Grafana başlamadan (db-ready'yi bekler) eski kayıt, izinleri
# ve şifreli parolası silinir; provisioning "Ankamon" veri kaynağını yeniden kurar. Eski panolar (sağlayıcı
# "tiha-mon") Grafana'nın sahipsiz provisioning temizliğiyle gider; boş kalan klasör grafana.sh'de silinir.
if [ "$(psql -d grafana -tAc "SELECT 1 FROM data_source WHERE uid = 'tihamon'" 2>/dev/null)" = "1" ]; then
    echo "ankamon: Grafana'daki eski 'tihamon' veri kaynağı kaldırılıyor…"
    psql -d grafana -q -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM permission WHERE scope = 'datasources:uid:tihamon';
DELETE FROM secrets WHERE type = 'datasource' AND namespace = 'TihaMon';
DELETE FROM data_source WHERE uid = 'tihamon';
COMMIT;
SQL
fi
# Ara sürümde (ad değişmeden önce) uid ankamon "TihaMon" adıyla kurulmuş olabilir: provisioning veri
# kaynağını adıyla arar; bulamayıp aynı uid'le yenisini eklemeye kalkmasın diye ad önceden düzeltilir.
psql -d grafana -q -c "UPDATE secrets SET namespace = 'Ankamon' WHERE type = 'datasource' AND namespace = 'TihaMon';
    UPDATE data_source SET name = 'Ankamon' WHERE uid = 'ankamon' AND name <> 'Ankamon'" 2>/dev/null || true
# Ağ envanterinde sunucunun kendi kaydı (otomatik tür) eski adla kalmasın.
psql -d ankamon -q -c "UPDATE net_devices SET type_auto = 'Ankamon sunucusu' WHERE type_auto = 'Tiha-Mon sunucusu'"

touch /run/ankamon/db-ready
echo "ankamon: veritabanı hazır."
