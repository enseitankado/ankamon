-- Komut günlüğü: tahtalarda çalıştırılan komutlar/işlemler (kim, ne zaman, ne, sonuç).
-- Ham sistem logları (logs tablosu) ayrıdır; bu tablo "komut logları" türünü karşılar.

CREATE TABLE IF NOT EXISTS command_log (
    id         bigserial PRIMARY KEY,
    time       timestamptz NOT NULL DEFAULT now(),
    -- Tahta silinse bile geçmiş okunabilsin diye hem referans hem ad anlık kopyası tutulur.
    board_id   integer REFERENCES boards(id) ON DELETE SET NULL,
    board_name text NOT NULL DEFAULT '',
    username   text NOT NULL DEFAULT '',
    -- Komutun kaynağı: action (hazır işlem) | command (serbest komut) | webshell (web terminal oturumu)
    source     text NOT NULL DEFAULT 'command',
    command    text NOT NULL DEFAULT '',
    exit_code  integer,
    status     text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS command_log_time_idx ON command_log (time DESC);
CREATE INDEX IF NOT EXISTS command_log_board_idx ON command_log (board_id, time DESC);
