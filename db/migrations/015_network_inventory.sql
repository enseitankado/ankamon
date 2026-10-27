-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Ağ envanteri: bu sunucunun bağlı olduğu fiziksel ağlar ve o ağlarda görülen (çevrimiçi/çevrimdışı)
-- bütün cihazlar. Tarayan: worker/ankamon/netscan (supervisord "netscan"). Arayüz: sol menü "Ağ".
--
-- Cihazın kimliği MAC adresidir (IP değişebilir): aynı ağda aynı MAC tek kayıttır. Cihaz bir daha
-- görülmese de kayıt silinmez — "çevrimdışı" olarak kalır (envanter); yalnız kullanıcı siler.

-- Ağlar CIDR'e göre tekildir: aynı alt ağa iki arabirimle bağlı makinede (ör. eth0+eth1) tek ağ olur.
CREATE TABLE IF NOT EXISTS net_networks (
    id            serial PRIMARY KEY,
    cidr          cidr NOT NULL UNIQUE,
    -- Kullanıcının verdiği ad (boşsa arayüz CIDR + arabirimleri gösterir).
    name          text NOT NULL DEFAULT '',
    ifaces        text[] NOT NULL DEFAULT '{}',
    local_ip      inet,
    gateway       inet,
    -- Sunucu şu an bu ağa bağlı mı (arabirim söküldü / segment değişti → false, kayıtlar kalır).
    attached      boolean NOT NULL DEFAULT true,
    scan_enabled  boolean NOT NULL DEFAULT true,
    notes         text NOT NULL DEFAULT '',
    last_scan_at  timestamptz,
    last_scan_ms  integer,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS net_devices (
    id                   serial PRIMARY KEY,
    network_id           integer NOT NULL REFERENCES net_networks (id) ON DELETE CASCADE,
    mac                  macaddr NOT NULL,
    ip                   inet,
    hostname             text NOT NULL DEFAULT '',
    -- Kullanıcı alanları (tarayıcı bunlara dokunmaz).
    label                text NOT NULL DEFAULT '',
    device_type          text NOT NULL DEFAULT '',   -- elle seçilen tür (boşsa type_auto)
    model                text NOT NULL DEFAULT '',   -- elle girilen model (boşsa model_auto)
    notes                text NOT NULL DEFAULT '',
    -- Tarayıcının çıkardıkları.
    vendor               text NOT NULL DEFAULT '',   -- MAC üretici tablosundan (Wireshark manuf)
    type_auto            text NOT NULL DEFAULT '',
    model_auto           text NOT NULL DEFAULT '',
    os_guess             text NOT NULL DEFAULT '',
    -- nmap OS sınıfı vb. (yeniden sınıflandırma için): {os_type, os_vendor}
    scan_info            jsonb NOT NULL DEFAULT '{}',
    source               text NOT NULL DEFAULT 'scan', -- scan | manual | self
    online               boolean NOT NULL DEFAULT false,
    misses               integer NOT NULL DEFAULT 0,  -- üst üste görülmediği tarama sayısı
    first_seen_at        timestamptz,
    last_seen_at         timestamptz,
    state_changed_at     timestamptz,
    services_scanned_at  timestamptz,
    -- Kullanıcı "Servisleri tara" dedi: sıranın başına alınır, makine orta yükteyken de taranır.
    services_requested_at timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (network_id, mac)
);
CREATE INDEX IF NOT EXISTS net_devices_mac_idx ON net_devices (mac);

-- Cihazın açık portları ve üzerlerinde çalışan servisler (nmap -sV). Son servis taramasında
-- görülmeyen port satırı silinir.
CREATE TABLE IF NOT EXISTS net_services (
    device_id     integer NOT NULL REFERENCES net_devices (id) ON DELETE CASCADE,
    proto         text NOT NULL,
    port          integer NOT NULL,
    service       text NOT NULL DEFAULT '',
    product       text NOT NULL DEFAULT '',
    version       text NOT NULL DEFAULT '',
    extra         text NOT NULL DEFAULT '',
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, proto, port)
);

-- Tarayıcının anlık durumu (tek satır): arayüz birkaç saniyede bir bunu okur; version her cihaz
-- değişikliğinde artar — arayüz yalnız version değişince cihaz listesini yeniden çeker.
CREATE TABLE IF NOT EXISTS netscan_state (
    id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    version     bigint NOT NULL DEFAULT 0,
    state       jsonb NOT NULL DEFAULT '{}',
    updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO netscan_state (id) VALUES (1) ON CONFLICT DO NOTHING;
