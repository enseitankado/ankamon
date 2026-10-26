-- Oturumun o anda Ankamon'da baktığı yer (alt çubuk ipucunda "Aktif"in sağında): sayfa yolu, iç sekme ve
-- öndeki pencere, ör. "Tahtalar ▸ Ekranlar · Web terminal — B Blok - Arge 2". Alt çubuk 15 sn'de bir ve
-- sayfa değişince bildirir (bkz. StatusBar __currentView, LoginSessionsApi::active); yalnız bilgi amaçlı.
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS view text;
