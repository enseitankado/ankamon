-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Yönetilemeyen cihazın Ankamon'a katılımı (kullanıcı isteği 2026-11-24 — bkz. backend Api/EnrollApi.php): yönetici süreli
-- bir kod üretir; cihazda `curl -sL <sunucu>/k/<kod> | sh` betiği çeker (OpenSSH kurar, root parolasını Ayarlar ▸ Cihaz
-- erişimi'ndekiyle aynı yapar), sonunda cihaz kendini /k/<kod>/done ile bildirir (cihaz kaydı yoksa açılır).
-- Kod süresi dolunca betik verilmez (betikte parola özeti vardır). Satırlar 30 gün sonra silinir (EnrollApi::create).
CREATE TABLE IF NOT EXISTS device_enroll_tokens (
    code        text PRIMARY KEY,
    created_by  integer REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked     boolean NOT NULL DEFAULT false,
    fetches     integer NOT NULL DEFAULT 0,
    last_fetch_at timestamptz,
    last_fetch_ip text,
    -- Katılan cihazlar: [{at, ip, hostname, mac, os, device_id, created}]
    joined      jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS device_enroll_tokens_expires ON device_enroll_tokens (expires_at);
