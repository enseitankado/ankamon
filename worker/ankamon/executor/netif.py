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

"""Tahtanın fiziksel ağ arabirimleri (kablolu, kablosuz, diğer) ve yapılandırmaları.

Ekranlar önizlemesinin alt barındaki ağ simgeleri ve ipuçları için (bkz. boards.netifs, göç 026). Betik
oturum yoklamasının SSH turuna eklenir (bkz. session_probe._SCRIPT) — ayrı bağlantı açılmaz. Yalnız
`/sys/class/net/<ad>/device`'ı olan (fiziksel) arabirimler sayılır: lo, docker/veth/köprüler dışarıda.
Yapılandırma NetworkManager'dan (`nmcli`, ETAP'ta kurulu) okunur; yoksa yalnız /sys bilgileri gelir.

Satırlar:  NI ad|tür|operstate|carrier|mac|hız|sürücü      ND ad|ANAHTAR:değer  (nmcli dev show)
           NM ad|ipv4.method                               NW ad|ssid|sinyal|hız   (bağlı Wi-Fi)
           NR enabled|disabled  (Wi-Fi radyosu)
"""

from __future__ import annotations

SCRIPT = r"""
for p in /sys/class/net/*; do
  i=${p##*/}
  [ "$i" = lo ] || [ ! -e "$p/device" ] && continue
  if [ -d "$p/wireless" ] || [ -e "$p/phy80211" ]; then k=wifi; elif [ "$(cat $p/type 2>/dev/null)" = 1 ]; then k=ethernet; else k=other; fi
  echo "NI $i|$k|$(cat $p/operstate 2>/dev/null)|$(cat $p/carrier 2>/dev/null)|$(cat $p/address 2>/dev/null)|$(cat $p/speed 2>/dev/null)|$(basename "$(readlink -f $p/device/driver 2>/dev/null)" 2>/dev/null)"
  command -v nmcli >/dev/null 2>&1 || continue
  nmcli -t -f GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,IP6.ADDRESS dev show "$i" 2>/dev/null | sed "s/^/ND $i|/"
  c=$(nmcli -g GENERAL.CONNECTION dev show "$i" 2>/dev/null)
  [ -n "$c" ] && echo "NM $i|$(nmcli -g ipv4.method con show "$c" 2>/dev/null)"
  [ $k = wifi ] && [ -n "$c" ] && nmcli -t -f IN-USE,SSID,SIGNAL,RATE dev wifi list ifname "$i" --rescan no 2>/dev/null | awk -F: -v i="$i" '$1 == "*" { print "NW " i "|" $2 "|" $3 "|" $4; exit }'
done
command -v nmcli >/dev/null 2>&1 && echo "NR $(nmcli radio wifi 2>/dev/null)"
"""

# nmcli GENERAL.STATE sayısal kodları (NMDeviceState): 20 unavailable (rfkill/kapalı), 30 disconnected, 100 connected.
_KINDS = ("ethernet", "wifi", "other")


def parse(output: str) -> dict | None:
    """Betik çıktısından {"wifi_radio": bool|None, "ifaces": [{...}]}; hiç arabirim yoksa None."""
    ifaces: dict[str, dict] = {}
    radio = None
    for line in output.splitlines():
        tag, _, rest = line.partition(" ")
        if tag == "NI":
            f = (rest.split("|") + [""] * 7)[:7]
            if f[1] not in _KINDS:
                continue
            ifaces[f[0]] = {
                "name": f[0], "kind": f[1], "oper": f[2], "carrier": f[3] == "1", "mac": f[4],
                "speed": int(f[5]) if f[5].lstrip("-").isdigit() and int(f[5]) > 0 else None, "driver": f[6],
                "ipv4": [], "ipv6": [], "dns": [],
            }
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
    if not ifaces:
        return None
    for it in ifaces.values():
        it["up"] = _is_up(it, radio)
    order = {k: n for n, k in enumerate(_KINDS)}
    return {"wifi_radio": radio, "ifaces": sorted(ifaces.values(), key=lambda x: (order[x["kind"]], x["name"]))}


def _is_up(it: dict, radio: bool | None) -> bool:
    """Simgenin yeşil olması: kablolu/diğer → bağlantı var (kablo takılı + arabirim açık); Wi-Fi → kart
    ETKİN (radyo açık ve aygıt kullanılabilir — bir ağa bağlı olması gerekmez)."""
    if it["kind"] == "wifi":
        if radio is False:
            return False
        state = it.get("state")
        return state is None and it["oper"] == "up" or (state or 0) >= 30
    return it["carrier"] and it["oper"] in ("up", "unknown")
