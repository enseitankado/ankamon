-- Anomaliler (Tahtalar ▸ Anomaliler): ağdaki bilgisayarlarda işletim sistemi, donanım ve kullanıcı
-- davranışına dair sıra dışı durumların zaman aralıkları. Kurallar worker'da (bkz. worker/ankamon/anomaly);
-- her kural kendi türünü (kind) ön hesaplanmış kaynaklardan (board_uptime, board_sessions …) çıkarır.
--
-- ended_at NULL = anomali sürüyor (Anomaliler ▸ Anlık). host + board_name satırda tutulur: tahta kaydı
-- silinse (board_id NULL olur) ya da tahtanın logları kuyruktan/DB'den silinse de rapor korunur.
-- detail: türe özgü ayrıntı (ör. no_login: {"reason": "boot"|"logout", "user", "threshold_min"}).
CREATE TABLE IF NOT EXISTS anomalies (
    id         bigserial PRIMARY KEY,
    kind       text NOT NULL,
    host       text NOT NULL,
    board_id   integer REFERENCES boards(id) ON DELETE SET NULL,
    board_name text NOT NULL DEFAULT '',
    started_at timestamptz NOT NULL,
    ended_at   timestamptz,
    detail     jsonb NOT NULL DEFAULT '{}',
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kind, host, started_at)
);
CREATE INDEX IF NOT EXISTS anomalies_started_idx ON anomalies (started_at DESC);
CREATE INDEX IF NOT EXISTS anomalies_board_idx ON anomalies (board_id, started_at DESC);
CREATE INDEX IF NOT EXISTS anomalies_open_idx ON anomalies (kind) WHERE ended_at IS NULL;
