-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Varlık grupları (Ağ ▸ Varlıklar ▸ <grup>): Tüm Varlıklar grid'inde işaretli varlıklardan kurulan adlı alt listeler.
-- Grup kendi başına tarama/keşif YAPMAZ, yalnız net_devices satırlarına bağlantı tutar; varlık Tüm Varlıklar'dan
-- silinince (DELETE FROM net_devices) bütün gruplarından da düşer (ON DELETE CASCADE). Arayüz: page.Network setGroup,
-- API: Api\NetworkApi groups/createGroup/updateGroup/deleteGroup/groupMembers.
CREATE TABLE IF NOT EXISTS net_device_groups (
    id         serial PRIMARY KEY,
    name       text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 80),
    created_by text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS net_device_groups_name ON net_device_groups (lower(name));

CREATE TABLE IF NOT EXISTS net_device_group_members (
    group_id  int NOT NULL REFERENCES net_device_groups(id) ON DELETE CASCADE,
    device_id int NOT NULL REFERENCES net_devices(id) ON DELETE CASCADE,
    added_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, device_id)
);
CREATE INDEX IF NOT EXISTS net_device_group_members_device ON net_device_group_members (device_id);
