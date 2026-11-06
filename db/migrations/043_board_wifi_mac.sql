-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Tahtanın kablosuz (Wi-Fi) kartının kalıcı MAC adresi (Tahtalar ▸ "Kablosuz MAC").
--
-- boards.mac KABLOLU kartın MAC'idir (adı geniş etki nedeniyle değiştirilmedi): tahtanın kimliği, uzaktan
-- uyandırma (WoL) ve ağ taramasında eşleşme ondandır. wifi_mac ise Wi-Fi kartının fabrika (kalıcı) adresidir:
-- worker oturum yoklaması (executor/netif.py, 30 sn — /sys/class/ieee80211/<phy>/macaddress) ve donanım bilgisi
-- (executor/hwfacts.py) yazar; Tahta düzenle penceresinden elle de girilebilir. /sys/class/net/<wlan>/address
-- KULLANILMAZ: NetworkManager tarama sırasında rastgele (yerel yönetimli) adres takar, kalıcı değildir.
-- Benzersiz değildir (klon kayıtlar, elle giriş) — eşleşmelerde kablolu MAC önceliklidir.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS wifi_mac macaddr;
CREATE INDEX IF NOT EXISTS boards_wifi_mac_idx ON boards (wifi_mac) WHERE wifi_mac IS NOT NULL;

-- İlk değer: önceki yoklamanın/donanım bilgisinin gördüğü Wi-Fi adresi, yalnız evrensel (üreticinin atadığı)
-- ise — yerel yönetimli bit (ilk baytın 2. biti: x2/x6/xA/xE) rastgele adres demektir, yazılmaz.
UPDATE boards b SET wifi_mac = src.mac::macaddr
  FROM (
    SELECT DISTINCT ON (b2.id) b2.id, lower(m.mac) AS mac
      FROM boards b2,
           LATERAL (
             SELECT i->>'mac' AS mac, 1 AS pr FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(b2.netifs->'ifaces') = 'array' THEN b2.netifs->'ifaces' ELSE '[]'::jsonb END) i
              WHERE i->>'kind' = 'wifi'
             UNION ALL
             SELECT b2.facts->>'wifi_mac', 2
           ) m
     WHERE m.mac ~* '^([0-9a-f]{2}:){5}[0-9a-f]{2}$' AND m.mac !~* '^.[26ae]' AND m.mac <> '00:00:00:00:00:00'
     ORDER BY b2.id, m.pr
  ) src
 WHERE b.id = src.id AND b.wifi_mac IS NULL;
