-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- ETAP faz bilgisi (bkz. worker/ankamon/netscan/etap_phase.py): ağ taraması her tur sonunda doldurur.
-- {"model", "ad", "faz", "marka", "guven", "tahta", "kaynak"} — kaynak "donanım" (SSH ile okunan anakart,
-- kesin) ya da "mac" (maskelenmiş önek tahmini). NULL: ETAP faz veritabanında karşılığı yok.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS etap jsonb;
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS etap jsonb;
