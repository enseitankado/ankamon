-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Kullanıcı başına arayüz teması (bkz. frontend/source/class/ankamon/theme/). Değer, qx tema
-- sınıfını seçen kısa bir anahtardır (AuthApi::THEMES ile eşleşmeli); bilinmeyen/boş değer
-- frontend'de varsayılan temaya düşer.
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'blue-light';
