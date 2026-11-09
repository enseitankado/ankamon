-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Ağ envanteri (kullanıcı isteği 2026-11-09):
--   os_guess_at : işletim sistemi tahmininin son bulunduğu an. Servis taraması işletim sistemini bulamazsa os_guess
--                 korunur (yenisi gelene kadar hatırlanır — bkz. worker netscan/osguess.py, store.apply_services).
--   last_log_at : cihazın IP'sinden gelen son log (worker tasks/net_device_logs.py); "Son log" sütunu.
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS os_guess_at timestamptz;
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS last_log_at timestamptz;
UPDATE net_devices SET os_guess_at = services_scanned_at WHERE os_guess <> '' AND os_guess_at IS NULL;
-- Ankamon'da kayıtlı tahtalar kesin Pardus ETAP (osguess.py ile aynı kural; sonraki servis taramasını beklemeden).
UPDATE net_devices d SET os_guess = 'Linux (Pardus ETAP)', os_guess_at = COALESCE(d.os_guess_at, now())
WHERE d.os_guess <> 'Linux (Pardus ETAP)' AND EXISTS (SELECT 1 FROM boards b WHERE b.mac = d.mac OR b.wifi_mac = d.mac);
