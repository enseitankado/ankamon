-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Şampiyonlar Ligi (Oturumlar ▸ Şampiyonlar Ligi): tahtalarda açık kalınan oturum süresinin GÜN PARÇALARI.
-- board_sessions'tan worker/ankamon/tasks/session_league.py türetir; kaynak oturum (ya da logları) silinse de
-- parçalar burada kalır — günlük/haftalık/aylık/dönemlik/yıllık sıralama bu tablodan toplanır (bkz.
-- backend Api\SessionLeagueApi). Gece yarısını aşan oturum her yerel güne (sunucu saat dilimi, TZ) ayrı satır
-- olarak bölünür; açık oturum "şu ana kadar" sayılır ve kapanana dek her turda yeniden hesaplanır.
--   session_id   : kaynak board_sessions.id (silinmiş olabilir — bilerek yabancı anahtar YOK)
--   src_ended_at : parça hesaplanırken oturumun ended_at'ı (NULL = açıktı); kaynakta değişirse (session_end
--                  kapanışı sonradan netleştirir) o oturumun parçaları yeniden hesaplanır.
CREATE TABLE IF NOT EXISTS session_league_parts (
    session_id   bigint NOT NULL,
    day          date NOT NULL,
    username     text NOT NULL,
    host         text NOT NULL,
    board_id     integer REFERENCES boards(id) ON DELETE SET NULL,
    seconds      integer NOT NULL CHECK (seconds >= 0),
    src_ended_at timestamptz,
    PRIMARY KEY (session_id, day)
);
CREATE INDEX IF NOT EXISTS session_league_parts_day_idx ON session_league_parts (day, username);

-- Tahta hesaplarının ad soyadı (ETAP'ta GECOS): tahtadan hesap listesi çeken "accounts" işlerinin çıktısından
-- toplanır (iş geçmişi silinse de kalır) — sıralamada kullanıcı adının yanında gösterilir.
CREATE TABLE IF NOT EXISTS session_league_names (
    username   text PRIMARY KEY,
    full_name  text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
