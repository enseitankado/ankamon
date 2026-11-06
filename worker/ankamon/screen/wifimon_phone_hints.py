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

"""Wi-Fi Monitör: tahtanın duyduğu verici (Wi-Fi ağı, Wi-Fi arayan ya da Wi-Fi'ye bağlı cihaz) telefon olabilir mi? (bkz. wifi.py)

Kesin tanıma yoktur; kanıtlar satıra `hints` (kısa Türkçe gerekçeler) ve `phone` ("yes" güçlü kanıt, "maybe" zayıf, "" yok)
olarak eklenir. Kullanılan işaretler:
- Wi-Fi ağı (erişim noktası): telefon paylaşım noktası adları (iPhone, AndroidAP, Galaxy, Redmi…), telefon üreticisine ait
  BSSID (Wireshark manuf), yerel yönetimli (rastgele) BSSID — Android paylaşım noktaları böyledir, ama bazı kurumsal erişim
  noktalarının ek ağları da yerel yönetimli adres kullanır: zayıf kanıt.
- Wi-Fi arayan cihaz (yoklama): bağlı olmayan, Wi-Fi'si açık cihaz. Rastgele (yerel yönetimli) adres telefon/tablet/dizüstünde olağandır;
  sabit adresin üreticisi telefon üreticisiyse güçlü kanıt.
- Wi-Fi'ye bağlı cihaz: bir erişim noktasına bağlı, veri gönderen cihaz. Rastgele adres (telefonların ağ başına "özel adresi")
  zayıf kanıt; telefon üreticisi güçlü kanıt; bağlandığı ağ adı telefon paylaşım noktasına benziyorsa (öğrencinin
  arkadaşının hotspot'u) zayıf kanıt. Tahta, yazıcı gibi kalıcı adresli altyapı cihazları kanıtsız kalır (sabit işaretlenir).
"""

from __future__ import annotations

import re

from ..netscan import oui

_HOTSPOT_SSID_RE = re.compile(
    r"iphone|ipad|androidap|android|galaxy|redmi|xiaomi|\bpoco\b|\bmi \d|huawei|honor|\bnova\b|oppo|\bvivo\b|realme|oneplus|"
    r"pixel|tecno|infinix|\btcl\b|motorola|\bmoto\b|nokia|general mobile|\bgm ?\d|reeder|casper|hotspot|direct-|"
    # Samsung'un Türkçe varsayılan adı "Taha adlı kişiye ait S25 FE" (Arge 2'de görüldü); Galaxy model kodları S25, A54, M31…
    r"adlı kişiye ait|kişisine ait|\b[samz]\d{2}\b|\bnote ?\d+",
    re.IGNORECASE)
_PHONE_VENDOR_RE = re.compile(
    r"apple|samsung|xiaomi|huawei|honor|oppo|vivo|realme|oneplus|google|motorola|nokia|hmd global|sony mobile|"
    r"\blg ?electronics|tcl|tecno|infinix|transsion|general mobile|zte|meizu|reeder|casper",
    re.IGNORECASE)


def _vendor(addr: str) -> str:
    if not addr or oui.is_random(addr):
        return ""
    try:
        return oui.vendor(addr)
    except Exception:  # manuf tablosu yoksa ya da bozuksa üretici boş kalır
        return ""


def annotate_wifi_ap(row: dict) -> None:
    hints, phone = [], ""
    addr = row.get("addr") or ""
    row["random"] = oui.is_random(addr)
    row["vendor"] = _vendor(addr)
    if row.get("name") and _HOTSPOT_SSID_RE.search(row["name"]):
        hints.append("ağ adı telefon paylaşım noktasına benziyor")
        phone = "yes"
    if row["vendor"] and _PHONE_VENDOR_RE.search(row["vendor"]):
        hints.append("telefon üreticisi")  # adı ön yüzde ayrı "Üretici" sütununda
        phone = "yes"
    if row["random"]:
        hints.append("rastgele adres (Android paylaşım noktası olabilir)")
        phone = phone or "maybe"
    row["hints"], row["phone"] = hints, phone


def annotate_client(row: dict) -> None:
    hints, phone = [], ""
    addr = row.get("addr") or ""
    row["random"] = oui.is_random(addr)
    row["vendor"] = _vendor(addr)
    if row["random"]:
        hints.append("rastgele adres (telefonların ağa özel adresi olabilir)")
        phone = "maybe"
    if row["vendor"] and _PHONE_VENDOR_RE.search(row["vendor"]):
        hints.append("telefon üreticisi")
        phone = "yes"
    if row.get("name") and _HOTSPOT_SSID_RE.search(row["name"]):
        hints.append("hotspot'a bağlı (bağlandığı ağın adı telefon paylaşım noktası gibi)")
        phone = phone or "maybe"
    row["hints"], row["phone"] = hints, phone


def annotate_probe(row: dict) -> None:
    hints = []  # "bağlanacak ağ araştırıyor" ipucunu ön yüz ekler (title'ında aradığı ağlar)
    addr = row.get("addr") or ""
    row["random"] = oui.is_random(addr)
    row["vendor"] = _vendor(addr)
    phone = "maybe"
    if row["random"]:
        hints.append("rastgele adres (telefon/tablet olağan)")
    if row["vendor"] and _PHONE_VENDOR_RE.search(row["vendor"]):
        hints.append("telefon üreticisi")
        phone = "yes"
    row["hints"], row["phone"] = hints, phone
