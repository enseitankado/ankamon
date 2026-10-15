-- Çekirdek şema: kullanıcılar, tahtalar, loglar, sensör verisi, görevler.
-- Göç dosyaları yeniden çalıştırılabilir yazılır (IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------- kullanıcılar
CREATE TABLE IF NOT EXISTS users (
    id            serial PRIMARY KEY,
    username      text NOT NULL UNIQUE,
    full_name     text NOT NULL DEFAULT '',
    password_hash text NOT NULL,
    is_admin      boolean NOT NULL DEFAULT false,
    is_active     boolean NOT NULL DEFAULT true,
    -- Arayüzün hangi özelliklerini kullanabileceği (bkz. backend/config/features.php).
    features      text[] NOT NULL DEFAULT '{}',
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
    -- Çerezdeki belirtecin SHA-256 özeti; belirtecin kendisi saklanmaz.
    id         text PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    ip         text,
    user_agent text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id       bigserial PRIMARY KEY,
    time     timestamptz NOT NULL DEFAULT now(),
    user_id  integer,
    username text,
    action   text NOT NULL,
    target   text,
    detail   jsonb,
    ip       text
);
CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log (time DESC);

-- -------------------------------------------------------------------- tahtalar
CREATE TABLE IF NOT EXISTS boards (
    id              serial PRIMARY KEY,
    hostname        text,
    mac             macaddr,
    ip              inet,
    -- Yöneticinin verdiği ad (ör. "9-A sınıfı") ve konum.
    label           text NOT NULL DEFAULT '',
    location        text NOT NULL DEFAULT '',
    notes           text NOT NULL DEFAULT '',
    -- Kaydın nereden geldiği: syslog | scan | manual
    source          text NOT NULL DEFAULT 'manual',
    monitor_enabled boolean NOT NULL DEFAULT true,
    exporter_port   integer NOT NULL DEFAULT 9100,
    online          boolean NOT NULL DEFAULT false,
    ssh_ok          boolean NOT NULL DEFAULT false,
    exporter_ok     boolean NOT NULL DEFAULT false,
    last_seen_at    timestamptz,
    last_log_at     timestamptz,
    -- SSH ile toplanan envanter (model, sürüm, TiHA adımları…).
    facts           jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS boards_mac_uidx ON boards (mac) WHERE mac IS NOT NULL;
CREATE INDEX IF NOT EXISTS boards_hostname_idx ON boards (lower(hostname));
CREATE INDEX IF NOT EXISTS boards_ip_idx ON boards (ip);

-- ----------------------------------------------------------------------- loglar
-- rsyslog (ompgsql) doğrudan buraya yazar.
CREATE TABLE IF NOT EXISTS logs (
    received_at timestamptz NOT NULL DEFAULT now(),
    device_time timestamptz,
    host        text NOT NULL DEFAULT '',
    from_ip     text,
    facility    smallint,
    severity    smallint,
    program     text,
    message     text
);
SELECT create_hypertable('logs', 'received_at', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS logs_host_time_idx ON logs (host, received_at DESC);
CREATE INDEX IF NOT EXISTS logs_severity_time_idx ON logs (severity, received_at DESC);
ALTER TABLE logs SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'host',
    timescaledb.compress_orderby = 'received_at DESC'
);
SELECT add_compression_policy('logs', INTERVAL '7 days', if_not_exists => TRUE);

-- ----------------------------------------------------------------- sensör verisi
-- Telegraf (outputs.postgresql, tags_as_foreign_keys) bu iki tabloya yazar:
-- her seri (tahta + metrik + etiketler) metrics_tag'de bir satır, ölçümler metrics'te.
CREATE TABLE IF NOT EXISTS metrics_tag (
    tag_id     bigint PRIMARY KEY,
    board_id   text,
    name       text,
    cpu        text,
    mode       text,
    device     text,
    mountpoint text,
    fstype     text,
    chip       text,
    sensor     text,
    type       text,
    zone       text
);
CREATE INDEX IF NOT EXISTS metrics_tag_board_name_idx ON metrics_tag (board_id, name);

CREATE TABLE IF NOT EXISTS metrics (
    time   timestamptz NOT NULL,
    tag_id bigint NOT NULL,
    value  double precision
);
SELECT create_hypertable('metrics', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS metrics_tag_time_idx ON metrics (tag_id, time DESC);
ALTER TABLE metrics SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'tag_id',
    timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('metrics', INTERVAL '2 days', if_not_exists => TRUE);

-- Eski veriyi küçültme: 5 dakikalık ve saatlik özetler. Ham veri silindikten sonra da kalırlar.
CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '5 minutes', time) AS time,
       tag_id,
       avg(value)        AS value,
       min(value)        AS min,
       max(value)        AS max,
       last(value, time) AS last
FROM metrics
GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '1 hour', time) AS time,
       tag_id,
       avg(value)       AS value,
       min(min)         AS min,
       max(max)         AS max,
       last(last, time) AS last
FROM metrics_5m
GROUP BY 1, 2
WITH NO DATA;

SELECT add_continuous_aggregate_policy('metrics_5m',
    start_offset => INTERVAL '3 hours', end_offset => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);
SELECT add_continuous_aggregate_policy('metrics_1h',
    start_offset => INTERVAL '2 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

-- Sorgu kolaylığı: seri etiketleriyle birleştirilmiş görünümler (Grafana ve API bunları kullanır).
CREATE OR REPLACE VIEW v_metrics AS
SELECT m.time, NULLIF(t.board_id, '')::integer AS board_id, t.name, t.cpu, t.mode, t.device,
       t.mountpoint, t.fstype, t.chip, t.sensor, t.type, t.zone, m.value
FROM metrics m JOIN metrics_tag t USING (tag_id);

CREATE OR REPLACE VIEW v_metrics_5m AS
SELECT m.time, NULLIF(t.board_id, '')::integer AS board_id, t.name, t.cpu, t.mode, t.device,
       t.mountpoint, t.fstype, t.chip, t.sensor, t.type, t.zone, m.value, m.min, m.max, m.last
FROM metrics_5m m JOIN metrics_tag t USING (tag_id);

CREATE OR REPLACE VIEW v_metrics_1h AS
SELECT m.time, NULLIF(t.board_id, '')::integer AS board_id, t.name, t.cpu, t.mode, t.device,
       t.mountpoint, t.fstype, t.chip, t.sensor, t.type, t.zone, m.value, m.min, m.max, m.last
FROM metrics_1h m JOIN metrics_tag t USING (tag_id);

-- --------------------------------------------------------------------- görevler
-- API kuyruğa yazar, worker (host ağında) çalıştırır.
CREATE TABLE IF NOT EXISTS jobs (
    id          bigserial PRIMARY KEY,
    type        text NOT NULL,
    title       text NOT NULL DEFAULT '',
    params      jsonb NOT NULL DEFAULT '{}',
    status      text NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
    created_by  integer REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    started_at  timestamptz,
    finished_at timestamptz,
    summary     text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status, id);
CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS job_targets (
    job_id      bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    board_id    integer NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    status      text NOT NULL DEFAULT 'queued',   -- queued | running | ok | failed | unreachable
    exit_code   integer,
    output      text NOT NULL DEFAULT '',
    started_at  timestamptz,
    finished_at timestamptz,
    PRIMARY KEY (job_id, board_id)
);

-- Grafana'nın tahta seçicisi için: yalnız tanıtıcı alanlar.
CREATE OR REPLACE VIEW v_boards AS
SELECT id,
       COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name,
       hostname, host(ip) AS ip, mac::text AS mac, location,
       online, exporter_ok, last_seen_at
FROM boards;
