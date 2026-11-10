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

"""Ağ rolleri — KALDIRILDI (kullanıcı isteği 2026-11-10): tahta ağı / idari ağ ayrımı yok.

Ankamon bütün giriş/çıkış hizmetlerini (ağ taraması ve akış gözlemi, servis/paylaşım/etkinlik taramaları, loglardan tahta
kaydı, syslog alımı, WoL, ekran yansıtma, panel) sunucunun BÜTÜN ağ arabirimleri üzerinden yürütür (Ayarlar ▸ Ağ
arabirimleri yalnız listeler). Eski settings.network_roles kaydı göç 048'de silindi. Arayüz (roles / is_board_net /
scan_iface / board_net_sql / board_cidrs) çağıranlar değişmesin diye korunur: her ağ "tahta ağı" sayılır. Tahta olup
olmadığına yine MAC karar verir (netscan/boardmac.py); ağlar arası IP yönlendirmesi engeli (install.sh ankamon-netguard)
bir Ankamon hizmeti değildir, sürer.
"""

from __future__ import annotations

import ipaddress


def roles(conn) -> dict:
    return {"board_iface": "", "admin_iface": ""}


def is_board_net(ifaces: list[str], role: dict) -> bool:
    return True


def scan_iface(net: dict, role: dict) -> str:
    """Ağı taramak için kullanılacak arabirim: ağın bulunduğu (ilk) arabirim."""
    return net["iface"]


def board_net_sql(alias: str = "n") -> str:
    """net_networks satırı (alias) tahta ağı mı — her ağ (SQL koşulu)."""
    return "true"


def board_cidrs(conn, networks: list[dict]) -> list:
    """Bağlı bütün ağların ip_network listesi (networks: ifaces.networks() çıktısı)."""
    return [ipaddress.ip_network(n["cidr"]) for n in networks]
