-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Bildirim kuralı çalışma biçimleri ikiye indi (Anomaliler ▸ Bildirimler): live (anomali başlayınca) ve summary (düzenli özet).
-- Geçmiş (history), özetin neredeyse aynısıydı: özete döner, aralıkları özette de seçilebilir.
-- Tarama (scan), sürekli izlenen türleri her turda SSH ile yeniden yokluyor ve aynı bulguyu tekrar gönderiyordu: anlık kurala
-- döner, aralık anlık kuralın tekrar sınırındaki en yakın büyük değere çekilir.
UPDATE ntfy_rules SET mode = 'summary', last_run_at = NULL WHERE mode = 'history';
UPDATE ntfy_rules
   SET mode = 'live', last_run_at = NULL,
       interval_minutes = CASE WHEN interval_minutes <= 15 THEN 15 WHEN interval_minutes <= 60 THEN 60
                               WHEN interval_minutes <= 240 THEN 240 ELSE 1440 END
 WHERE mode = 'scan';
ALTER TABLE ntfy_rules DROP COLUMN IF EXISTS pending_job;
ALTER TABLE ntfy_rules DROP CONSTRAINT IF EXISTS ntfy_rules_mode_check;
ALTER TABLE ntfy_rules ADD CONSTRAINT ntfy_rules_mode_check CHECK (mode IN ('live', 'summary'));
