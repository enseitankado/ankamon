-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Cihazın işletim sistemi ailesi (kullanıcı isteği 2026-11-12): Akıllı Tahtalar sağ menüsü / araç çubuğu ve Komut çalıştır
-- işlevleri hedef cihazın OS ailesine göre uygulama seçer (bkz. platforms/catalog.json, platforms/README.md).
-- os_family: elle seçilen aile (Düzenle ▸ İşletim sistemi); NULL = kendiliğinden belirlenir.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS os_family text
    CHECK (os_family IS NULL OR os_family IN ('linux', 'windows', 'macos', 'other'));

-- OS adından aile: Windows / macOS / Linux (Debian tabanlılar dahil) / diğer; boşsa NULL.
CREATE OR REPLACE FUNCTION device_os_family_of(name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN name IS NULL OR btrim(name) = '' THEN NULL
        WHEN name ~* 'windows' THEN 'windows'
        WHEN name ~* '(mac ?os|os x|darwin|apple)' THEN 'macos'
        WHEN name ~* '(linux|pardus|debian|ubuntu|mint|etap)' THEN 'linux'
        ELSE 'other'
    END
$$;

-- TEK ÖLÇÜT (PHP BoardsApi ve worker platforms.py aynı fonksiyonu çağırır): elle seçim > SSH ile toplanan donanım
-- bilgisi (facts.os_name — yalnız Linux toplayıcısı yazar) > ağ taramasının OS tahmini (net_devices.os_guess, kablolu ya da
-- kablosuz MAC eşleşmesi; en yeni görülen) > NULL (bilinmiyor; katalogdaki default_family uygulanır).
CREATE OR REPLACE FUNCTION device_os_family(p_board_id int) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        b.os_family,
        device_os_family_of(b.facts->>'os_name'),
        (SELECT device_os_family_of(d.os_guess) FROM net_devices d
          WHERE d.mac IN (b.mac, b.wifi_mac) AND COALESCE(d.os_guess, '') <> ''
          ORDER BY d.last_seen_at DESC NULLS LAST LIMIT 1))
    FROM boards b WHERE b.id = p_board_id
$$;

-- Ailenin nereden geldiği (arayüz ipucu): manual | ssh | scan | NULL.
CREATE OR REPLACE FUNCTION device_os_source(p_board_id int) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN b.os_family IS NOT NULL THEN 'manual'
        WHEN device_os_family_of(b.facts->>'os_name') IS NOT NULL THEN 'ssh'
        WHEN EXISTS (SELECT 1 FROM net_devices d WHERE d.mac IN (b.mac, b.wifi_mac) AND COALESCE(d.os_guess, '') <> '') THEN 'scan'
    END
    FROM boards b WHERE b.id = p_board_id
$$;
