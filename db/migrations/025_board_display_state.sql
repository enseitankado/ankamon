-- Tahta ekranının (etkin VT'deki X) monitör güç durumu: xset q "Monitor is On/Off/Standby/Suspend"
-- (NULL = bilinmiyor / X yok). Oturum durumuyla aynı periyodik SSH yoklamasında okunur (bkz. worker
-- executor/session_probe.py); Ekranlar önizlemesi "Ekran güç tasarrufu kipinde" yazısını buna göre gösterir
-- — DPMS ile kapalı monitörde x11vnc görüntüsü siyaha dönmediğinden önizlemeden anlaşılamaz (ölçüldü).
-- Sağ menü Ekran ▸ Uyandır başarılı olunca hemen 'On' yazılır (bkz. runner).
ALTER TABLE boards ADD COLUMN IF NOT EXISTS display_state text;
