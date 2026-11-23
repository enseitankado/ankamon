-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- "Akıllı Tahtalar" artık sabit bir menü değil, bir varlık grubu (kullanıcı isteği 2026-11-23): bütün gruplar aynı sayfayı
-- (page.Devices, araç çubuğu ve Ekranlar ile) ve altlarında koşullu Ligler/Ahenk/Oturumlar/Sensörler düğümlerini taşır.
-- Kesintisiz geçiş için bugünkü akıllı tahtalarla (Varlıklar'da türü "Akıllı tahta") bir grup kurulur — yalnız o adda grup
-- yoksa (kullanıcı silip yeniden kurmuşsa ya da başka adla tutuyorsa dokunulmaz). Sonradan eklenen tahtalar gruba
-- Varlıklar'dan elle eklenir (gruplar seçimle kurulur).
INSERT INTO net_device_groups (name, created_by)
SELECT 'Akıllı Tahtalar', 'göç 058'
WHERE NOT EXISTS (SELECT 1 FROM net_device_groups WHERE lower(name) = lower('Akıllı Tahtalar'));

INSERT INTO net_device_group_members (group_id, device_id)
SELECT g.id, d.id
FROM net_device_groups g, net_devices d
WHERE g.created_by = 'göç 058' AND lower(g.name) = lower('Akıllı Tahtalar')
  AND COALESCE(NULLIF(d.device_type, ''), d.type_auto) = 'Akıllı tahta'
ON CONFLICT DO NOTHING;
