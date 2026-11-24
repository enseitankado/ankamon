-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Zamanlanmış görevde "cihaz çevrimiçi olunca, bir kez" yinelemesi (kullanıcı isteği 2026-11-24): ör. Bakım ▸ Ahenk ▸
-- ETA Kayıt güncelle işaretli cihazların çevrimdışı olanları için tek seferlik görev. Worker (tasks/user_schedules.py)
-- her hızlı turda hedeflerden çevrimiçi ve SSH'ı açık olanlara görevi bir kez yazar, onları fired_device_ids'e ekler;
-- bütün hedefler çalışınca zamanlama kapanır (bir kezlik "once" gibi).
ALTER TABLE user_schedules DROP CONSTRAINT IF EXISTS user_schedules_repeat_check;
ALTER TABLE user_schedules ADD CONSTRAINT user_schedules_repeat_check
    CHECK (repeat IN ('once', 'interval', 'weekly', 'when_online'));
ALTER TABLE user_schedules ADD COLUMN IF NOT EXISTS fired_device_ids integer[] NOT NULL DEFAULT '{}';
