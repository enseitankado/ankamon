-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Wi-Fi Monitör: güvenilir vericilerin fiziksel konumunu bulmak için sensör başına sinyal istatistikleri ve elle konum ataması
-- (kullanıcı isteği 2026-11-11). Güvenilir cihazlar (okulun erişim noktaları, sabit cihazlar) bir sensörün (tahtanın) birkaç metre
-- yakınında sabittir; hangi sensörün o vericiyi hangi bantta ne güçte duyduğu, vericinin hangi sensörün yanında olduğunu gösterir.
--
-- wifimon_signal_stats: worker screen/wifimon_signal_log.py her taramada yazar (Wi-Fi Monitör penceresi açıkken). Satır =
--   verici adresi × sensör (board_id) × bant × gün; toplamlar tutulur (ortalama / sapma hesaplanır, ham ölçüm saklanmaz — disk).
--   band: '2.4' | '5' | '6' | '?' (frekans bilinmiyor). dBm: tahtanın `iw scan dump` ölçümü; yoksa NetworkManager yüzdesinden
--   tahmin (n_est sayılır). Bütün erişim noktaları ve kalıcı adresli cihazlar yazılır (güvenilir işaretlenmeden önceki geçmiş de
--   kalsın). 90 günden eski günler silinir.
-- wifimon_emitter_locations: kullanıcının "bu verici şu sensörün yanında" kaydı (Güvenilir listesi penceresi). Sensör kablolu
--   MAC'iyle de saklanır (tahta kaydı yeniden açılsa da konum MAC'ten bulunur); sensor_name kayıt anındaki ad.
CREATE TABLE IF NOT EXISTS wifimon_signal_stats (
    addr         text NOT NULL,
    board_id     integer NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    band         text NOT NULL CHECK (band IN ('2.4', '5', '6', '?')),
    day          date NOT NULL DEFAULT current_date,
    kind         text NOT NULL,
    n            integer NOT NULL DEFAULT 0,
    n_est        integer NOT NULL DEFAULT 0,
    sum_dbm      double precision NOT NULL DEFAULT 0,
    sum_sq_dbm   double precision NOT NULL DEFAULT 0,
    min_dbm      real,
    max_dbm      real,
    last_dbm     real,
    last_chan    text NOT NULL DEFAULT '',
    first_at     timestamptz NOT NULL DEFAULT now(),
    last_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (addr, board_id, band, day)
);
CREATE INDEX IF NOT EXISTS wifimon_signal_stats_prefix_idx ON wifimon_signal_stats (left(addr, 14));
CREATE INDEX IF NOT EXISTS wifimon_signal_stats_day_idx ON wifimon_signal_stats (day);

CREATE TABLE IF NOT EXISTS wifimon_emitter_locations (
    addr         text PRIMARY KEY,
    board_id     integer REFERENCES boards(id) ON DELETE SET NULL,
    sensor_mac   macaddr,
    sensor_name  text NOT NULL DEFAULT '',
    note         text NOT NULL DEFAULT '',
    set_by       text NOT NULL DEFAULT '',
    set_at       timestamptz NOT NULL DEFAULT now()
);
