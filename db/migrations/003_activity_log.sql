-- Arka plan etkinlik günlüğü: worker'ın yaptığı işler (tahta keşfi, görev başlangıç/bitiş, hatalar).
-- Arayüzün en altındaki durum çubuğu bu akışı gösterir. Düşük hacim; worker eski kayıtları budar.

CREATE TABLE IF NOT EXISTS activity_log (
    id      bigserial PRIMARY KEY,
    time    timestamptz NOT NULL DEFAULT now(),
    level   text NOT NULL DEFAULT 'info',   -- info | warn | error
    message text NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_log_time_idx ON activity_log (id DESC);
