-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Cihazın ses durumu (kullanıcı isteği 2026-11-23): oturum açık kullanıcının ses sunucusunda (PipeWire/PulseAudio)
-- varsayılan çıkış sessizde mi ve düzeyi kaç. Oturum durumuyla aynı periyodik SSH yoklamasında okunur
-- (worker executor/soundstate.py, "A" satırı); oturum/ses çıkışı yoksa ya da okunamazsa NULL (bilinmiyor).
-- Akıllı Tahtalar ▸ "Ses" sütunu ve Ekranlar kutucuğunun başlığındaki sessiz hoparlör simgesi bunu gösterir.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sound_muted boolean;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sound_volume smallint;
