-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Ekran görüntüleri (sağ menü Ekran ▸ Ekran görüntüsü al — bkz. worker executor/screenshot.py). Dosya
-- /data/screenshots altındadır ve aynı bilgiler JPEG'in içine de gömülüdür: oturum kayıtları silinse de görüntünün
-- hangi bilgisayara/oturuma ait olduğu, ne zaman kimin çektiği kaybolmaz. Bu yüzden oturum alanları kopyadır, bağ değil.
CREATE TABLE IF NOT EXISTS screenshots (
    id               bigserial PRIMARY KEY,
    board_id         integer REFERENCES boards(id) ON DELETE SET NULL,
    board_name       text NOT NULL,
    session_id       bigint,
    session_username text,
    taken_at         timestamptz NOT NULL DEFAULT now(),
    taken_by         text NOT NULL,
    file             text NOT NULL,
    bytes            bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS screenshots_board_idx ON screenshots (board_id, taken_at DESC);

-- Sohbet (sağ menü Sohbet — bkz. worker screen/chat.py). direction: 'out' Ankamon'dan tahtaya, 'in' tahtadan.
CREATE TABLE IF NOT EXISTS chat_messages (
    id               bigserial PRIMARY KEY,
    board_id         integer REFERENCES boards(id) ON DELETE SET NULL,
    board_name       text NOT NULL,
    session_username text,
    direction        text NOT NULL CHECK (direction IN ('in', 'out')),
    author           text NOT NULL,
    body             text NOT NULL,
    sent_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_board_idx ON chat_messages (board_id, sent_at DESC);

-- Ekran aktarımı (sağ menü Ekran ▸ Ekranı başka bilgisayara aktar — bkz. worker executor/relay.py): gösteren tahta
-- başına bir satır; bir tahta aynı anda tek kaynağı gösterir.
CREATE TABLE IF NOT EXISTS screen_relays (
    target_board_id integer PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
    source_board_id integer NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    stream          text NOT NULL,
    started_by      text,
    started_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS screen_relays_source_idx ON screen_relays (source_board_id);

-- Tahtaya özel root parolası (Parola ayarla ▸ Yönetici hesapları — bkz. worker executor/board_password.py): genel
-- parola (settings.ssh_access) o tahtada geçmiyorsa SSH bununla yapılır. Satır yoksa genel parola geçerlidir.
CREATE TABLE IF NOT EXISTS board_credentials (
    board_id      integer PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
    root_password text NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Klavye/fare/dokunmatik kilidi (sağ menü Ekran — bkz. worker executor/inputlock.py): tahtada kurulu kilitler.
-- Oturum yoklamasında okunur ("I" satırı, executor/session_probe.py), iş başarılı olunca runner hemen yazar.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS input_locks text[] NOT NULL DEFAULT '{}';
