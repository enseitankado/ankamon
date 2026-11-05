# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
# Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
# https://github.com/enseitankado/ankamon
#
# Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
# GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
# daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
# değiştirebilirsiniz.
#
# Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
# YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
# verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
#
# Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
# dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
# adresine bakınız.
#
# Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
# parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
# lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
# korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
# kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).

"""Şampiyonlar Ligi verisi: board_sessions → session_league_parts (oturumun gün parçaları) ve
"accounts" iş çıktılarından → session_league_names (hesapların ad soyadı). Bkz. db/migrations/039_session_league.sql.

Artımlı ve tekrar çalıştırmaya dayanıklı: her turda yalnız parçası olmayan, açık ya da parçası hesaplandıktan sonra
kapanışı/tahtası değişen oturumlar yeniden hesaplanır (o oturumun parçaları silinip baştan yazılır). İlk çalışmada
parçası olmayan bütün oturumlar — yani eldeki bütün geçmiş — bir kerede işlenir. Kaynak oturum silinince parçalar
kalır (bilerek: sıralama log/oturum temizliğinden etkilenmez). Günler sunucu saat diliminde (TZ, varsayılan
Europe/Istanbul) yerel gündür; gece yarısını aşan oturum her güne ayrı satırdır.
"""

from __future__ import annotations

import datetime
import json
import logging

log = logging.getLogger(__name__)

_NAMES_CURSOR = "session_league.names"

# Parçası güncel olmayan oturumlar: hiç parçası yok, açık (süre "şu ana kadar" büyüyor) ya da parçası hesaplandığından
# beri kapanış anı (session_end sonradan netleştirir) veya tahtası (sonradan tahtaya bağlanan oturum) değişmiş.
_STALE_SESSIONS = """
    SELECT s.id FROM board_sessions s
    WHERE s.ended_at IS NULL
       OR NOT EXISTS (SELECT 1 FROM session_league_parts p
                      WHERE p.session_id = s.id
                        AND p.src_ended_at IS NOT DISTINCT FROM s.ended_at
                        AND p.board_id IS NOT DISTINCT FROM s.board_id)
"""

# Her oturum en az bir satır üretir (süresi 0 olsa da) — yoksa her turda yeniden "parçasız" görünürdü.
_WRITE_PARTS = """
    INSERT INTO session_league_parts (session_id, day, username, host, board_id, seconds, src_ended_at)
    SELECT s.id, g.day, s.username, s.host, s.board_id,
           GREATEST(0, round(extract(epoch FROM
               LEAST(COALESCE(s.ended_at, now()), (g.day + 1)::timestamptz)
               - GREATEST(s.started_at, g.day::timestamptz))))::integer,
           s.ended_at
    FROM board_sessions s
    CROSS JOIN LATERAL (
        SELECT d::date AS day
        FROM generate_series(s.started_at::date::timestamp,
                             GREATEST(COALESCE(s.ended_at, now()), s.started_at)::date::timestamp,
                             interval '1 day') AS d
    ) g
    WHERE s.id = ANY(%(ids)s)
"""


def _refresh_parts(conn) -> None:
    ids = [r["id"] for r in conn.execute(_STALE_SESSIONS).fetchall()]
    if not ids:
        return
    with conn.transaction():
        conn.execute("DELETE FROM session_league_parts WHERE session_id = ANY(%(ids)s)", {"ids": ids})
        conn.execute(_WRITE_PARTS, {"ids": ids})


def _refresh_names(conn) -> None:
    """Tahtadan hesap listesi çeken işlerin (bkz. executor/accounts.py; çıktı [{name, full_name}] JSON'u) yeni
    sonuçlarından ad soyadı alır; en yeni iş kazanır."""
    row = conn.execute("SELECT value FROM task_cursors WHERE name = %s", (_NAMES_CURSOR,)).fetchone()
    since = row["value"] if row else datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    rows = conn.execute(
        """SELECT t.output, t.finished_at FROM job_targets t JOIN jobs j ON j.id = t.job_id
           WHERE j.type = 'accounts' AND t.status = 'ok' AND t.finished_at > %s
           ORDER BY t.finished_at ASC""", (since,)).fetchall()
    if not rows:
        return
    names = {}
    for r in rows:
        try:
            accounts = json.loads(r["output"] or "[]")
        except ValueError:
            continue
        for acc in accounts if isinstance(accounts, list) else []:
            if not isinstance(acc, dict):
                continue
            name, full = acc.get("name"), (acc.get("full_name") or "").strip()
            if name and full and full != name:
                names[name] = full
    with conn.transaction():
        for name, full in names.items():
            conn.execute(
                """INSERT INTO session_league_names (username, full_name, updated_at) VALUES (%s, %s, now())
                   ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name, updated_at = now()
                   WHERE session_league_names.full_name IS DISTINCT FROM EXCLUDED.full_name""",
                (name, full))
        conn.execute(
            """INSERT INTO task_cursors (name, value, updated_at) VALUES (%s, %s, now())
               ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
            (_NAMES_CURSOR, rows[-1]["finished_at"]))


def run(conn) -> None:
    _refresh_parts(conn)
    _refresh_names(conn)
