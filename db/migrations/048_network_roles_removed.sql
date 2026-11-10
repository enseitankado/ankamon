-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Ağ rolleri kalktı (kullanıcı isteği 2026-11-10): tahta ağı / idari ağ ayrımı yok; Ankamon bütün hizmetlerini sunucunun
-- bütün ağ arabirimleri üzerinden yürütür (bkz. worker/ankamon/netroles.py). Eski seçim (Ayarlar ▸ Ağ arabirimleri'ndeki
-- "Tahta ağı" / "İdari ağ") silinir; Ayarlar ▸ Ağ arabirimleri artık yalnız kartları listeler.
DELETE FROM settings WHERE key = 'network_roles';
