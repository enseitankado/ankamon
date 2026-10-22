-- Ekranlar önizlemesinin alt barı için oturum yoklamasının (worker executor/session_probe.py, 30 sn) aynı
-- SSH turunda okunanlar:
--  netifs: fiziksel ağ arabirimleri ve yapılandırmaları {"wifi_radio": bool|null, "ifaces": [{name, kind
--          (ethernet|wifi|other), up, oper, carrier, mac, speed, driver, state, connection, method, ipv4[],
--          gateway, dns[], ipv6[], ssid, signal, rate}]} — bkz. executor/netif.py
--  autoshutdown: TiHA geri sayımlı otomatik kapatma {"phase", "kind", "countdown", "dialog_at", "off_at"}
--          (epoch ms); uygulanmıyorsa NULL — bkz. executor/autoshutdown.py
ALTER TABLE boards ADD COLUMN IF NOT EXISTS netifs jsonb;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS autoshutdown jsonb;
