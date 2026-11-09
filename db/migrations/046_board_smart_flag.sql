-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- "Bu bir akıllı tahtadır" işareti (Tahtalar ▸ Tahtayı düzenle; kullanıcı isteği 2026-11-09).
--
-- Tahtalar sunucunun bütün ağ bağdaştırıcılarından algılanır ve tahta olup olmadığına MAC adresi karar verir
-- (ETAP faz veritabanı / Vestel — bkz. worker netscan/boardmac.py). MAC'i bu kurala uymayan ama gerçekte akıllı
-- tahta olan cihaz bu işaretle tahta sayılır: kablolu MAC'i kayıtlı değilse loglardan IP güncellemesi kabul edilir.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS smart_board boolean NOT NULL DEFAULT false;
