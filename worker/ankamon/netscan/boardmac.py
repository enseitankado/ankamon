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

"""Bir cihazın akıllı tahta olup olmadığını MAC adresinden belirleme ve IP → MAC eşlemesi (kullanıcı isteği 2026-11-09:
tahtalar sunucunun BÜTÜN ağ bağdaştırıcılarından algılanır; tahta olup olmadığına MAC karar verir).

Tahta MAC'i:
  - ETAP faz veritabanında bir akıllı tahta modeline düşen önek (bkz. etap_phase — "tahta" alanı), ya da
  - üreticisi Vestel olan MAC (MEB ETAP tahtalarının ana kartı; bkz. classify _VENDOR_RULES).
Bunlara uymayan bir cihaz, Tahtalar'da "Bu bir akıllı tahtadır" işaretiyle (boards.smart_board, göç 046) tahta sayılır.

IP → MAC: sunucunun ARP tablosu (/proc/net/arp — konteyner ana makinenin ağını kullanır; gerçek L2 bilgisi)
öncelikli, yoksa ağ taramasının son gördüğü (net_devices, 15 dk içinde çevrim içi).
"""

from __future__ import annotations

from . import etap_phase, oui

_ZERO = "00:00:00:00:00:00"


def is_board_mac(mac: str | None) -> bool:
    if not mac or mac == _ZERO:
        return False
    info = etap_phase.lookup(mac)
    if info and info.get("tahta"):
        return True
    return "vestel" in (oui.vendor(mac) or "").lower()


def arp_table() -> dict[str, str]:
    """ip → mac (yalnız tamamlanmış girdiler: flags 0x2)."""
    out: dict[str, str] = {}
    try:
        with open("/proc/net/arp", encoding="ascii") as f:
            next(f, None)
            for line in f:
                parts = line.split()
                if len(parts) >= 4 and int(parts[2], 16) & 0x2 and parts[3] != _ZERO:
                    out[parts[0]] = parts[3].lower()
    except (OSError, ValueError):
        pass
    return out


def ip_macs(conn) -> dict[str, str]:
    """ip → mac: ARP tablosu, yoksa ağ taramasının son 15 dk'da çevrim içi gördüğü cihaz."""
    out = {r["ip"]: r["mac"] for r in conn.execute(
        """SELECT DISTINCT ON (host(ip)) host(ip) AS ip, mac::text AS mac FROM net_devices
           WHERE ip IS NOT NULL AND online AND last_seen_at > now() - interval '15 minutes'
           ORDER BY host(ip), last_seen_at DESC""").fetchall()}
    out.update(arp_table())
    return out
