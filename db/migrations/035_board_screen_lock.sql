-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Ankamon ekran kilidi (sağ menü Ekran ▸ Kilitle / Kilidi aç — bkz. worker executor/screenlock.py): tahtada
-- kilit kurulu mu. Oturum durumuyla aynı periyodik SSH yoklamasında okunur (executor/session_probe.py, "L"
-- satırı); iş başarılı olunca runner hemen yazar. Tahtalar grid'inin "Oturum" hücresi "… / Kilitli" gösterir.
-- Oturum kilidinden (session_locked — LightDM dm-tool lock, parolayla açılır) ayrıdır.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS screen_locked boolean NOT NULL DEFAULT false;
