-- Tahtanın ANLIK oturum durumu (Tahtalar grid'inin "Oturum" sütunu): seat0'da oturum açmış kullanıcı
-- (yoksa NULL = oturum kapalı), ekran kilitli mi, en son ne zaman yoklandı. SSH ile periyodik yoklanır
-- (bkz. worker/ankamon/tasks/session_probe.py) ve "Oturumları sorgula"/"Oturum aç"/"Oturumu kapat"
-- görevleri sonucu hemen yazar (bkz. runner). board_sessions (log tabanlı geçmiş) ile karıştırılmasın.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS session_username text;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS session_locked boolean NOT NULL DEFAULT false;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS session_checked_at timestamptz;
