-- Görülen akış yoğunluğu: sunucunun telde PASİF gördüğü (broadcast/multicast/sunucuya gelen) paketlerden
-- cihaz başına yoğunluk (bkz. worker netscan/flows.py, bellek network-usage-study). IP ID'nin aksine tüm
-- cihazlarda çalışır (kaynak MAC ile eşlenir). flow_at = son gözlem penceresi; görülmeyen cihaz eski
-- değeri tutar, arayüz flow_at eskiyse göstermez. flow_proto = o pencerede baskın protokol ("neden").
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS flow_pps   real;
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS flow_kbps  real;
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS flow_proto text;
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS flow_at    timestamptz;
