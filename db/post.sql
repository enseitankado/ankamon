-- Her başlatmada çalışır: roller, yetkiler ve .env'deki saklama süreleri.
-- psql değişkenleri migrate.sh tarafından verilir.

-- Grafana'nın kendi veritabanı ve rolü.
SELECT 'CREATE ROLE grafana LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana') \gexec
ALTER ROLE grafana PASSWORD :'grafana_password';
SELECT 'CREATE DATABASE grafana OWNER grafana' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'grafana') \gexec

-- Grafana veri kaynağı için salt-okunur rol: yalnız izleme verisi, kullanıcı/oturum/ayar tabloları değil.
SELECT 'CREATE ROLE ankamon_ro LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ankamon_ro') \gexec
ALTER ROLE ankamon_ro PASSWORD :'readonly_password';
GRANT CONNECT ON DATABASE ankamon TO ankamon_ro;
GRANT USAGE ON SCHEMA public TO ankamon_ro;
GRANT SELECT ON logs, metrics, metrics_tag, metrics_5m, metrics_1h,
                v_metrics, v_metrics_5m, v_metrics_1h, v_boards TO ankamon_ro;

-- Saklama süreleri: ham veri → 5 dk özet → saatlik özet; loglar.
SELECT remove_retention_policy('metrics', if_exists => TRUE);
SELECT add_retention_policy('metrics', make_interval(days => :metrics_raw_days));
SELECT remove_retention_policy('metrics_5m', if_exists => TRUE);
SELECT add_retention_policy('metrics_5m', make_interval(days => :metrics_5m_days));
SELECT remove_retention_policy('metrics_1h', if_exists => TRUE);
SELECT add_retention_policy('metrics_1h', make_interval(days => :metrics_1h_days));
SELECT remove_retention_policy('logs', if_exists => TRUE);
SELECT add_retention_policy('logs', make_interval(days => :log_days));
