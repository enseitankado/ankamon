-- Ağ etkinliği: cihazın IP ID sayacından türetilen kaba paket/sn tahmini (bkz. worker netscan/activity.py,
-- bellek network-usage-study). Yalnız Windows güvenilirdir (tek global sayaç); Linux/kamera/router ID'yi
-- rastgele artırdığından örneklenmez. activity_pps NULL = ölçülmedi/güvenilmez (Windows değil, yanıt yok,
-- ya da sayaç sıfırlanması). activity_at = son örnekleme anı.
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS activity_pps real;
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS activity_at  timestamptz;
