-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Teneffüs Ligi (Oturumlar ▸ Teneffüs Ligi): ders aralarında (Ayarlar ▸ Ders saatleri'ndeki ardışık dersler arası —
-- teneffüsler ve öğle arası) AÇIK kalan tahtaların gün başına süresi; worker/ankamon/tasks/break_league.py doldurur,
-- backend Api\BreakLeagueApi günlük/haftalık/aylık/dönemlik/yıllık sıralar. Kaynaklar: board_uptime (tahtanın açık
-- aralıkları) ∩ teneffüs pencereleri; session_seconds bunun oturum AÇIKKEN geçen kısmı (board_sessions ile kesişim),
-- kalan (on_seconds - session_seconds) oturum kapalıyken (giriş ekranında) açık kalınan süre. Satır yalnız teneffüste
-- açık kalan tahta için yazılır. Kaynak oturum/aralık silinse de satırlar kalır (Şampiyonlar Ligi ile aynı ilke).
--   break_seconds : o gün o ana dek geçmiş teneffüslerin toplam süresi (oran için: açık kalınan / teneffüs).
CREATE TABLE IF NOT EXISTS break_league_days (
    day             date NOT NULL,
    host            text NOT NULL,
    board_id        integer REFERENCES boards(id) ON DELETE SET NULL,
    on_seconds      integer NOT NULL CHECK (on_seconds >= 0),
    session_seconds integer NOT NULL CHECK (session_seconds >= 0),
    break_seconds   integer NOT NULL CHECK (break_seconds >= 0),
    computed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (day, host)
);
CREATE INDEX IF NOT EXISTS break_league_days_host_idx ON break_league_days (host, day);

-- Worker durumu: kesinleşmiş son gün (final_day, YYYY-AA-GG) ve hesapta kullanılan ders saatlerinin özeti (schedule);
-- özet değişince oturum kaydı olan günler yeni saatlerle yeniden hesaplanır (task_cursors yalnız zaman damgası tutar).
CREATE TABLE IF NOT EXISTS break_league_state (
    key   text PRIMARY KEY,
    value text NOT NULL
);
