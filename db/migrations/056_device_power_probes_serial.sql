-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Güç yoklamasına sistem diskinin seri numarası (bkz. 055, worker executor/power_probe.py). Yoklama cihazı kayıttaki IP ile
-- bulur; IP eskiyince (2026-11-13: «B Blok - Arge 1» kaydının eski IP'sinde başka bir tahta açıktı) başka tahtanın ölçümü
-- bu cihaza yazılabilir. İki ölçümün seri numarası farklıysa SMART sayaçları karşılaştırılmaz (power_loss._smart_delta).
ALTER TABLE device_power_probes ADD COLUMN IF NOT EXISTS disk_serial text;
