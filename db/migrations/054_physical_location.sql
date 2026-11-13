-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Fiziksel konum (kullanıcı isteği 2026-11-13): ağda tespit edilen HER varlığın (net_devices) bulunduğu yer — Tesis Envanteri
-- Kodlama Sistemi'nde il.ilçe.tesis.bina.kat.salon (ör. 55.11.165.1.2.15); serbest metin de yazılabilir. Akıllı tahtaların
-- devices.location sütunu (001) zaten vardı: iki kayıt AYNI değeri taşır — biri değişince MAC eşleşmesiyle (kablolu ya da
-- kablosuz) öteki de güncellenir, taramayla yeni açılan varlık kaydı cihazın konumunu alır. Böylece Varlıklar, varlık grupları,
-- Akıllı Tahtalar ve Cihaz ayrıntıları hangi API'den yazılırsa yazılsın aynı konumu gösterir.
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '';

-- Mevcut cihaz konumları varlık kayıtlarına.
UPDATE net_devices nd SET location = b.location
  FROM devices b
 WHERE (nd.mac = b.mac OR nd.mac = b.wifi_mac) AND b.location <> '' AND nd.location = '';

CREATE OR REPLACE FUNCTION physical_location_from_device() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE net_devices SET location = NEW.location
     WHERE (mac = NEW.mac OR mac = NEW.wifi_mac) AND location IS DISTINCT FROM NEW.location;
    RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION physical_location_from_asset() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE devices SET location = NEW.location
     WHERE (mac = NEW.mac OR wifi_mac = NEW.mac) AND location IS DISTINCT FROM NEW.location;
    RETURN NULL;
END
$$;

-- Taramayla yeni açılan varlık kaydı (ör. tahta Wi-Fi'ye geçti) bağlı cihazın konumunu alır.
CREATE OR REPLACE FUNCTION physical_location_on_asset_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.location = '' THEN
        NEW.location := COALESCE((SELECT b.location FROM devices b
                                   WHERE (b.mac = NEW.mac OR b.wifi_mac = NEW.mac) AND b.location <> ''
                                   ORDER BY (b.mac = NEW.mac) IS TRUE DESC, b.id LIMIT 1), '');
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS physical_location_sync ON devices;
CREATE TRIGGER physical_location_sync AFTER UPDATE OF location ON devices
    FOR EACH ROW WHEN (OLD.location IS DISTINCT FROM NEW.location) EXECUTE FUNCTION physical_location_from_device();
DROP TRIGGER IF EXISTS physical_location_sync_new ON devices;
CREATE TRIGGER physical_location_sync_new AFTER INSERT ON devices
    FOR EACH ROW WHEN (NEW.location <> '') EXECUTE FUNCTION physical_location_from_device();

DROP TRIGGER IF EXISTS physical_location_sync ON net_devices;
CREATE TRIGGER physical_location_sync AFTER UPDATE OF location ON net_devices
    FOR EACH ROW WHEN (OLD.location IS DISTINCT FROM NEW.location) EXECUTE FUNCTION physical_location_from_asset();
DROP TRIGGER IF EXISTS physical_location_inherit ON net_devices;
CREATE TRIGGER physical_location_inherit BEFORE INSERT ON net_devices
    FOR EACH ROW EXECUTE FUNCTION physical_location_on_asset_insert();
