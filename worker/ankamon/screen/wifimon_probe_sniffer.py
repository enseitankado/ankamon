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

"""Wi-Fi Monitör: tahtada çalışan Wi-Fi yoklama (probe request) dinleyicisi (bkz. wifi_remote_scan.py, wifi.py).

Bağlı olmayan ama Wi-Fi'si açık telefonlar çevredeki ağları aramak için ara ara "probe request" yayar; tahtanın kartı monitör
kipindeki ek bir arabirimle (ankamon-mon0) bunları duyar. Program /run/ankamon-wifimon/probe.py olarak yazılır, tahtanın kendi
python3'ü ile (yalnız standart kitaplık) çalışır: AF_PACKET ham soket, radiotap başlığından sinyal (dBm), 802.11 yönetim
çerçevesinden gönderen adres ve aranan ağ adları. 2,4 GHz kanal 1/6/11 arasında gezinir (telefonların tam taraması her
kanalı dolaştığından bir kanal yeterli olur; kısmi taramalar için üçü).

Çıktı: her gönderen adres için bir JSON satırı {addr, rssi (en güçlü, dBm), count, fp, ssids}. `fp`, çerçevedeki bilgi
öğelerinin (desteklenen hızlar, HT/VHT/genişletilmiş yetenekler, üretici öğelerinin OUI'si) özetidir: rastgele adres
kullanan aynı cihazın yoklamaları çoğunlukla aynı `fp`yi taşır, cihaz sayısı kestirimi buna dayanır (bkz. wifi.py).
"""

from __future__ import annotations

WIFIMON_PROBE_SNIFFER_SOURCE = r'''
import hashlib, json, socket, struct, subprocess, sys, time

MON, SECS = sys.argv[1], float(sys.argv[2])
CHANNELS = (1, 6, 11)
FP_IDS = (1, 45, 50, 59, 70, 107, 127, 191, 255)
ALIGN = {0: (8, 8), 1: (1, 1), 2: (1, 1), 3: (2, 4), 4: (1, 2)}


def rt_signal(d):
    """radiotap: alan 5 (dBm Antenna Signal) ve bayraklar (FCS var mı / bozuk mu)."""
    if len(d) < 8:
        return None, 0, 0
    rlen = struct.unpack_from("<H", d, 2)[0]
    words, off = [], 4
    while True:
        w = struct.unpack_from("<I", d, off)[0]
        words.append(w)
        off += 4
        if not w & 0x80000000 or off + 4 > rlen:
            break
    present, sig, flags = words[0], None, 0
    for bit in range(6):
        if not present & (1 << bit):
            continue
        if bit == 5:
            sig = struct.unpack_from("<b", d, off)[0]
            break
        align, size = ALIGN[bit]
        off = (off + align - 1) // align * align
        if bit == 1:
            flags = d[off]
        off += size
    return sig, flags, rlen


def fingerprint(ies):
    parts, i = [], 0
    while i + 2 <= len(ies):
        eid, ln = ies[i], ies[i + 1]
        body = ies[i + 2:i + 2 + ln]
        if eid == 221:
            parts.append("221:" + body[:4].hex())
        elif eid in FP_IDS:
            parts.append("%d:%s" % (eid, body.hex()))
        i += 2 + ln
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:10]


def ssid(ies):
    if len(ies) >= 2 and ies[0] == 0:
        return ies[2:2 + ies[1]].decode("utf-8", "replace").strip("\x00")
    return ""


s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(3))
s.bind((MON, 0))
s.settimeout(0.3)
seen = {}
end = time.time() + SECS
hop, ci = 0.0, 0
while time.time() < end:
    now = time.time()
    if now >= hop:
        subprocess.call(["iw", "dev", MON, "set", "channel", str(CHANNELS[ci % len(CHANNELS)])],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        ci, hop = ci + 1, now + 1.0
    try:
        d = s.recv(4096)
    except socket.timeout:
        continue
    sig, flags, rlen = rt_signal(d)
    if flags & 0x40:
        continue
    f = d[rlen:-4] if flags & 0x10 else d[rlen:]
    if len(f) < 24 or f[0] != 0x40:
        continue
    addr = f[10:16].hex(":")
    ies = f[24:]
    e = seen.get(addr)
    if e is None:
        e = seen[addr] = {"addr": addr, "rssi": sig, "count": 0, "fp": fingerprint(ies), "ssids": []}
    e["count"] += 1
    if sig is not None and (e["rssi"] is None or sig > e["rssi"]):
        e["rssi"] = sig
    name = ssid(ies)
    if name and name not in e["ssids"] and len(e["ssids"]) < 8:
        e["ssids"].append(name)
for e in seen.values():
    print(json.dumps(e, ensure_ascii=False))
'''
