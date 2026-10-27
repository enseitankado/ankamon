-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Bilinen takma adlar: MAC adresine göre önceden bilinen cihaz adları (ör. eski envanterden aktarılan).
-- Ağ taraması her tur sonunda bunlarla Ağ grid'indeki (net_devices) ve Tahtalar grid'indeki (boards) BOŞ
-- takma adları doldurur — cihaz henüz hiç görülmemiş olsa bile ilk göründüğünde adıyla gelir. Elle
-- girilmiş adlar ezilmez (bkz. worker/ankamon/netscan/store.py fill_labels). notes: envanter/oda gibi
-- ek bilgi; cihazın notu boşsa oraya yazılır. Okula özgü veridir; göçle değil, içe aktarmayla dolar.
CREATE TABLE IF NOT EXISTS net_known_aliases (
    mac         macaddr PRIMARY KEY,
    label       text NOT NULL,
    notes       text NOT NULL DEFAULT '',
    source      text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);
