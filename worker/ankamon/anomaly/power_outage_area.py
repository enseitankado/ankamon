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

"""Anomali: toplu elektrik kesintisi — aynı bina/katta birden çok cihaz aynı anda güçsüz kaldı.

Cihazların fiziksel konumu Tesis Envanteri kodudur: il.ilçe.tesis.bina.kat.salon (devices.location, göç 054). Konumu
girilmiş cihazlar arasında aynı anda (kesinti anları arasında en çok GAP) ani kapanan en az MIN_DEVICES cihaz bir
kümedir; kayıt kümenin ortak konum önekine göre düzey alır: salon < kat < bina < tesis (birden çok bina).

İki kaynak birleştirilir:
  - Geriye dönük: elektrik kesintisi kayıtları (power_loss) — cihaz yeniden açılınca, SMART teyitli ya da olası.
  - Canlı (sürüyor): şu an çevrim dışı cihazlar; kesinti anı devices.last_seen_at (device_status 10 sn'de bir yoklar).
    Ankamon'dan kapatılanlar (shutdown_at) ve kapanış logu gönderenler (logind/rsyslogd — düzenli kapanış) sayılmaz.
    Yalnız canlı üyeli küme için konumdaki cihazların en az yarısı düşmüş olmalı (açık kalanlar = şu an çevrim içi);
    ETAP'ın boşta otomatik kapanması da iz bırakmadığından bu kayıt "olası"dır; cihazlar açılıp SMART ile teyit
    edilmezse (power_loss kaydı çıkmazsa) küme dağılır ve kayıt silinir.
Kayıt cihaza değil konuma aittir: host = "konum:<önek>", device_id boş. Açık kalan cihazlar ayrıntıda sayılır (kesinti
yalnız bir hatta/sigortada olabilir). Kesinti anı küme içindeki en erken kapanma; bitiş ilk cihazın yeniden açılışı.
"""

from __future__ import annotations

import datetime

KIND = "power_outage_area"
EVERY = 300
WINDOW = datetime.timedelta(days=1)
MIN_DEVICES = 2
GAP = datetime.timedelta(minutes=3)          # kesinti anları hassas (journal / canlı yoklama)
GAP_LOG = datetime.timedelta(minutes=10)     # biri yalnız son logla biliniyorsa (loglar seyrek gelir)
LIVE_RATIO = 0.5
REUSE = datetime.timedelta(minutes=15)       # canlı kayıt, cihazlar açılınca aynı kayıt olarak sürer
LEVELS = {3: "tesis", 4: "bina", 5: "kat", 6: "salon"}

_LOCATED = """
SELECT id, lower(hostname) AS host, hostname, COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name, location,
       online, last_seen_at, shutdown_at
FROM devices WHERE location ~ '^[^.]+\\.[^.]+\\.[^.]+\\.[^.]+'
"""

_LOSSES = """
SELECT device_id, started_at, ended_at, detail FROM anomalies
WHERE kind = 'power_loss' AND device_id IS NOT NULL AND ended_at >= %s
"""

_CLEAN_LOG = """
SELECT 1 FROM logs
WHERE host = %(host)s AND received_at BETWEEN %(s)s AND %(e)s
  AND ((program = 'rsyslogd' AND message LIKE '%%exiting on signal%%')
    OR (program = 'systemd-logind' AND (message LIKE 'System is powering down%%' OR message LIKE 'System is rebooting%%'
        OR message LIKE 'The system will %%' OR message LIKE 'Powering off%%')))
LIMIT 1
"""

_KNOWN = "SELECT host, started_at FROM anomalies WHERE kind = %s AND (ended_at IS NULL OR ended_at >= %s)"


def parts(location: str) -> list[str]:
    return [p.strip() for p in (location or "").split(".")]


def label(prefix: list[str]) -> str:
    """Önek → okunur yer adı ("Bina 2 · Kat 1")."""
    names = ["İl", "İlçe", "Tesis", "Bina", "Kat", "Salon"]
    shown = [f"{names[i]} {prefix[i]}" for i in range(3, len(prefix))]
    return " · ".join(shown) or f"Tesis {'.'.join(prefix)} geneli"


def common_prefix(locations: list[list[str]]) -> list[str]:
    out = []
    for column in zip(*locations):
        if len(set(column)) != 1:
            break
        out.append(column[0])
    return out


def clusters(events: list[dict]) -> list[list[dict]]:
    """Kesinti anına göre sıralı olaylar → kümeler (ardışık iki olay arasında GAP; biri log kaynaklıysa GAP_LOG)."""
    out, current = [], []
    for e in sorted(events, key=lambda e: e["cut"]):
        if current:
            prev = current[-1]
            gap = GAP_LOG if "log" in (prev["source"], e["source"]) else GAP
            if e["cut"] - prev["cut"] > gap:
                out.append(current)
                current = []
        current.append(e)
    if current:
        out.append(current)
    return out


def detect(conn, since):
    now = conn.execute("SELECT now() AS now").fetchone()["now"]
    start = since - WINDOW
    devices = {d["id"]: d for d in conn.execute(_LOCATED).fetchall()}
    events = []
    for r in conn.execute(_LOSSES, (start,)).fetchall():
        d = devices.get(r["device_id"])
        if d:
            detail = r["detail"] or {}
            events.append({"device": d, "cut": r["started_at"], "boot": r["ended_at"], "live": False,
                           "source": detail.get("cut_source") or "log", "confirm": detail.get("confirm")})
    for d in devices.values():
        if d["online"] or d["last_seen_at"] is None or d["last_seen_at"] < max(start, now - WINDOW):
            continue
        if d["shutdown_at"] is not None and d["shutdown_at"] >= d["last_seen_at"] - datetime.timedelta(minutes=10):
            continue   # Ankamon'dan kapatıldı
        if d["hostname"] and conn.execute(_CLEAN_LOG, {"host": d["hostname"],
                                                       "s": d["last_seen_at"] - datetime.timedelta(minutes=5),
                                                       "e": d["last_seen_at"] + datetime.timedelta(minutes=2)}).fetchone():
            continue   # düzenli kapandı
        events.append({"device": d, "cut": d["last_seen_at"], "boot": None, "live": True, "source": "live",
                       "confirm": None})

    known: dict = {}
    for k in conn.execute(_KNOWN, (KIND, start)).fetchall():
        known.setdefault(k["host"], []).append(k["started_at"])
    found = []
    for group in clusters(events):
        by_facility: dict = {}
        for e in group:
            by_facility.setdefault(tuple(parts(e["device"]["location"])[:3]), []).append(e)
        for members in by_facility.values():
            record = _record(members, devices, now, known)
            if record:
                found.append(record)
    hosts = set(known) | {r["host"] for r in found}
    return found, [(h, start, now) for h in hosts]


def _record(members, devices, now, known):
    unique = {e["device"]["id"]: e for e in members}
    members = list(unique.values())
    if len(members) < MIN_DEVICES:
        return None
    prefix = common_prefix([parts(e["device"]["location"]) for e in members])[:6]
    if len(prefix) < 3:
        return None
    depth = len(prefix)
    level = LEVELS.get(depth, "tesis")
    ids = set(unique)
    staying = [d for d in devices.values()
               if d["id"] not in ids and d["online"] and parts(d["location"])[:depth] == prefix]
    live = [e for e in members if e["live"]]
    if live and len(live) == len(members) and len(members) / (len(members) + len(staying)) < LIVE_RATIO:
        return None   # konumdaki cihazların çoğu açık: tek tek kapatılmış olabilir
    cut = min(e["cut"] for e in members)
    host = "konum:" + ".".join(prefix)
    for at in known.get(host, []):
        if abs(at - cut) <= REUSE:
            cut = at   # aynı kesintinin süren kaydı (canlıyken yazıldı, cihazlar açıldıkça devam eder)
            break
    boots = [e["boot"] for e in members if e["boot"]]
    ongoing = not boots
    confirmed = sum(1 for e in members if e["confirm"] == "smart")
    place = label(prefix)
    text = (f"Toplu elektrik kesintisi ({level}): {place} — {len(members)} cihaz aynı anda güçsüz kaldı"
            + (f", {confirmed}'i SMART ile teyitli" if confirmed else "")
            + (f"; {len(live)} cihaz hâlâ kapalı" if live else "")
            + (f"; aynı yerde {len(staying)} cihaz açık kaldı (kesinti tek hatta/sigortada olabilir)" if staying else ""))
    if not boots:
        text += " · sürüyor (cihazlar açılınca SMART ile doğrulanır)"
    else:
        text += f" · ilk cihaz {_span(min(boots) - cut)} sonra yeniden açıldı"
    names = [e["device"]["name"] for e in sorted(members, key=lambda e: e["cut"])]
    text += " · Cihazlar: " + ", ".join(names[:8]) + (f" ve {len(names) - 8} cihaz daha" if len(names) > 8 else "")
    return {
        "host": host, "device_id": None, "device_name": place,
        "started_at": cut, "ended_at": None if ongoing else min(boots),
        "detail": {"text": text, "level": level, "location": ".".join(prefix), "count": len(members),
                   "confirmed": confirmed, "live": len(live), "staying": len(staying),
                   "devices": [{"id": e["device"]["id"], "name": e["device"]["name"], "location": e["device"]["location"],
                                "cut": e["cut"], "source": e["source"], "confirm": e["confirm"]}
                               for e in sorted(members, key=lambda e: e["cut"])]},
    }


def _span(delta: datetime.timedelta) -> str:
    minutes = max(0, int(delta.total_seconds() // 60))
    hours, minutes = divmod(minutes, 60)
    return (f"{hours} saat " if hours else "") + f"{minutes} dk"
