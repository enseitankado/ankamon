-- Oturumun tarayıcıdaki durumu (alt çubuk ipucunda yeşil "Aktif"): Tiha-Mon sekmesi GÖRÜNÜR ve tarayıcı
-- penceresi ODAKTA mı. Tarayıcı durum değişince hemen, sürerken 15 sn'de bir bildirir (bkz. StatusBar
-- __pollUsers, LoginSessionsApi::active). Bildirim kesilirse (sekme kapandı, ağ gitti) focus_at eskir ve
-- "Aktif" sayılmaz (LoginSessionsApi::FOCUS_STALE_SECONDS).
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS focused boolean NOT NULL DEFAULT false;
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS focus_at timestamptz;
