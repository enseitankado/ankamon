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

"""Tahta kimliği ve ağ yerinden anomaliler (yalnız gönderilen loglardan ve tahta kayıtlarından):

  - identity_conflict: aynı bilgisayar adı aynı anda birden çok IP'den log gönderiyor (TiHA kalıbından kurulmuş tahtalar
    ilk açılışta kalıbın adını taşır) ya da iki tahta kaydı aynı IP'yi taşıyor (biri eski IP'de kalmış ya da çakışma).
  - subnet_changed: tahtanın logları başka bir IP ağından gelmeye başladı (tahta taşındı / yanlış VLAN / Wi-Fi'ye geçti).
    Kalıp adını taşıyan çok IP'li adlar bu kurala girmez (onlar identity_conflict'tir).
  - clock_skew: tahtanın saati (logun tahta zamanı) sunucunun saatinden kalıcı olarak sapıyor. Kuyruktan geç gelen loglar
    sapmayı büyütür; o yüzden saat diliminin en hızlı gelen %10'una bakılır. NTP eşitlenmemiş kuralı sensör verisi olan
    tahtaları görür; bu kural log gönderen her tahtayı.
"""

import datetime
from types import SimpleNamespace

from .log_events import EVERY, board_fields, boards_by_host, continue_known, episodes, known_records

WINDOW = datetime.timedelta(hours=3)
BUCKET = datetime.timedelta(minutes=10)

# --- Ad / IP çakışması ---------------------------------------------------------------------------------------
_NAME_IPS = """
SELECT lower(host) AS host, date_trunc('hour', received_at) + floor(extract(minute FROM received_at) / 10) * interval '10 min' AS at,
       array_agg(DISTINCT from_ip ORDER BY from_ip) AS ips
FROM logs WHERE received_at >= %(since)s AND host <> '' AND from_ip IS NOT NULL
GROUP BY 1, 2 HAVING count(DISTINCT from_ip) > 1
"""

_SAME_IP = """
SELECT host(ip) AS ip, array_agg(id ORDER BY id) AS ids, array_agg(COALESCE(NULLIF(label, ''), hostname, host(ip)) ORDER BY id) AS names,
       array_agg(lower(hostname) ORDER BY id) AS hosts
FROM boards WHERE ip IS NOT NULL GROUP BY 1 HAVING count(*) > 1
"""


def _identity_detect(conn, since):
    kind = "identity_conflict"
    now = conn.execute("SELECT now() AS now").fetchone()["now"]
    boards = boards_by_host(conn)
    known = known_records(conn, kind, since, datetime.timedelta(hours=1))
    found, scopes = [], []
    by_host: dict = {}
    for r in conn.execute(_NAME_IPS, {"since": since}).fetchall():
        by_host.setdefault(r["host"], []).append(r)
    for host, buckets in by_host.items():
        scopes.append((host, since, now))
        for ep in episodes(sorted(buckets, key=lambda b: b["at"]), datetime.timedelta(hours=1)):
            ips = sorted({ip for b in ep for ip in b["ips"]})
            start = ep[0]["at"]
            prior = continue_known(known, host, start, datetime.timedelta(hours=1), "name", "key")
            if prior:
                start = prior["started_at"]
                ips = sorted(set(ips) | set((prior["detail"] or {}).get("ips") or []))
            last = ep[-1]["at"] + BUCKET
            found.append(dict(board_fields(boards, host), started_at=start, ended_at=None if now - last <= BUCKET else last,
                              detail={"key": "name", "ips": ips[:50],
                                      "text": f"\"{host}\" adı aynı anda {len(ips)} farklı IP'den log gönderdi "
                                              f"({', '.join(ips[:6])}{'…' if len(ips) > 6 else ''}): aynı adlı birden çok tahta"}))
    # Aynı IP'yi taşıyan kayıtlar: şu anki durum. Sürdükçe açık kalır, düzelince kapanır.
    current = set()
    for r in conn.execute(_SAME_IP).fetchall():
        for board_id, name, host in zip(r["ids"], r["names"], r["hosts"]):
            if not host:
                continue
            others = [n for n in r["names"] if n != name]
            current.add((host, r["ip"]))
            prior = next((k for k in known.get(host, []) if k["ended_at"] is None and (k["detail"] or {}).get("ip") == r["ip"]), None)
            found.append({"host": host, "board_id": board_id, "board_name": name,
                          "started_at": prior["started_at"] if prior else now, "ended_at": None,
                          "detail": {"key": "ip", "ip": r["ip"],
                                     "text": f"{r['ip']} adresini başka tahta kaydı da taşıyor: {', '.join(others)}"}})
    for host, records in known.items():
        for k in records:
            d = k["detail"] or {}
            if k["ended_at"] is None and d.get("key") == "ip" and (host, d.get("ip")) not in current:
                found.append(dict(board_fields(boards, host), started_at=k["started_at"], ended_at=now, detail=d))
    return found, scopes


identity_rule = SimpleNamespace(KIND="identity_conflict", WINDOW=WINDOW, EVERY=EVERY, OPEN_FROM_WINDOW=True, detect=_identity_detect)

# --- Ağ değişimi ----------------------------------------------------------------------------------------------
# Saatlik: adın en çok kullandığı IP ağı (/24). Aynı saatte birden çok IP'den gelen ad kalıp adıdır, atlanır.
_HOURLY_NET = """
SELECT lower(host) AS host, host AS raw, date_trunc('hour', received_at) AS at, from_ip AS ip, count(*) AS n
FROM logs WHERE received_at >= %(since)s AND host <> '' AND from_ip IS NOT NULL
GROUP BY 1, 2, 3, 4
"""

# Pencereden önceki son IP (tahta günlerce kapalı kalıp başka ağda açılmış olabilir); (host, received_at) dizininden.
_PREVIOUS_IP = """
SELECT from_ip AS ip FROM logs WHERE host = %(raw)s AND received_at < %(before)s AND from_ip ~ '^[0-9.]+$'
ORDER BY received_at DESC LIMIT 1
"""


def _subnet_detect(conn, since):
    now = conn.execute("SELECT now() AS now").fetchone()["now"]
    boards = boards_by_host(conn)
    cells: dict = {}
    for r in conn.execute(_HOURLY_NET, {"since": since}).fetchall():
        if not r["ip"].replace(".", "").isdigit():
            continue
        cell = cells.setdefault((r["host"], r["at"]), {"host": r["host"], "raw": r["raw"], "at": r["at"], "count": {}})
        cell["count"][r["ip"]] = cell["count"].get(r["ip"], 0) + r["n"]
    by_host: dict = {}
    for cell in cells.values():
        ip = max(cell["count"], key=cell["count"].get)
        by_host.setdefault(cell["host"], []).append(dict(cell, ip=ip, net=ip.rsplit(".", 1)[0], ips=len(cell["count"])))
    found, scopes = [], []
    for host, hours in by_host.items():
        if host not in boards or any(h["ips"] > 2 for h in hours):
            continue   # kayıtsız ad ya da kalıp adı (identity_conflict)
        scopes.append((host, since, now))
        hours.sort(key=lambda h: h["at"])
        prev_row = conn.execute(_PREVIOUS_IP, {"raw": hours[0]["raw"], "before": hours[0]["at"]}).fetchone()
        prev_ip = prev_row["ip"] if prev_row else None
        for cur in hours:
            cur_net = cur["net"]
            prev_net = prev_ip.rsplit(".", 1)[0] if prev_ip else None
            if prev_net and cur_net != prev_net:
                found.append(dict(board_fields(boards, host), started_at=cur["at"], ended_at=cur["at"] + datetime.timedelta(hours=1),
                                  detail={"from": prev_ip, "to": cur["ip"],
                                          "text": f"IP ağı değişti: {prev_net}.x → {cur_net}.x ({prev_ip} → {cur['ip']}); "
                                                  "tahta taşındı, başka VLAN'a ya da Wi-Fi'ye geçti"}))
            prev_ip = cur["ip"]
    return found, scopes


subnet_rule = SimpleNamespace(KIND="subnet_changed", WINDOW=WINDOW, EVERY=EVERY, OPEN_FROM_WINDOW=True, detect=_subnet_detect)

# --- Saat sapması ---------------------------------------------------------------------------------------------
SKEW_MAX = 600          # sn
SPREAD_MAX = 600        # sn: saatin en hızlı ve en yavaş %10'u arasındaki fark bundan büyükse loglar kuyruktan gelmiştir
_SKEW = """
SELECT lower(host) AS host, from_ip AS ip, date_trunc('hour', received_at) AS at,
       percentile_cont(0.1) WITHIN GROUP (ORDER BY extract(epoch FROM received_at - device_time)) AS lag,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM received_at - device_time)) AS lag_hi,
       count(*) AS n
FROM logs WHERE received_at >= %(since)s AND device_time IS NOT NULL AND host <> ''
GROUP BY 1, 2, 3 HAVING count(*) >= 5
"""


def _human(seconds: float) -> str:
    s = abs(seconds)
    if s >= 86400:
        return f"{s / 86400:.1f} gün"
    if s >= 3600:
        return f"{s / 3600:.1f} saat"
    return f"{s / 60:.0f} dk"


def _skew_detect(conn, since):
    kind = "clock_skew"
    now = conn.execute("SELECT now() AS now").fetchone()["now"]
    boards = boards_by_host(conn)
    known = known_records(conn, kind, since, datetime.timedelta(hours=2))
    by_host: dict = {}
    for r in conn.execute(_SKEW, {"since": since}).fetchall():
        # Saat kaymasında o saatin bütün logları aynı farkla gelir (dar dağılım); kuyruk boşaltmasında fark geniş
        # dağılır (loglar farklı zamanlarda üretilip birlikte gelir) — o saat sayılmaz (bkz. net_link_lost / log_delayed).
        if abs(r["lag"]) > SKEW_MAX and r["lag_hi"] - r["lag"] < SPREAD_MAX:
            by_host.setdefault((r["host"], r["ip"]), []).append(dict(r, offset=r["lag"]))
    found, scopes = [], []
    for (host, ip), hours in by_host.items():
        board = boards.get(host)
        if board and board["ip"] and board["ip"] != ip:
            continue   # kayıtlı tahtanın adını taşıyan başka tahta (kalıp kopyası): o tahtanın saati değil
        scopes.append((host, since, now))
        for ep in episodes(sorted(hours, key=lambda h: h["at"]), datetime.timedelta(hours=2)):
            start = ep[0]["at"]
            prior = continue_known(known, host, start, datetime.timedelta(hours=2))
            if prior:
                start = prior["started_at"]
            offset = ep[-1]["offset"]
            last = ep[-1]["at"] + datetime.timedelta(hours=1)
            # offset = sunucu - tahta: pozitifse tahta geride.
            found.append(dict(board_fields(boards, host), started_at=start,
                              ended_at=None if now - last <= datetime.timedelta(hours=1) else last,
                              detail={"offset_s": round(offset), "key": "",
                                      "text": f"Tahtanın saati {_human(offset)} {'geride' if offset > 0 else 'ileride'} "
                                              "(log zamanına göre); NTP eşitlemesi çalışmıyor olabilir"}))
    return found, scopes


skew_rule = SimpleNamespace(KIND="clock_skew", WINDOW=WINDOW, EVERY=EVERY, OPEN_FROM_WINDOW=True, detect=_skew_detect)

RULES = [identity_rule, subnet_rule, skew_rule]
