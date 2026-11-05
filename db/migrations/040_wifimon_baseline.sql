-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Wi-Fi Monitör (çoklu tahta, sınıfta telefon arama): sabit vericiler ve görülme geçmişi.
--
-- wifimon_fixed_emitters: kullanıcının "sabit" (sınıfın/okulun olağan altyapısı) işaretlediği vericiler. Arayüz bunları
-- soluk gösterir, gerisini "yabancı" olarak öne çıkarır (bkz. backend WifimonFixedEmittersApi, frontend ui.boards.WifiMonitor).
--   kind: ssid (ağ adı — okulun bütün erişim noktaları tek kayıtla) | bssid (tek erişim noktası) | bt (Bluetooth adresi)
--         | probe (yoklama yapan cihazın kalıcı adresi)
--   board_id: NULL = bütün tahtalar (okul geneli), dolu = yalnız o tahtanın sınıfı.
CREATE TABLE IF NOT EXISTS wifimon_fixed_emitters (
    id         serial PRIMARY KEY,
    kind       text NOT NULL CHECK (kind IN ('ssid', 'bssid', 'bt', 'probe')),
    value      text NOT NULL,
    board_id   integer REFERENCES boards(id) ON DELETE CASCADE,
    label      text NOT NULL DEFAULT '',
    created_by text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wifimon_fixed_emitters_key ON wifimon_fixed_emitters (kind, value, coalesce(board_id, 0));

-- wifimon_sightings: tahta başına verici görülme geçmişi (worker screen/wifimon_sightings.py yazar; 90 gün saklanır).
-- Rastgele adresli Bluetooth/yoklama kayıtları yazılmaz. seen_days: görüldüğü farklı gün sayısı.
CREATE TABLE IF NOT EXISTS wifimon_sightings (
    board_id   integer NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    kind       text NOT NULL,
    addr       text NOT NULL,
    name       text NOT NULL DEFAULT '',
    first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen  timestamptz NOT NULL DEFAULT now(),
    seen_days  integer NOT NULL DEFAULT 1,
    PRIMARY KEY (board_id, kind, addr)
);
CREATE INDEX IF NOT EXISTS wifimon_sightings_last_seen_idx ON wifimon_sightings (last_seen);
