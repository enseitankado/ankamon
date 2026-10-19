-- Tahta oturumu kapanma nedeninin ayrıntısı (Tahtalar ▸ Oturumlar). Kapanış mesajı gelmeden tahta
-- çevrimdışı olunca oturum 'offline' kapatılır (bkz. tasks/board_sessions.py); tahta yeniden erişilebilir
-- olunca tasks/session_end.py tahtanın kendi açılış günlüğüne (journalctl) bakıp nedeni netleştirir:
--   shutdown / reboot — düzenli kapatma / yeniden başlatma (systemd kapanış izi var);
--   auto_idle         — Pardus eta-shutdown "işlem yapılmayınca kapat" (poweroff -f — iz bırakmaz);
--   auto_timed        — eta-shutdown sabit saatte kapanma (10 dk önce uyarı, ertelenmediyse);
--   power_loss        — iz yok ve yukarıdakilerle açıklanamıyor: elektrik kesintisi / güç düğmesine basılı tutma;
--   network           — tahta kapanmadı, yalnız ağ bağlantısı kesildi (oturum aynı açılışta).
-- end_detail: arayüzde gösterilen açıklama (ör. "20 dk işlem yapılmadı"); end_checked_at: inceleme yapıldı
-- (yeniden denenmez). ended_at da açılışın gerçek son günlük satırına çekilir.
ALTER TABLE board_sessions ADD COLUMN IF NOT EXISTS end_detail text;
ALTER TABLE board_sessions ADD COLUMN IF NOT EXISTS end_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS board_sessions_unchecked_idx ON board_sessions (board_id)
    WHERE end_reason = 'offline' AND end_checked_at IS NULL;
