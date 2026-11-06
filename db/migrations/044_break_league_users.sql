-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Teneffüs Ligi kullanıcı bazında (Oturumlar ▸ Teneffüs Ligi ▸ "Kullanıcı adı"): teneffüste açık kalan tahta süresinin
-- kullanıcılara dağılımı, gün × kullanıcı × tahta. worker/ankamon/tasks/break_league.py break_league_days ile aynı turda
-- doldurur; backend Api\BreakLeagueApi (by=users) sıralar. Kaynak oturum/aralık silinse de satırlar kalır.
--   session_seconds : tahtanın teneffüste açık aralıkları ∩ kullanıcının o tahtadaki oturumları
--   idle_seconds    : teneffüste oturum KAPALIYKEN (giriş ekranında) açık kalınan parçalar; her parça tahtanın o
--                     açılışında (board_uptime aralığı) parçadan önce oturumu son kapanan kullanıcıya yazılır (tahtayı
--                     açık bırakan). Açılıştan beri kimse oturum açmadıysa parça hiç kimseye yazılmaz (yalnız tahta
--                     bazındaki break_league_days'te sayılır).
-- etapadmin/root ve lig dışı kullanıcılar (league_exclusions, league 'break', kind 'user') burada tutulur, API'de elenir.
CREATE TABLE IF NOT EXISTS break_league_user_days (
    day             date NOT NULL,
    username        text NOT NULL,
    host            text NOT NULL,
    board_id        integer REFERENCES boards(id) ON DELETE SET NULL,
    session_seconds integer NOT NULL CHECK (session_seconds >= 0),
    idle_seconds    integer NOT NULL CHECK (idle_seconds >= 0),
    computed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (day, username, host)
);
CREATE INDEX IF NOT EXISTS break_league_user_days_user_idx ON break_league_user_days (username, day);
