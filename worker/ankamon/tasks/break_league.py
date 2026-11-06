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

"""Teneffüs Ligi verisi: ders aralarında açık kalan tahtalar → break_league_days, kullanıcı bazında →
break_league_user_days. Bkz. db/migrations/041_break_league.sql, 044_break_league_users.sql.

Teneffüs pencereleri Ayarlar ▸ Ders saatleri'nden (settings.lesson_times): tanımlı okul günlerinde ardışık iki dersin
arası (teneffüsler ve öğle arası; ilk dersten önce ve son dersten sonra sayılmaz). Tahta başına gün başına:
  on_seconds      = tahtanın açık aralıkları (board_uptime) ∩ teneffüs pencereleri
  session_seconds = on_seconds'ın oturum açıkken geçen kısmı (∩ board_sessions; örtüşen oturumlar birleştirilir)
Aralıklar PostgreSQL multirange (range_agg, *) ile birleştirilip kesiştirilir.

Artımlı: break_league_state'te "kesinleşmiş son gün" tutulur; her turda ondan sonraki günler (en çok _FINAL_LAG gün geriye,
board_uptime/session_end kapanışları sonradan netleştirebildiğinden) yeniden hesaplanır. Ders saatleri değişirse oturum
kaydı hâlâ bulunan günler yeni saatlerle baştan hesaplanır; oturum kaydı silinmiş eski günler eldeki haliyle kalır.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import logging

log = logging.getLogger(__name__)

_FINAL_CURSOR = "break_league.final_day"
_SCHEDULE_CURSOR = "break_league.schedule"
_USERS_CURSOR = "break_league.users"  # kullanıcı tablosu (göç 044) dolduruldu mu — yoksa oturum kaydı olan günler baştan
_FINAL_LAG = 2  # bu kadar günden eski günler kesinleşmiş sayılır

# Ortak kısım: teneffüs pencereleri (win) ve tahtanın gün başına teneffüste açık kaldığı aralıklar (up.on_mr).
_BREAK_UP_CTE = r"""
WITH brk AS (SELECT * FROM unnest(%(starts)s::time[], %(ends)s::time[]) AS b(s, e)),
days AS (SELECT d::date AS day FROM generate_series(%(d1)s::date, %(d2)s::date, interval '1 day') d
         WHERE extract(isodow FROM d)::int = ANY(%(dows)s::int[])),
win AS (SELECT d.day, range_agg(tstzrange((d.day + b.s)::timestamptz, (d.day + b.e)::timestamptz)) AS w,
               sum(GREATEST(0, extract(epoch FROM LEAST((d.day + b.e)::timestamptz, now()) - (d.day + b.s)::timestamptz)))::int
                   AS break_seconds
        FROM days d CROSS JOIN brk b GROUP BY d.day),
up AS (SELECT w.day, w.break_seconds, u.host, range_agg(tstzrange(u.started_at, u.last_at)) * w.w AS on_mr
       FROM win w JOIN board_uptime u ON u.started_at < (w.day + 1)::timestamptz AND u.last_at > w.day::timestamptz
       GROUP BY w.day, w.break_seconds, w.w, u.host)
"""

_COMPUTE = _BREAK_UP_CTE + r""",
sess AS (SELECT up.day, up.break_seconds, up.host, up.on_mr,
                up.on_mr * COALESCE((SELECT range_agg(tstzrange(s.started_at, COALESCE(s.ended_at, now())))
                                     FROM board_sessions s
                                     WHERE lower(s.host) = lower(up.host)
                                       AND s.started_at < (up.day + 1)::timestamptz
                                       AND COALESCE(s.ended_at, now()) > up.day::timestamptz),
                                    '{}'::tstzmultirange) AS s_mr
         FROM up WHERE NOT isempty(up.on_mr))
INSERT INTO break_league_days (day, host, board_id, on_seconds, session_seconds, break_seconds)
SELECT day, host,
       (SELECT b.id FROM boards b WHERE lower(b.hostname) = lower(sess.host) ORDER BY b.id LIMIT 1),
       (SELECT COALESCE(sum(extract(epoch FROM upper(r) - lower(r))), 0)::int FROM unnest(on_mr) r),
       (SELECT COALESCE(sum(extract(epoch FROM upper(r) - lower(r))), 0)::int FROM unnest(s_mr) r),
       break_seconds
FROM sess
"""

# Kullanıcı bazında (break_league_user_days, göç 044): tahtanın teneffüste açık aralıkları (up.on_mr)
#   session_seconds = ∩ kullanıcının o tahtadaki oturumları (aynı anda iki kullanıcı oturumluysa ikisine de yazılır)
#   idle_seconds    = oturumsuz parçalar (on_mr - bütün oturumlar); her parça, tahtanın O AÇILIŞINDA (parçayı içeren
#                     board_uptime aralığı) parçadan önce oturumu son kapanan kullanıcıya yazılır — tahtayı giriş
#                     ekranında açık bırakan. Açılıştan beri kimse oturum açmadıysa parça kimseye yazılmaz.
# etapadmin/root ve lig dışılar burada elenmez (API eler): son oturum etapadmin'inse parça etapadmin'e yazılır, sayılmaz.
_COMPUTE_BREAK_USERS = _BREAK_UP_CTE + r""",
upl AS (SELECT up.day, up.host, up.on_mr FROM up WHERE NOT isempty(up.on_mr)),
sess_all AS (SELECT upl.*, COALESCE((SELECT range_agg(tstzrange(s.started_at, COALESCE(s.ended_at, now())))
                                     FROM board_sessions s
                                     WHERE lower(s.host) = lower(upl.host)
                                       AND s.started_at < (upl.day + 1)::timestamptz
                                       AND COALESCE(s.ended_at, now()) > upl.day::timestamptz),
                                    '{}'::tstzmultirange) AS s_mr
             FROM upl),
user_on AS (SELECT upl.day, upl.host, s.username,
                   range_agg(tstzrange(s.started_at, COALESCE(s.ended_at, now()))) AS u_mr
            FROM upl JOIN board_sessions s ON lower(s.host) = lower(upl.host)
                 AND s.started_at < (upl.day + 1)::timestamptz AND COALESCE(s.ended_at, now()) > upl.day::timestamptz
            GROUP BY upl.day, upl.host, s.username),
user_sess AS (SELECT o.day, o.host, o.username,
                     (SELECT COALESCE(sum(extract(epoch FROM upper(r) - lower(r))), 0)
                      FROM unnest(o.u_mr * upl.on_mr) r) AS session_seconds, 0::numeric AS idle_seconds
              FROM user_on o JOIN upl ON upl.day = o.day AND upl.host = o.host),
idle_seg AS (SELECT a.day, a.host, seg FROM sess_all a, unnest(a.on_mr - a.s_mr) seg),
idle_own AS (SELECT i.day, i.host, own.username, 0::numeric AS session_seconds,
                    extract(epoch FROM upper(i.seg) - lower(i.seg)) AS idle_seconds
             FROM idle_seg i
             JOIN LATERAL (SELECT s.username FROM board_sessions s
                           WHERE lower(s.host) = lower(i.host) AND s.ended_at <= lower(i.seg)
                             AND s.ended_at > (SELECT max(u.started_at) FROM board_uptime u
                                               WHERE u.host = i.host AND u.started_at <= lower(i.seg))
                           ORDER BY s.ended_at DESC LIMIT 1) own ON true)
INSERT INTO break_league_user_days (day, username, host, board_id, session_seconds, idle_seconds)
SELECT day, username, host,
       (SELECT b.id FROM boards b WHERE lower(b.hostname) = lower(t.host) ORDER BY b.id LIMIT 1),
       round(sum(session_seconds))::int, round(sum(idle_seconds))::int
FROM (SELECT * FROM user_sess UNION ALL SELECT * FROM idle_own) t
GROUP BY day, username, host
HAVING round(sum(session_seconds)) + round(sum(idle_seconds)) > 0
"""


def _schedule(conn) -> tuple[list[int], list[str], list[str]]:
    """(okul günleri ISO 1-7, teneffüs başlangıçları, bitişleri) — ardışık dersler arası boşluklar."""
    row = conn.execute("SELECT value FROM settings WHERE key = 'lesson_times'").fetchone()
    value = (row["value"] if row else None) or {}
    days = [int(d) for d in value.get("days") or [] if 1 <= int(d) <= 7]
    lessons = sorted((l for l in value.get("lessons") or [] if l.get("start") and l.get("end")), key=lambda l: l["start"])
    starts, ends = [], []
    for prev, nxt in zip(lessons, lessons[1:]):
        if nxt["start"] > prev["end"]:
            starts.append(prev["end"])
            ends.append(nxt["start"])
    return days, starts, ends


def _cursor(conn, name: str):
    row = conn.execute("SELECT value FROM break_league_state WHERE key = %s", (name,)).fetchone()
    return row["value"] if row else None


def _set_cursor(conn, name: str, value: str) -> None:
    conn.execute(
        """INSERT INTO break_league_state (key, value) VALUES (%s, %s)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""", (name, value))


def run(conn) -> None:
    days, starts, ends = _schedule(conn)
    if not days or not starts:
        return  # ders saatleri tanımlı değil: teneffüs yok (arayüz bunu ayrıca söyler)
    digest = hashlib.sha1(json.dumps([days, starts, ends]).encode()).hexdigest()
    today = conn.execute("SELECT current_date AS d").fetchone()["d"]
    first = conn.execute("SELECT min(started_at)::date AS d FROM board_uptime").fetchone()["d"]
    if first is None:
        return
    final = _cursor(conn, _FINAL_CURSOR)
    if _cursor(conn, _SCHEDULE_CURSOR) != digest or _cursor(conn, _USERS_CURSOR) is None:
        # İlk çalışma: bütün geçmiş. Ders saatleri değişti (ya da kullanıcı tablosu yeni eklendi): oturum kaydı hâlâ
        # olan günler yeni pencerelerle yeniden hesaplanır (oturumu silinmiş eski günler yeniden hesaplanırsa "oturum
        # açık" süresi yanlışlıkla sıfırlanırdı).
        sess_first = conn.execute("SELECT min(started_at)::date AS d FROM board_sessions").fetchone()["d"]
        start = max(first, sess_first) if (final is not None and sess_first) else first
    else:
        start = max(first, datetime.date.fromisoformat(final) + datetime.timedelta(days=1)) if final else first
    start = min(start, today - datetime.timedelta(days=_FINAL_LAG))
    start = max(start, first)
    with conn.transaction():
        params = {"d1": start, "d2": today, "dows": days, "starts": starts, "ends": ends}
        conn.execute("DELETE FROM break_league_days WHERE day >= %s AND day <= %s", (start, today))
        conn.execute(_COMPUTE, params)
        conn.execute("DELETE FROM break_league_user_days WHERE day >= %s AND day <= %s", (start, today))
        conn.execute(_COMPUTE_BREAK_USERS, params)
        _set_cursor(conn, _FINAL_CURSOR, (today - datetime.timedelta(days=_FINAL_LAG + 1)).isoformat())
        _set_cursor(conn, _SCHEDULE_CURSOR, digest)
        _set_cursor(conn, _USERS_CURSOR, "1")
