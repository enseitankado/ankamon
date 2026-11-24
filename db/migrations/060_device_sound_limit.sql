-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Cihazın ses sınırı (kullanıcı isteği 2026-11-24): Yönet ▸ Ses kontrolü ▸ Sesi sınırla ile cihaza kurulan bekçinin
-- en yüksek düzeyi (yüzde; kullanıcı sesi bunun üstüne çıkaramaz — bkz. actions/sound-control). Oturum yoklamasında
-- okunur (worker executor/soundstate.py, "AL" satırı); sınır yoksa ya da okunamazsa NULL. Ses sütunu ve Ekranlar
-- kutucuğundaki ses simgesi gösterir.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sound_limit smallint;

-- Ses işlemleri ayrı yetkiye geçti (devices.sound; önceki sound-mute/unmute/volume-down hazır işlemleri "actions"
-- yetkisiyle çalışıyordu): hazır işlem yetkisi olan kullanıcılar sesi yönetmeye devam etsin.
UPDATE users SET features = array_append(features, 'devices.sound')
 WHERE 'actions' = ANY(features) AND NOT 'devices.sound' = ANY(features);
