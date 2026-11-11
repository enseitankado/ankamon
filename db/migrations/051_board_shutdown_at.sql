-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Ankamon'dan "Bilgisayarı kapat" komutunun tahtada başarıyla bittiği an (runner yazar; kullanıcı isteği 2026-11-11).
-- Bu andan sonra SSH'e ulaşılamıyorsa (boards.online false) ve tahta o andan beri SSH'te görünmediyse cihaz çevrim dışı
-- sayılır — ağ taramasının bayat kaydı beklenmez (BoardsApi alive/net_online; worker tasks/board_status
-- net_devices.online'ı da düşürür). Tahta yeniden açılıp SSH yanıt verince kural kendiliğinden düşer.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS shutdown_at timestamptz;
