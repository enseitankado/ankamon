-- Ağ paylaşımları: NetBIOS/SMB portu (139/445) açık cihazlarda bulunan paylaşımlar (klasör/yazıcı).
-- Ayrı bir tarama kanalı (worker/ankamon/netscan _shares_loop) varlık/servis taramasıyla EŞ ZAMANLI
-- çalışır; smbclient ile önce anonim (guest), olmazsa kayıtlı Samba kimliğiyle paylaşımları listeler.
-- Arayüzde cihazın alt ağacında, portların yanında klasör simgesiyle gösterilir (bkz. page.Network).

ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS shares_scanned_at   timestamptz;
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS shares_requested_at timestamptz;
-- Son paylaşım taramasının sonucu: guest | creds | denied | unreachable | error | '' (henüz). Arayüzde ipucu.
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS shares_auth text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS net_shares (
    device_id     integer NOT NULL REFERENCES net_devices (id) ON DELETE CASCADE,
    name          text NOT NULL,
    stype         text NOT NULL DEFAULT 'disk',  -- disk | printer
    comment       text NOT NULL DEFAULT '',
    path          text NOT NULL DEFAULT '',      -- gösterim yolu, ör. \\etap-92b257\root
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, name)
);
