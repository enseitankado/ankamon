-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Kullanıcı başına sol ağaçtaki ana düğümlerin sırası (sürükle-bırak ile değiştirilir; bkz. frontend
-- ui/Shell.js). JSON dizi: sayfa id'leri, kullanıcının bıraktığı sırayla. Burada OLMAYAN id'ler
-- (yeni eklenen sayfa, henüz hiç sıralanmamış kullanıcı) PAGES'teki varsayılan sırayla SONA eklenir
-- — bu sütun yalnızca kullanıcının AÇIKÇA değiştirdiği sırayı tutar, tam listeyi değil.
ALTER TABLE users ADD COLUMN IF NOT EXISTS nav_order jsonb NOT NULL DEFAULT '[]'::jsonb;
