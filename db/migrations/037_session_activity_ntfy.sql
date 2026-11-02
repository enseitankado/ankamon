-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Oturum hareketleri (Oturumlar ▸ Hareketler — bkz. worker tasks/session_activity.py): loglardan, sensörlerden ve Ankamon
-- işlemlerinden ayıklanmış kronolojik olaylar. Log geldikçe artımlı doldurulur: ekranda her süzmede milyonlarca log satırı
-- taranmaz, loglar saklama süresi dolup silinse de hareketler kalır. Oturum alanları kopyadır, oturum silinse de kaybolmaz.
CREATE TABLE IF NOT EXISTS session_activity (
    id         bigserial PRIMARY KEY,
    at         timestamptz NOT NULL,
    board_id   integer REFERENCES boards(id) ON DELETE SET NULL,
    board_name text NOT NULL,
    session_id bigint,
    username   text,
    kind       text NOT NULL,
    summary    text NOT NULL,
    detail     text,
    source     text
);
CREATE INDEX IF NOT EXISTS session_activity_at_idx ON session_activity (at DESC);
CREATE INDEX IF NOT EXISTS session_activity_board_idx ON session_activity (board_id, at DESC);
CREATE INDEX IF NOT EXISTS session_activity_user_idx ON session_activity (username, at DESC);
CREATE INDEX IF NOT EXISTS session_activity_session_idx ON session_activity (session_id) WHERE session_id IS NOT NULL;

-- ntfy bildirim kuralları (Anomaliler ▸ Bildirimler — bkz. worker tasks/ntfy_notify.py). Boş dizi = hepsi.
-- mode: live (Anlık) | scan (Tarama) | history (Geçmiş) | summary (Özet). interval_minutes: live'da aynı tahta+tür için
-- tekrar sınırı (0 = yok), ötekilerde çalışma aralığı.
CREATE TABLE IF NOT EXISTS ntfy_rules (
    id               serial PRIMARY KEY,
    name             text NOT NULL,
    board_ids        integer[] NOT NULL DEFAULT '{}',
    kinds            text[] NOT NULL DEFAULT '{}',
    mode             text NOT NULL CHECK (mode IN ('live', 'scan', 'history', 'summary')),
    interval_minutes integer NOT NULL DEFAULT 60,
    max_per_hour     integer NOT NULL DEFAULT 20,
    enabled          boolean NOT NULL DEFAULT true,
    last_run_at      timestamptz,
    pending_job      bigint,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- Gönderilen bildirimler (o ekranda ve Disk kullanımında listelenir, silinebilir). Kural silinse de ad kalır.
CREATE TABLE IF NOT EXISTS ntfy_messages (
    id        bigserial PRIMARY KEY,
    sent_at   timestamptz NOT NULL DEFAULT now(),
    rule_id   integer,
    rule_name text NOT NULL,
    topic     text NOT NULL,
    title     text NOT NULL,
    body      text NOT NULL,
    board_id  integer,
    kind      text,
    status    text NOT NULL,
    error     text
);
CREATE INDEX IF NOT EXISTS ntfy_messages_sent_idx ON ntfy_messages (sent_at DESC);

-- Canlı kuralda aynı anomali için ikinci bildirim gitmesin. Geçmiş silinse de yeniden gönderilmez.
CREATE TABLE IF NOT EXISTS ntfy_sent (
    rule_id    integer NOT NULL REFERENCES ntfy_rules(id) ON DELETE CASCADE,
    anomaly_id bigint NOT NULL,
    PRIMARY KEY (rule_id, anomaly_id)
);
