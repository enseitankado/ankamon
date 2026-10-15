-- Tahta oturumları: greeter (lightdm) loglarından çıkarılan gerçek kullanıcı oturum açma/kapama
-- kayıtları (bkz. worker/tihamon/tasks/board_sessions.py). logs tablosunda satır kimliği yoktur
-- (hypertable, PK yok); worker bu yüzden task_cursors ile "buraya kadar işlendi" zaman damgasını
-- tutar, aynı satırı iki kez işlemez.
--
-- Oturum kapanışı HER ZAMAN güvenilir biçimde loglanmaz (elektrik kesintisi, fiziksel güç
-- düğmesiyle zorla kapatma, çok hızlı kapanan "Kapat" komutu — PAM'ın kapanış mesajı sunucuya
-- yetişemeyebilir). end_reason bu yüzden ayrım tutar:
--   logout     — PAM'ın "session closed" mesajı gerçekten görüldü (normal çıkış).
--   offline    — oturum açıkken tahta çevrimdışı oldu, kapanış mesajı hiç gelmedi; ended_at en iyi
--                tahmindir (tahtanın son görülme zamanı). Elektrik kesintisi/zorla kapatma/çok hızlı
--                kapanma burada toplanır.
--   superseded — kapanış mesajı gelmeden AYNI tahtada yeni bir oturum açıldı; eskisi yenisinin
--                başlangıcında kapanmış sayılır (ör. kapanış mesajı kayboldu, tahta hemen yeniden
--                kullanıldı).
--   NULL       — oturum hâlâ açık.
CREATE TABLE IF NOT EXISTS board_sessions (
    id         bigserial PRIMARY KEY,
    board_id   integer REFERENCES boards(id) ON DELETE SET NULL,
    host       text NOT NULL,
    username   text NOT NULL,
    uid        integer,
    started_at timestamptz NOT NULL,
    ended_at   timestamptz,
    end_reason text
);
CREATE INDEX IF NOT EXISTS board_sessions_open_idx ON board_sessions (host) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS board_sessions_board_idx ON board_sessions (board_id, started_at DESC);
CREATE INDEX IF NOT EXISTS board_sessions_username_idx ON board_sessions (username, started_at DESC);

-- Genel amaçlı: herhangi bir worker görevinin "buraya kadar işlendi" zaman damgası. logs gibi
-- satır kimliği olmayan hypertable'ları zaman damgasıyla artımlı okumak için (bkz. yukarı).
CREATE TABLE IF NOT EXISTS task_cursors (
    name       text PRIMARY KEY,
    value      timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
