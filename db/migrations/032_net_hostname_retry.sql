-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Hostname çözme denemesi zamanı: çevrim içi olup hostname'i boş olan cihazlar NetBIOS (nmblookup) ve
-- ters DNS ile çözülmeye çalışılır (bkz. worker netscan _hostname_loop). Çözülemeyen cihaz her turda
-- yeniden denenmesin diye son deneme anı tutulur (NETSCAN_HOSTNAME_RETRY_HOURS'ta bir yeniden denenir).
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS hostname_tried_at timestamptz;
