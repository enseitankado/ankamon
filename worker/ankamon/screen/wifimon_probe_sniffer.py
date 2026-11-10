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

"""Wi-Fi Monitör: tahtada çalışan Wi-Fi dinleyicisi — yoklamalar ve bağlı cihazlar (bkz. wifi_remote_scan.py, wifi.py).

Tahtanın kartı monitör kipindeki ek bir arabirimle (ankamon-mon0) o an ayarlı kanaldaki bütün 802.11 çerçevelerini duyar;
program bunlardan üç türü kullanır:
- Yoklama (probe request): bağlı olmayan ama Wi-Fi'si açık cihazlar çevredeki ağları aramak için ara ara yayar.
- Bağlı cihazın gönderdiği veri çerçevesi (ToDS=1, FromDS=0; boş "null data" dahil): bir erişim noktasına BAĞLI cihaz.
  Yalnız cihazın kendi gönderdiği çerçeve sayılır — sinyal cihazın sinyalidir (yakınlık ipucu). AP'nin cihaza gönderdiği
  çerçeve (FromDS) sayılmaz: cihaz AP'nin kapsamında herhangi bir yerde (başka kat) olabilir. İçerik şifrelidir, okunmaz;
  yalnız başlıktaki adresler (cihaz, AP) kullanılır.
- Beacon: BSSID → ağ adı (bağlı cihazın hangi ağa bağlı olduğunu adlandırmak için).
Program /run/ankamon-wifimon/probe.py olarak yazılır, tahtanın kendi python3'ü ile (yalnız standart kitaplık) çalışır: AF_PACKET
ham soket, radiotap başlığından sinyal (dBm).

Kanal planı: 2,4 GHz 1/6/11 (yoklama için yeterli: telefonların tam taraması her kanalı dolaşır) + son taramada (nmcli
listesi, 3. argüman) yakın AP'lerin bulunduğu en kalabalık 4 kanal (5 GHz dahil) — bağlı cihaz yalnız AP'sinin kanalında duyulur.
Kartın ayarlayamadığı kanal (desteklemiyor/yasaklı) turdan düşer. Her kanalda 1 sn.

Çıktı (JSON satırları):
  {t: "p", addr, rssi (en güçlü, dBm), count, fp, fps, ssids, seq, ts, wps} — yoklama yapan adres başına. Rastgele adres
    kullanan aynı cihazın adresleri bu alanlarla birleştirilir (bkz. wifimon_probe_merge.py):
    - `fp` ilk çerçevenin, `fps` duyulan bütün çerçevelerin (en çok 4) parmak izi: bilgi öğelerinin (desteklenen hızlar,
      HT/VHT/genişletilmiş yetenekler, üretici öğelerinin OUI'si) özeti. Aynı cihaz 2,4 / 5 GHz'de farklı iz verebilir.
    - `seq` [ilk, son] 802.11 sıra numarası (12 bit), `ts` [ilk, son] dinleme başından saniye: çoğu cihaz adres değişince
      sayacı sıfırlamaz, yeni adresin ilk numarası eskisinin sonuncusunun hemen ardından gelir.
    - `wps` {uuid, name, model, maker, number}: yoklamadaki WPS öğesi (varsa). UUID-E cihaza özgüdür, rastgele adreste de
      değişmez; cihaz/model adı telefonu adıyla gösterir.
  {t: "c", addr, bssid, ssid, chan, rssi, count} — bağlı cihaz başına. Bozuk çerçeveden doğan hayalet adresleri elemek için
    AP'si bilinen (taramada/beacon'da görülen) ya da en az 2 çerçevesi duyulan cihazlar yazılır; AP adresleri cihaz sayılmaz.
"""

from __future__ import annotations

WIFIMON_PROBE_SNIFFER_SOURCE = r'''
import hashlib, json, re, socket, struct, subprocess, sys, time

MON, SECS = sys.argv[1], float(sys.argv[2])
LIST = sys.argv[3] if len(sys.argv) > 3 else ""
BASE_CHANNELS = [1, 6, 11]
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


WPS_ATTRS = {0x1047: "uuid", 0x1011: "name", 0x1023: "model", 0x1021: "maker", 0x1024: "number"}


def wps_info(ies):
    """Üretici öğesi 00:50:f2/04 (WPS) → {uuid, name, model, maker, number} (TLV: 2 bayt tür, 2 bayt uzunluk)."""
    i, out = 0, {}
    while i + 2 <= len(ies):
        eid, ln = ies[i], ies[i + 1]
        body = ies[i + 2:i + 2 + ln]
        i += 2 + ln
        if eid != 221 or body[:4] != b"\x00\x50\xf2\x04":
            continue
        j = 4
        while j + 4 <= len(body):
            typ, n = struct.unpack_from(">HH", body, j)
            val = body[j + 4:j + 4 + n]
            j += 4 + n
            key = WPS_ATTRS.get(typ)
            if not key or not val:
                continue
            if key == "uuid":
                if len(val) == 16 and val.strip(b"\x00"):
                    out[key] = val.hex()
            else:
                text = val.decode("utf-8", "replace").strip("\x00 ").strip()
                if text:
                    out[key] = text[:40]
    return out


def ssid(ies):
    if len(ies) >= 2 and ies[0] == 0:
        return ies[2:2 + ies[1]].decode("utf-8", "replace").strip("\x00")
    return ""


def channel_plan(path):
    """nmcli -t listesi (IN-USE:BSSID:SSID:CHAN:FREQ:RATE:SIGNAL:SECURITY, ':' kaçışlı) → kanallar ve BSSID → ağ adı."""
    names, extra = {}, {}
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines() if path else []
    except OSError:
        lines = []
    for line in lines:
        f = [p.replace("\\:", ":").replace("\\\\", "\\") for p in re.split(r"(?<!\\):", line)]
        if len(f) < 7 or not f[1]:
            continue
        names[f[1].lower()] = f[2]
        if f[3].isdigit() and int(f[3]) not in BASE_CHANNELS and f[6].isdigit() and int(f[6]) >= 25:
            extra[int(f[3])] = extra.get(int(f[3]), 0) + 1
    busiest = [ch for ch, _ in sorted(extra.items(), key=lambda kv: -kv[1])][:4]
    return BASE_CHANNELS + busiest, names


channels, ap_names = channel_plan(LIST)
s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(3))
s.bind((MON, 0))
s.settimeout(0.3)
probes, clients = {}, {}
start = time.time()
end = start + SECS
hop, ci, chan = 0.0, 0, None
while time.time() < end:
    now = time.time()
    if now >= hop:
        while channels:
            want = channels[ci % len(channels)]
            if subprocess.call(["iw", "dev", MON, "set", "channel", str(want)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0:
                chan, ci = want, ci + 1
                break
            channels.remove(want)  # kart bu kanalı ayarlayamıyor: turdan düşer
        hop = now + 1.0
    try:
        d = s.recv(4096)
    except socket.timeout:
        continue
    sig, flags, rlen = rt_signal(d)
    if flags & 0x40:
        continue
    f = d[rlen:-4] if flags & 0x10 else d[rlen:]
    if len(f) < 24:
        continue
    fc0, fc1 = f[0], f[1]
    if fc0 == 0x80 and len(f) >= 36:  # beacon: BSSID → ağ adı
        bssid = f[16:22].hex(":")
        if bssid not in ap_names:
            ap_names[bssid] = ssid(f[36:])
        continue
    if fc0 & 0x0C == 0x08 and fc1 & 0x03 == 0x01:  # veri çerçevesi, cihazdan AP'ye (ToDS)
        if f[10] & 0x01:
            continue
        addr, bssid = f[10:16].hex(":"), f[4:10].hex(":")
        if addr == bssid:
            continue
        e = clients.get(addr)
        if e is None:
            e = clients[addr] = {"t": "c", "addr": addr, "bssid": bssid, "chan": chan, "rssi": sig, "count": 0}
        e["count"] += 1
        if sig is not None and (e["rssi"] is None or sig > e["rssi"]):
            e["rssi"], e["bssid"], e["chan"] = sig, bssid, chan
        continue
    if fc0 != 0x40:
        continue
    addr = f[10:16].hex(":")
    ies = f[24:]
    seq = struct.unpack_from("<H", f, 22)[0] >> 4
    at = round(now - start, 1)
    fp = fingerprint(ies)
    e = probes.get(addr)
    if e is None:
        e = probes[addr] = {"t": "p", "addr": addr, "rssi": sig, "count": 0, "fp": fp, "fps": [], "ssids": [],
                            "seq": [seq, seq], "ts": [at, at]}
    e["count"] += 1
    e["seq"][1], e["ts"][1] = seq, at
    if fp not in e["fps"] and len(e["fps"]) < 4:
        e["fps"].append(fp)
    if "wps" not in e:
        w = wps_info(ies)
        if w:
            e["wps"] = w
    if sig is not None and (e["rssi"] is None or sig > e["rssi"]):
        e["rssi"] = sig
    name = ssid(ies)
    if name and name not in e["ssids"] and len(e["ssids"]) < 8:
        e["ssids"].append(name)
for e in probes.values():
    print(json.dumps(e, ensure_ascii=False))
for e in clients.values():
    if e["addr"] in ap_names or (e["bssid"] not in ap_names and e["count"] < 2):
        continue
    e["ssid"] = ap_names.get(e["bssid"], "")
    print(json.dumps(e, ensure_ascii=False))
'''
