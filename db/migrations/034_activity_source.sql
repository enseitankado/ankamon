-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- "Ankamon logs" (arayüzün alt çubuğu): activity_log artık Ankamon'un kendi faydalı/kritik kayıtlarını da
-- taşır — servis hataları ve çökmeleri, darboğazlar, program hata çıktıları (bkz. worker/ankamon/logwatch).
-- source: kaydı üreten servis/bileşen (ör. "php-fpm", "postgres", "worker", "sistem"); detail: satıra
-- sığmayan ayrıntı (ör. Python traceback'i), arayüzde ipucu olarak gösterilir.
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT '';
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS detail text NOT NULL DEFAULT '';
