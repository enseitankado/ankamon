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

"""Teneffüs Ligi verisi: ders aralarında açık kalan tahtalar → break_league_days. Bkz. db/migrations/041_break_league.sql.

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
_FINAL_LAG = 2  # bu kadar günden eski günler kesinleşmiş sayılır

_COMPUTE = r"""
WITH brk AS (SELECT * FROM unnest(%(starts)s::time[], %(ends)s::time[]) AS b(s, e)),
days AS (SELECT d::date AS day FROM generate_series(%(d1)s::date, %(d2)s::date, interval '1 day') d
         WHERE extract(isodow FROM d)::int = ANY(%(dows)s::int[])),
win AS (SELECT d.day, range_agg(tstzrange((d.day + b.s)::timestamptz, (d.day + b.e)::timestamptz)) AS w,
               sum(GREATEST(0, extract(epoch FROM LEAST((d.day + b.e)::timestamptz, now()) - (d.day + b.s)::timestamptz)))::int
                   AS break_seconds
        FROM days d CROSS JOIN brk b GROUP BY d.day),
up AS (SELECT w.day, w.break_seconds, u.host, range_agg(tstzrange(u.started_at, u.last_at)) * w.w AS on_mr
       FROM win w JOIN board_uptime u ON u.started_at < (w.day + 1)::timestamptz AND u.last_at > w.day::timestamptz
       GROUP BY w.day, w.break_seconds, w.w, u.host),
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
    if _cursor(conn, _SCHEDULE_CURSOR) != digest:
        # İlk çalışma: bütün geçmiş. Ders saatleri değişti: oturum kaydı hâlâ olan günler yeni pencerelerle yeniden
        # hesaplanır (oturumu silinmiş eski günler yeniden hesaplanırsa "oturum açık" süresi yanlışlıkla sıfırlanırdı).
        sess_first = conn.execute("SELECT min(started_at)::date AS d FROM board_sessions").fetchone()["d"]
        start = max(first, sess_first) if (final is not None and sess_first) else first
    else:
        start = max(first, datetime.date.fromisoformat(final) + datetime.timedelta(days=1)) if final else first
    start = min(start, today - datetime.timedelta(days=_FINAL_LAG))
    start = max(start, first)
    with conn.transaction():
        conn.execute("DELETE FROM break_league_days WHERE day >= %s AND day <= %s", (start, today))
        conn.execute(_COMPUTE, {"d1": start, "d2": today, "dows": days, "starts": starts, "ends": ends})
        _set_cursor(conn, _FINAL_CURSOR, (today - datetime.timedelta(days=_FINAL_LAG + 1)).isoformat())
        _set_cursor(conn, _SCHEDULE_CURSOR, digest)
