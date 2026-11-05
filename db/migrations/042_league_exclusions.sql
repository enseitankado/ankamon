-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Lig dışı bırakılanlar (Oturumlar ▸ Şampiyonlar Ligi / Teneffüs Ligi): görev gereği sürekli açık ya da sürekli oturumlu
-- kalan tahtalar (ör. nöbetçi/idare bilgisayarı) ve kullanıcılar listenin başını hep tuttuğundan sıralamadan çıkarılabilir.
-- Kayıt veri SİLMEZ: lig API'leri (Api\SessionLeagueApi, Api\BreakLeagueApi) varsayılan olarak bunları saymaz;
-- with_excluded=1 ile işaretli olarak katılır. Her lig kendi listesini tutar.
--   league : 'session' (Şampiyonlar Ligi) | 'break' (Teneffüs Ligi)
--   kind   : 'user' (tahta kullanıcı adı, küçük harf) | 'board' (tahta host adı — lig tablolarındaki host)
CREATE TABLE IF NOT EXISTS league_exclusions (
    league     text NOT NULL CHECK (league IN ('session', 'break')),
    kind       text NOT NULL CHECK (kind IN ('user', 'board')),
    value      text NOT NULL CHECK (value <> ''),
    created_by text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (league, kind, value)
);
