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

"""Cihazın fiziksel ağ arabirimleri (kablolu, kablosuz, diğer) ve yapılandırmaları.

Ekranlar önizlemesinin alt barındaki ağ simgeleri ve ipuçları için (bkz. devices.netifs, göç 026). Betik
oturum yoklamasının SSH turuna eklenir (bkz. session_probe._SCRIPT) — ayrı bağlantı açılmaz. Yalnız
`/sys/class/net/<ad>/device`'ı olan (fiziksel) arabirimler sayılır: lo, docker/veth/köprüler dışarıda.
Yapılandırma NetworkManager'dan (`nmcli`, ETAP'ta kurulu) okunur; yoksa yalnız /sys bilgileri gelir.

Satırlar:  NI ad|tür|operstate|carrier|mac|hız|sürücü|kalıcı_mac      ND ad|ANAHTAR:değer  (nmcli dev show)
           NM ad|ipv4.method                               NW ad|ssid|sinyal|hız   (bağlı Wi-Fi)
           NR enabled|disabled  (Wi-Fi radyosu)
           UB NAME="sdb" TRAN="usb" …  (lsblk -P: takılı USB disk/flaş bellek)   UV sdb NAME="sdb1" …  (bölümleri)

USB depolama (kullanıcı isteği 2026-11-23): Ekranlar alt barında Wi-Fi'nin sağında yeşil USB bellek simgesi, ipucunda
aygıt ve bölüm özellikleri — yalnız takılıyken (ortamı olmayan kart okuyucu, boyut 0, sayılmaz). parse() → "usb": […].

mac = arabirimin O ANKİ adresi; Wi-Fi'de NetworkManager tarama sırasında rastgele (yerel yönetimli) adres
takar. kalıcı_mac (perm_mac) yalnız Wi-Fi'de: kartın fabrika adresi (/sys/class/ieee80211/<phy>/macaddress) —
Cihazlar ▸ "Kablosuz MAC" (devices.wifi_mac, göç 043) bundan yazılır (bkz. session_probe.store_extras).
"""

from __future__ import annotations

import re
import shlex

SCRIPT = r"""
for p in /sys/class/net/*; do
  i=${p##*/}
  [ "$i" = lo ] || [ ! -e "$p/device" ] && continue
  if [ -d "$p/wireless" ] || [ -e "$p/phy80211" ]; then k=wifi; elif [ "$(cat $p/type 2>/dev/null)" = 1 ]; then k=ethernet; else k=other; fi
  echo "NI $i|$k|$(cat $p/operstate 2>/dev/null)|$(cat $p/carrier 2>/dev/null)|$(cat $p/address 2>/dev/null)|$(cat $p/speed 2>/dev/null)|$(basename "$(readlink -f $p/device/driver 2>/dev/null)" 2>/dev/null)|$(cat $p/phy80211/macaddress 2>/dev/null)"
  command -v nmcli >/dev/null 2>&1 || continue
  nmcli -t -f GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,IP6.ADDRESS dev show "$i" 2>/dev/null | sed "s/^/ND $i|/"
  c=$(nmcli -g GENERAL.CONNECTION dev show "$i" 2>/dev/null)
  [ -n "$c" ] && echo "NM $i|$(nmcli -g ipv4.method con show "$c" 2>/dev/null)"
  [ $k = wifi ] && [ -n "$c" ] && nmcli -t -f IN-USE,SSID,SIGNAL,RATE dev wifi list ifname "$i" --rescan no 2>/dev/null | awk -F: -v i="$i" '$1 == "*" { print "NW " i "|" $2 "|" $3 "|" $4; exit }'
done
command -v nmcli >/dev/null 2>&1 && echo "NR $(nmcli radio wifi 2>/dev/null)"
command -v lsblk >/dev/null 2>&1 && lsblk -dnP -b -o NAME,TRAN,TYPE,SIZE,VENDOR,MODEL,SERIAL,RM 2>/dev/null | while read -r l; do
  case "$l" in *'TRAN="usb"'*'TYPE="disk"'*) ;; *) continue ;; esac
  echo "UB $l"
  n=${l#NAME=\"}; n=${n%%\"*}
  lsblk -nP -b -o NAME,TYPE,SIZE,LABEL,FSTYPE,MOUNTPOINT,FSUSED,FSAVAIL "/dev/$n" 2>/dev/null | sed "s|^|UV $n |"
done
"""

# nmcli GENERAL.STATE sayısal kodları (NMDeviceState): 20 unavailable (rfkill/kapalı), 30 disconnected, 100 connected.
_KINDS = ("ethernet", "wifi", "other")
_MAC_RE = re.compile(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$")


def parse(output: str) -> dict | None:
    """Betik çıktısından {"wifi_radio": bool|None, "ifaces": [{...}]}; hiç arabirim yoksa None."""
    ifaces: dict[str, dict] = {}
    radio = None
    usb: dict[str, dict] = {}
    for line in output.splitlines():
        tag, _, rest = line.partition(" ")
        if tag in ("UB", "UV"):
            _usb_line(usb, tag, rest)
            continue
        if tag == "NI":
            f = (rest.split("|") + [""] * 8)[:8]
            if f[1] not in _KINDS:
                continue
            ifaces[f[0]] = {
                "name": f[0], "kind": f[1], "oper": f[2], "carrier": f[3] == "1", "mac": f[4],
                "speed": int(f[5]) if f[5].lstrip("-").isdigit() and int(f[5]) > 0 else None, "driver": f[6],
                "ipv4": [], "ipv6": [], "dns": [],
            }
            if f[1] == "wifi":
                ifaces[f[0]]["perm_mac"] = permanent_mac(f[7])
        elif tag in ("ND", "NM", "NW"):
            name, _, value = rest.partition("|")
            it = ifaces.get(name)
            if it is None:
                continue
            if tag == "NM":
                it["method"] = value.strip()
            elif tag == "NW":
                ssid, signal, rate = (value.split("|") + ["", "", ""])[:3]
                it.update(ssid=ssid, signal=int(signal) if signal.isdigit() else None, rate=rate)
            else:
                key, _, val = value.partition(":")
                key, val = key.split("[")[0], val.strip()
                if not val:
                    continue
                if key == "GENERAL.STATE":
                    it["state"] = int(val.split()[0]) if val.split()[0].isdigit() else None
                elif key == "GENERAL.CONNECTION":
                    it["connection"] = val
                elif key == "IP4.ADDRESS":
                    it["ipv4"].append(val)
                elif key == "IP4.GATEWAY":
                    it["gateway"] = val
                elif key == "IP4.DNS":
                    it["dns"].append(val)
                elif key == "IP6.ADDRESS":
                    it["ipv6"].append(val)
        elif tag == "NR":
            radio = {"enabled": True, "disabled": False}.get(rest.strip())
    usb_list = [d for d in usb.values() if d["size"]]
    if not ifaces:
        return {"wifi_radio": radio, "ifaces": [], "usb": usb_list} if usb_list else None
    for it in ifaces.values():
        it["up"] = _is_up(it, radio)
    order = {k: n for n, k in enumerate(_KINDS)}
    out = {"wifi_radio": radio, "ifaces": sorted(ifaces.values(), key=lambda x: (order[x["kind"]], x["name"]))}
    if usb_list:
        out["usb"] = usb_list
    return out


def _kv(text: str) -> dict:
    """lsblk -P satırı (AD="değer" …) → sözlük."""
    out = {}
    try:
        for token in shlex.split(text):
            key, _, value = token.partition("=")
            out[key] = value.strip()
    except ValueError:
        pass
    return out


def _int(value) -> int | None:
    return int(value) if str(value or "").isdigit() else None


def _usb_line(usb: dict, tag: str, rest: str) -> None:
    """UB: USB disk; UV <disk>: diskin kendisi ve bölümleri (boyut, etiket, dosya sistemi, bağlama, dolu/boş)."""
    if tag == "UB":
        f = _kv(rest)
        if f.get("NAME"):
            usb[f["NAME"]] = {"name": f["NAME"], "size": _int(f.get("SIZE")) or 0, "vendor": f.get("VENDOR", ""),
                              "model": f.get("MODEL", ""), "serial": f.get("SERIAL", ""), "removable": f.get("RM") == "1",
                              "parts": []}
        return
    disk, _, rest = rest.partition(" ")
    f = _kv(rest)
    d = usb.get(disk)
    if d is None or not f.get("NAME"):
        return
    if f.get("TYPE") == "disk" and not f.get("FSTYPE"):
        return   # bölüm tablolu diskin kendisi (bölümleri ayrıca gelir)
    d["parts"].append({"name": f["NAME"], "size": _int(f.get("SIZE")), "label": f.get("LABEL", ""),
                       "fs": f.get("FSTYPE", ""), "mount": f.get("MOUNTPOINT", ""),
                       "used": _int(f.get("FSUSED")), "avail": _int(f.get("FSAVAIL"))})


def permanent_mac(value: str | None) -> str | None:
    """Kalıcı (üreticinin atadığı) MAC olarak geçerliyse küçük harfli adres, değilse None. Yerel yönetimli
    adresler (ilk baytın 2. biti — x2/x6/xA/xE: NetworkManager'ın rastgele tarama adresi) kalıcı sayılmaz."""
    mac = (value or "").strip().lower()
    if not _MAC_RE.match(mac) or mac == "00:00:00:00:00:00" or int(mac[1], 16) & 2:
        return None
    return mac


def wifi_mac(netifs: dict | None) -> str | None:
    """parse() çıktısından Wi-Fi kartının kalıcı MAC'i (ilk Wi-Fi kartı; yoksa None)."""
    for it in (netifs or {}).get("ifaces") or []:
        if it.get("kind") == "wifi" and it.get("perm_mac"):
            return it["perm_mac"]
    return None


def _is_up(it: dict, radio: bool | None) -> bool:
    """Simgenin yeşil olması: kablolu/diğer → bağlantı var (kablo takılı + arabirim açık); Wi-Fi → kart
    ETKİN (radyo açık ve aygıt kullanılabilir — bir ağa bağlı olması gerekmez)."""
    if it["kind"] == "wifi":
        if radio is False:
            return False
        state = it.get("state")
        return state is None and it["oper"] == "up" or (state or 0) >= 30
    return it["carrier"] and it["oper"] in ("up", "unknown")
