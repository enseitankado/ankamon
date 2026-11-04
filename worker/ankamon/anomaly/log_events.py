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

"""Log olaylarından anomali: aynı tahtada (ve aynı anahtarda, ör. kaynak IP) art arda gelen olaylar bir "atak" olur.

Bir kural yalnız sorgusunu ve eşiklerini verir (bkz. event_rule): sorgu `since`ten sonra gelen olayları
(host, at, key, message) döndürür. Aralarında `gap`ten uzun boşluk olmayan olaylar tek ataktır; en az `min_count`
olaylı atak anomalidir. Son olay `gap` içindeyse atak sürüyor sayılır (ended_at boş).

Pencerenin başında kesilen atak, kayıtlı anomalinin devamıdır: başlangıcı ve olay sayısı kayıttan korunur (yoksa aynı
atak pencere başlangıcıyla ikinci kez yazılırdı — bkz. ntp_unsynced).
"""

from __future__ import annotations

import datetime
from types import SimpleNamespace

BOARDS = """
SELECT id, lower(hostname) AS host, host(ip) AS ip, COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name
FROM boards WHERE hostname IS NOT NULL AND hostname <> ''
"""

KNOWN = """
SELECT host, started_at, ended_at, detail FROM anomalies
WHERE kind = %s AND (ended_at IS NULL OR ended_at >= %s)
ORDER BY started_at
"""


def boards_by_host(conn) -> dict:
    return {r["host"]: r for r in conn.execute(BOARDS).fetchall()}


def board_fields(boards: dict, host: str) -> dict:
    """Kayıt alanları: tahta kayıtlıysa onun kimliği ve adı, değilse logdaki ad."""
    board = boards.get((host or "").lower())
    return {"host": (host or "").lower(), "board_id": board["id"] if board else None,
            "board_name": board["name"] if board else host}


def episodes(rows: list, gap: datetime.timedelta) -> list[list]:
    """Zamana göre sıralı olaylar → ataklar (aralarında gap'ten uzun boşluk olmayan olay grupları)."""
    out, current = [], []
    for r in rows:
        if current and r["at"] - current[-1]["at"] > gap:
            out.append(current)
            current = []
        current.append(r)
    if current:
        out.append(current)
    return out


def known_records(conn, kind: str, since, gap) -> dict:
    known: dict = {}
    for r in conn.execute(KNOWN, (kind, since - gap)).fetchall():
        known.setdefault(r["host"], []).append(r)
    return known


def continue_known(known: dict, host: str, start, gap, key=None, key_field="key"):
    """Pencere başında kesilmiş atak: kayıtlı anomalinin başlangıcı ve ayrıntısı (yoksa None)."""
    for r in known.get(host, []):
        detail = r["detail"] or {}
        if key is not None and detail.get(key_field) != key:
            continue
        if r["started_at"] < start and (r["ended_at"] is None or r["ended_at"] >= start - gap):
            return r
    return None


# Log taraması pahalı: bu kurallar 5 dk'da bir çalışır, pencere de buna göre (her çalışmada son 1 saat; süren atağın
# devamı kayıttan bağlanır, bkz. continue_known).
EVERY = 300
WINDOW = datetime.timedelta(hours=1)


def event_rule(kind: str, query: str, *, gap: datetime.timedelta, min_count: int, text,
               window: datetime.timedelta = WINDOW, params=None) -> SimpleNamespace:
    """Sorgu satırları: host, at, key (atakları ayıran ek anahtar; yoksa ''), message.
    text(olaylar, sayı) → kaydın ayrıntı metni ve ek alanları: (metin, {alanlar})."""

    def detect(conn, since):
        now = conn.execute("SELECT now() AS now").fetchone()["now"]
        boards = boards_by_host(conn)
        rows = conn.execute(query, dict(params or {}, since=since)).fetchall()
        groups: dict = {}
        for r in rows:
            groups.setdefault(((r["host"] or "").lower(), r["key"] or ""), []).append(r)
        known = known_records(conn, kind, since, gap)
        found, scopes, seen = [], [], set()
        for (host, key), events in groups.items():
            if host not in seen:
                seen.add(host)
                scopes.append((host, since, now))
            for ep in episodes(sorted(events, key=lambda e: e["at"]), gap):
                start, count = ep[0]["at"], len(ep)
                prior = continue_known(known, host, start, gap, key)
                if prior:
                    # Pencere atağın yalnız sonunu görür: sayı kayıttakinden az olamaz (her turda eklenirse şişerdi).
                    start = prior["started_at"]
                    count = max(count, int((prior["detail"] or {}).get("count") or 0))
                if count < min_count:
                    continue
                last = ep[-1]["at"]
                ongoing = now - last <= gap
                message, extra = text(ep, count)
                found.append(dict(board_fields(boards, host), started_at=start,
                                  ended_at=None if ongoing else last,
                                  detail=dict(extra, text=message, count=count, key=key)))
        return found, scopes

    return SimpleNamespace(KIND=kind, WINDOW=window, EVERY=EVERY, OPEN_FROM_WINDOW=True, detect=detect)
