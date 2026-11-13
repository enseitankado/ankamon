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

"""Wi-Fi Monitör: çevredeki erişim noktalarında pasif güvenlik anomalisi tespiti (bkz. wifimon_probe_sniffer.py, wifi.py).

Dinleyici her beacon/probe-response'tan BSSID başına toplar (t:"ap": ssid, kanallar, sinyal örnekleri, şifreleme düzeyi, IE
sayısı/varlığı, Pwnagotchi bayrağı; t:"ar": bir AP'nin yanıt verdiği SSID kümesi). Bu modül o toplamlardan tek tarama içinde
karar verilebilen sahte-AP / saldırı-aracı imzalarını üretir — talu-fi'nin "Sentinel" dedektörlerinden uyarlanan savunma katmanı.

Yalnız birkaç çerçeveyle karar veren (dinlemenin kısa, kanal atlamalı penceresine uyan) imzalar: evil-twin SSID çakışması,
çok-kanallı ikiz, sinyal-bimodal ikiz, şifreleme düşürme, aşırı uzun SSID, seyrek-IE saldırı aracı (bandit), Pwnagotchi,
KARMA/MANA. Sel/jamming/baseline gibi sürekli izleme isteyenler kapsam dışı (bkz. talu-fi raporu, B kademesi).

Her bulgu: {sig, sev, label, key, detail, ssid, bssid}. Düzeyler: critical > high > medium > low. Yanlış-pozitif notu:
imzalar sezgiseldir (ör. karışık üreticili kurumsal ağ evil-twin gibi görünebilir); bulgular bilgilendiricidir, engelleyici değil.
"""

from __future__ import annotations

SEV_RANK = {"critical": 3, "high": 2, "medium": 1, "low": 0}

BIMODAL_MIN_SAMPLES = 16   # sinyal-bimodal için en az örnek (kısa pencerede seyrek → nadiren tetikler)
BIMODAL_GAP_DB = 12        # iki küme arasında en az boşluk (dBm)
BIMODAL_MIN_SIDE = 6       # her kümede en az örnek
KARMA_MIN_SSIDS = 4        # bir AP'nin KARMA sayılması için yanıt verdiği ayrık SSID sayısı

_SIG_LABEL = {
    "evil_twin": "Sahte AP / evil-twin",
    "twin_multichan": "Çok-kanallı ikiz AP",
    "twin_bimodal": "Aynı BSSID iki fiziksel verici",
    "sec_downgrade": "Şifreleme düşürme",
    "long_ssid": "Aşırı uzun SSID",
    "bandit": "Bilinen saldırı aracı (ESP32/Flipper/Pineapple)",
    "pwnagotchi": "Pwnagotchi",
    "karma_ap": "KARMA/MANA sahte AP",
}


def _oui(bssid: str) -> str:
    return (bssid or "").lower()[:8]


def _bimodal(rssis: list) -> tuple | None:
    """Sinyal örnekleri iki kümeye ayrılıyor mu? Sıralı dizide en büyük komşu boşluk ≥ BIMODAL_GAP_DB ve iki yanda da yeterli
    örnek varsa (lo_tavan, hi_taban) döner; yoksa None. Aynı BSSID'den iki ayrı fiziksel verici (klon) kanıtı."""
    xs = sorted(v for v in rssis if isinstance(v, int))
    if len(xs) < BIMODAL_MIN_SAMPLES:
        return None
    best_gap, best_i = 0, -1
    for i in range(1, len(xs)):
        gap = xs[i] - xs[i - 1]
        if gap > best_gap:
            best_gap, best_i = gap, i
    if best_gap < BIMODAL_GAP_DB:
        return None
    if best_i < BIMODAL_MIN_SIDE or len(xs) - best_i < BIMODAL_MIN_SIDE:
        return None
    return xs[best_i - 1], xs[best_i]


def scan_anomalies(records: list) -> list:
    """Dinleyicinin t:"ap" ve t:"ar" kayıtlarından güvenlik bulguları (düzeye göre sıralı). Saf: yan etkisiz, test edilebilir."""
    aps = [r for r in records if isinstance(r, dict) and r.get("t") == "ap" and r.get("bssid")]
    resps = [r for r in records if isinstance(r, dict) and r.get("t") == "ar"]
    out = []

    def add(sig, sev, key, detail, ssid="", bssid=""):
        out.append({"sig": sig, "sev": sev, "label": _SIG_LABEL.get(sig, sig), "key": str(key),
                    "detail": detail, "ssid": ssid, "bssid": bssid})

    # evil-twin: aynı SSID birden çok üretici (OUI) tarafından yayınlanıyor
    by_ssid: dict = {}
    for a in aps:
        name = a.get("ssid") or ""
        if name:
            by_ssid.setdefault(name, []).append(a)
    for name, members in by_ssid.items():
        ouis = {_oui(m["bssid"]) for m in members}
        if len(ouis) >= 2:
            add("evil_twin", "high", name,
                "'%s' ağı %d farklı üreticiden (%d BSSID) yayınlanıyor — kopya sahte AP olası" % (
                    name[:32], len(ouis), len({m["bssid"] for m in members})),
                ssid=name)
        secs = {m.get("sec_max", -1) for m in members if m.get("sec_max", -1) >= 0}
        if 0 in secs and max(secs) >= 3:
            add("sec_downgrade", "high", name,
                "'%s' ağı hem şifreli hem açık BSSID'lerle görülüyor — şifreleme düşürme / sahte AP" % name[:32], ssid=name)

    for a in aps:
        bssid, name = a["bssid"], a.get("ssid") or ""
        chans = a.get("chans") or []
        if len(chans) >= 2:
            add("twin_multichan", "high", bssid,
                "%s (%s) aynı anda %s kanallarında — tek radyo tek kanaldadır, kopya ikiz olası" % (
                    bssid, name[:24] or "gizli", "/".join(str(c) for c in chans)), ssid=name, bssid=bssid)
        bi = _bimodal(a.get("rssis") or [])
        if bi:
            add("twin_bimodal", "high", bssid,
                "%s sinyali iki kümede (%d / %d dBm) — aynı BSSID'den iki fiziksel verici (klon)" % (bssid, bi[0], bi[1]),
                ssid=name, bssid=bssid)
        if a.get("sec_max", -1) >= 3 and a.get("sec_min", 9) == 0:
            add("sec_downgrade", "high", bssid,
                "%s (%s) hem şifreli hem açık görülüyor — şifreleme düşürme saldırısı" % (bssid, name[:24] or "gizli"),
                ssid=name, bssid=bssid)
        if a.get("slen", 0) > 32:
            add("long_ssid", "medium", bssid,
                "%s ağ adı %d bayt (>32) — geçersiz/taşma, rogue imzası" % (bssid, a["slen"]), ssid=name, bssid=bssid)
        ie_n = a.get("ie_n", 0)
        if 0 < ie_n <= 5 and not (a.get("ht") or a.get("ext") or a.get("vht") or a.get("ven")):
            add("bandit", "high", bssid,
                "%s (%s) yalnız %d IE taşıyor ve HT/VHT/üretici öğesi yok — ESP32/Flipper/Marauder tarzı spam aracı" % (
                    bssid, name[:24] or "gizli", ie_n), ssid=name, bssid=bssid)
        if a.get("pwn"):
            add("pwnagotchi", "medium", bssid, "%s Pwnagotchi beacon kaynağı (DE:AD:BE:EF:DE:AD)" % bssid, bssid=bssid)

    for r in resps:
        ss = [s for s in r.get("ssids") or [] if s]
        if len(set(ss)) >= KARMA_MIN_SSIDS:
            add("karma_ap", "high", r.get("addr", ""),
                "%s tek AP %d farklı ağ adına probe-yanıtı veriyor — KARMA/MANA sahte AP" % (
                    r.get("addr", ""), len(set(ss))), bssid=r.get("addr", ""))

    # tekilleştir (sig,key) ve düzeye göre sırala
    seen, uniq = set(), []
    for f in out:
        k = (f["sig"], f["key"])
        if k not in seen:
            seen.add(k)
            uniq.append(f)
    uniq.sort(key=lambda f: -SEV_RANK.get(f["sev"], 0))
    return uniq
