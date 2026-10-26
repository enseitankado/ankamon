-- Kullanıcı başına arayüz teması (bkz. frontend/source/class/ankamon/theme/). Değer, qx tema
-- sınıfını seçen kısa bir anahtardır (AuthApi::THEMES ile eşleşmeli); bilinmeyen/boş değer
-- frontend'de varsayılan temaya düşer.
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'blue-light';
