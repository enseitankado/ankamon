-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Web terminal oturumları: Ankamon üzerinden (webssh, /webshell/) tahtalara açılan SSH oturumları
-- — Oturumlar sayfası bunları greeter oturumlarıyla (board_sessions) birlikte listeler.
--
-- Satır üç adımda dolar:
--   1. BoardsApi::shell — kullanıcı web terminal istedi: board_id/username/ip + requested_at.
--   2. webssh kancası (docker/rootfs/webssh-hook.py, WebSocket worker'a iliştiğinde) — aynı IP'li,
--      henüz eşleşmemiş en eski isteğe worker_id + started_at yazar. İstek/bağlantı arasında
--      kimlik taşınamadığından (webssh parametreleri sabit) eşleşme "IP + zaman sırası" iledir.
--   3. webssh kancası (worker kapanınca) — ended_at + end_reason.
-- started_at NULL kalan satırlar bağlantının hiç kurulamadığı isteklerdir; listelenmez, kanca
-- bir günden eskilerini temizler.
--
-- end_reason: closed (oturum kapandı: pencere/sekme kapatıldı, exit, bağlantı koptu)
--             restart (webssh hizmeti yeniden başladı; ended_at o anın tahminidir) | NULL (açık)
CREATE TABLE IF NOT EXISTS webshell_sessions (
    id           bigserial PRIMARY KEY,
    board_id     integer REFERENCES boards(id) ON DELETE SET NULL,
    board_name   text NOT NULL DEFAULT '',
    username     text NOT NULL DEFAULT '',
    ip           text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    worker_id    text,
    started_at   timestamptz,
    ended_at     timestamptz,
    end_reason   text
);
CREATE INDEX IF NOT EXISTS webshell_sessions_pending_idx ON webshell_sessions (ip, requested_at) WHERE worker_id IS NULL;
CREATE INDEX IF NOT EXISTS webshell_sessions_worker_idx ON webshell_sessions (worker_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS webshell_sessions_started_idx ON webshell_sessions (started_at DESC);
