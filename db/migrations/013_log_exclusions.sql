-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Loglar grid'inden dışlanan (önemsiz sayılan) mesajlar: grid'de HERKES için gizlenir, kayıtlar
-- silinmez (bkz. backend LogsApi::index NOT EXISTS koşulu, LogExclusionsApi). Eşleşme: mesaj
-- `pattern`'i (büyük/küçük harf duyarlı, birebir alt metin) İÇERİYORSA ve `program` NULL ya da
-- kaydın programına eşitse. Örnek: Pardus pam_etap.py'nin her SSH girişinde bastığı
-- "pam_sm_open_session() isn't defined." (bkz. memory etap-pam-log-noise).
CREATE TABLE IF NOT EXISTS log_exclusions (
    id          serial PRIMARY KEY,
    pattern     text NOT NULL CHECK (length(pattern) >= 8),
    program     text,
    created_by  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (pattern, program)
);
