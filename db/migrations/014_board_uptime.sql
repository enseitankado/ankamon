-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Tahtaların AÇIK olduğu zaman aralıkları — loglardan önceden hesaplanır (bkz.
-- worker/ankamon/tasks/board_uptime.py), Oturumlar > Kullanıcılar zaman çizelgesi kapalı saatleri
-- (ör. kurumun kapalı olduğu 18:00–08:00) her açılışta logları taramadan, bu küçük tablodan çizer.
--
-- Bir tahta açıkken sürekli log gönderir (boşluklar birkaç dakikayı geçmez); UPTIME_GAP'ten uzun log
-- sessizliği ya da yeni bir açılış izi ("Startup finished … (firmware) …") yeni bir aralık başlatır.
-- last_at = aralıktaki son log (kapanışın en iyi tahmini; kapanış iletisi çoğu zaman gelmez).
-- Log saklama süresi dolup loglar silinse de bu tablo kalır (satır başına ~100 bayt; günde birkaç satır).
CREATE TABLE IF NOT EXISTS board_uptime (
    host       text NOT NULL,
    started_at timestamptz NOT NULL,
    last_at    timestamptz NOT NULL,
    PRIMARY KEY (host, started_at)
);
CREATE INDEX IF NOT EXISTS board_uptime_last_idx ON board_uptime (last_at DESC);
