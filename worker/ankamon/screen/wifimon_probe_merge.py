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

"""Wi-Fi Monitör: rastgele adresli yoklamaları aynı cihaz kestirimiyle birleştirme (bkz. wifimon_probe_sniffer.py, wifi.py).

Telefonlar bağlı değilken ağ ararken her taramada yeni bir rastgele (yerel yönetimli) MAC adresi kullanır; 20 sn'lik bir
dinlemede tek telefon 5–10 "cihaz" gibi görünür. Aynı dinlemedeki rastgele adresli yoklamalar şu ölçütlerle tek satırda
toplanır (ön yüz ardışık dinlemelerde aynı ölçütleri `dev` anahtarı ve ağ listesiyle sürdürür — bkz. ui.boards.WifimonClassify):

- wps: yoklamadaki WPS UUID-E aynı (cihaza özgü kimlik, adres değişse de sabit) — kesin.
- ssid: aranan ağ listesi aynı ya da biri ötekini kapsıyor (telefon kayıtlı ağlarını adıyla sorar; liste cihaza özgüdür).
  En az iki ağ aynıysa sinyale bakılmaz; tek ağda (okulun ağı gibi çoklarının kayıtlı olabileceği) sinyal de yakın olmalı.
- seq: 802.11 sıra numarası sürekliliği — yeni adresin ilk numarası eskisinin sonuncusunun hemen ardından (≤ SEQ_GAP),
  adresler zamanda çakışmıyor, aralık kısa ve sinyal yakın (çoğu cihaz adres değişince sayacı sıfırlamaz).
- fp: yetenek parmak izi ortak ve sinyal yakın (aynı model iki telefon aynı izi verir; uzaktakini ayırmak için sinyal şartı).

Ağ listeleri çelişen (ikisi de dolu, hiçbiri ötekini kapsamıyor) iki adres seq/fp ile birleşmez: farklı kayıtlı ağlar
farklı cihaz demektir. Kalıcı (üretici) adresli yoklamalar birleştirilmez.
"""

from __future__ import annotations

import hashlib

SIGNAL_NEAR_DB = 12      # "yakın sinyal": en güçlü RSSI farkı (dBm)
SEQ_GAP = 48             # sıra numarası sürekliliğinde en büyük atlama (adres değişimi arasında birkaç çerçeve gider)
SEQ_MAX_SECS = 15.0      # eski adresin son yoklamasıyla yenisinin ilki arasındaki en uzun süre
MAX_ADDRS = 32

REASON_TEXT = {
    "wps": "aynı WPS kimliği (UUID-E)",
    "ssid": "aynı ağ listesi",
    "seq": "sıra numarası sürekliliği",
    "fp": "aynı yetenek parmak izi ve yakın sinyal",
}


def _near(a: dict, b: dict) -> bool:
    ra, rb = a.get("rssi"), b.get("rssi")
    return isinstance(ra, int) and isinstance(rb, int) and abs(ra - rb) <= SIGNAL_NEAR_DB


def _ssid_relation(a: dict, b: dict) -> str:
    """"same" (biri ötekini kapsıyor), "conflict" (ikisi de dolu ve ayrışık), "" (en az biri boş)."""
    sa, sb = set(a.get("ssids") or []), set(b.get("ssids") or [])
    if not sa or not sb:
        return ""
    return "same" if sa <= sb or sb <= sa else "conflict"


def _seq_follows(a: dict, b: dict) -> bool:
    """b'nin ilk yoklaması a'nın sonuncusunun ardından ve sıra numarası onu sürdürüyor (12 bit sarmalı)."""
    try:
        (_, a_last), (b_first, _) = a["seq"], b["seq"]
        (_, a_end), (b_start, _) = a["ts"], b["ts"]
    except (KeyError, TypeError, ValueError):
        return False
    if not 0 <= b_start - a_end <= SEQ_MAX_SECS:
        return False
    return 0 < (b_first - a_last) % 4096 <= SEQ_GAP


def same_device(a: dict, b: dict) -> str:
    """İki rastgele adresli yoklama aynı cihazdan mı? Gerekçe ("wps"/"ssid"/"seq"/"fp") ya da ""."""
    wa, wb = (a.get("wps") or {}).get("uuid"), (b.get("wps") or {}).get("uuid")
    if wa and wb:
        return "wps" if wa == wb else ""
    rel = _ssid_relation(a, b)
    if rel == "same":
        common = set(a["ssids"]) & set(b["ssids"])
        if len(common) >= 2 or _near(a, b):
            return "ssid"
    if rel == "conflict":
        return ""
    if _near(a, b) and (_seq_follows(a, b) or _seq_follows(b, a)):
        return "seq"
    fa, fb = set(a.get("fps") or [a.get("fp")]) - {None, ""}, set(b.get("fps") or [b.get("fp")]) - {None, ""}
    if fa & fb and _near(a, b):
        return "fp"
    return ""


def device_key(row: dict) -> str:
    """Dinlemeden dinlemeye sabit cihaz anahtarı: WPS UUID-E > ağ listesi > parmak izi."""
    uuid = (row.get("wps") or {}).get("uuid")
    if uuid:
        return "w:" + uuid
    if row.get("ssids"):
        return "s:" + hashlib.sha1("\n".join(sorted(row["ssids"])).encode()).hexdigest()[:10]
    return "f:" + (sorted(row.get("fps") or [row.get("fp") or row.get("addr", "")])[0])


def merge_random(rows: list[dict]) -> list[dict]:
    """Rastgele adresli yoklama satırlarını cihaz başına bire indirir. Satır alanları (sniffer + annotate_probe) korunur;
    eklenenler: addrs (birleşen adresler), why (gerekçe kodları), dev (cihaz anahtarı). addr = en çok yoklayan adres."""
    n = len(rows)
    parent = list(range(n))
    reasons: dict[int, set] = {}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(n):
        for j in range(i + 1, n):
            why = same_device(rows[i], rows[j])
            if why:
                ri, rj = find(i), find(j)
                merged = reasons.pop(ri, set()) | reasons.pop(rj, set()) | {why}
                parent[rj] = ri
                reasons[ri] = merged
    groups: dict[int, list[dict]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(rows[i])
    out = []
    for root, members in groups.items():
        members.sort(key=lambda r: -(r.get("count") or 0))
        row = dict(members[0])
        if len(members) > 1:
            ssids, fps, rssi = [], [], None
            for m in members:
                ssids += [s for s in m.get("ssids") or [] if s not in ssids]
                fps += [f for f in m.get("fps") or [m.get("fp")] if f and f not in fps]
                if isinstance(m.get("rssi"), int) and (rssi is None or m["rssi"] > rssi):
                    rssi = m["rssi"]
                if not row.get("wps") and m.get("wps"):
                    row["wps"] = m["wps"]
            row.update(ssids=ssids[:12], fps=fps[:8], rssi=rssi, count=sum(m.get("count") or 0 for m in members),
                       name=", ".join(ssids[:12]))
            for key in ("signal", "first_seen", "seen_days"):
                vals = [m.get(key) for m in members if m.get(key) is not None]
                if vals:
                    row[key] = max(vals) if key != "first_seen" else min(vals)
        row["addrs"] = sorted({m["addr"] for m in members})[:MAX_ADDRS]
        row["why"] = sorted(reasons.get(root, set()))
        row["dev"] = device_key(row)
        out.append(row)
    return out
