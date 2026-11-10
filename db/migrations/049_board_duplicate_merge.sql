-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Çift tahta kaydı birleştirme (kullanıcı bildirimi 2026-11-10): netscan store.boards_from_devices, MAC'i boş eski bir kayıt
-- (loglardan açılmış — yalnız bilgisayar adı/IP) varken aynı tahta için MAC'li ikinci kayıt açabiliyordu (ör. "A1-1"
-- etap-973494 + "A Blok - 10C" ETAP-973494). Kural düzeltildi (artık eski kayıt sahiplenilir); bu göç oluşmuş çiftleri birleştirir:
-- eski (MAC'siz) kayıt kalır — geçmişi onda —, yeni kaydın verileri ona taşınır, MAC'i ona yazılır, yeni kayıt silinir.
-- Eşleşme: bilgisayar adı (büyük/küçük harf duyarsız) aynı, yeni kayıt ağ taramasından (source 'scan') ve eskiden sonra açılmış.
BEGIN;
CREATE TEMP TABLE board_merge ON COMMIT DROP AS
SELECT DISTINCT ON (n.id) o.id AS keep_id, n.id AS drop_id, n.mac, n.wifi_mac
FROM boards n JOIN boards o ON o.id < n.id AND o.mac IS NULL AND lower(o.hostname) = lower(n.hostname)
WHERE n.source = 'scan' AND n.mac IS NOT NULL AND n.hostname IS NOT NULL
ORDER BY n.id, o.id;

-- Aynı iş iki kaydı da hedeflediyse (çoklu tahta işi) yinelenen hedef satırı düşer (PK job_id, board_id).
DELETE FROM job_targets t USING board_merge m
WHERE t.board_id = m.drop_id AND EXISTS (SELECT 1 FROM job_targets k WHERE k.job_id = t.job_id AND k.board_id = m.keep_id);
UPDATE job_targets t SET board_id = m.keep_id FROM board_merge m WHERE t.board_id = m.drop_id;
UPDATE command_log t SET board_id = m.keep_id FROM board_merge m WHERE t.board_id = m.drop_id;
UPDATE board_sessions t SET board_id = m.keep_id FROM board_merge m WHERE t.board_id = m.drop_id;
UPDATE webshell_sessions t SET board_id = m.keep_id FROM board_merge m WHERE t.board_id = m.drop_id;
UPDATE anomalies t SET board_id = m.keep_id FROM board_merge m WHERE t.board_id = m.drop_id;
UPDATE screenshots t SET board_id = m.keep_id FROM board_merge m WHERE t.board_id = m.drop_id;
UPDATE chat_messages t SET board_id = m.keep_id FROM board_merge m WHERE t.board_id = m.drop_id;
UPDATE session_activity t SET board_id = m.keep_id FROM board_merge m WHERE t.board_id = m.drop_id;
UPDATE session_league_parts t SET board_id = m.keep_id FROM board_merge m WHERE t.board_id = m.drop_id;
-- Gün/tahta tekil özetleri (break_league_*) ve tahta başına tekil tablolar taşınmaz: worker yeniden hesaplar / eski kayıtta var.

DELETE FROM boards b USING board_merge m WHERE b.id = m.drop_id;
UPDATE boards b SET mac = m.mac, wifi_mac = COALESCE(b.wifi_mac, m.wifi_mac), updated_at = now()
FROM board_merge m WHERE b.id = m.keep_id;
COMMIT;
