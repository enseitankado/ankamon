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

"""Ağla ilgili log olaylarından anomaliler (bkz. log_events.event_rule): SSH kaba kuvvet, DHCP sorunu, ağ kartı hatası.

Her biri yalnız tahtanın gönderdiği loglardan, art arda gelen olay ataklarıyla saptanır:
  - ssh_bruteforce: aynı kaynaktan kısa sürede çok başarısız SSH girişi ("Failed password", "Invalid user"). Kaynak
    Ankamon'un kendisi de olabilir (ayarlardaki SSH parolası tahtanınkinden farklıysa): ayrıntıda kaynak adres ve — ağ
    envanterinde (net_devices, ağ taraması) varsa — o adresin MAC adresi ve üreticisi yazar (kullanıcı isteği).
  - dhcp_issue: NetworkManager adres alamadı (no lease, zaman aşımı, başarısız). TiHA'nın bakım profili NetworkManager'ın
    bilgi satırlarını iletmez: yalnız bu satırları gönderen tahtalarda görülür.
  - nic_error: ağ kartı sürücüsünün zaman aşımı / takılma satırları (kern.warning düzeyinde, bakım profilinde de gelir).
"""

import datetime
import re

from .log_events import event_rule

# Program + zaman (dizinli, ucuz) önce süzülür, pahalı düzenli ifade yalnız kalan satırlara (MATERIALIZED): yoksa
# planlayıcı ifadeyi penceredeki bütün satırlara uyguluyordu (6 saatte 131 bin satır, ~3 sn).
_SSH = r"""
WITH l AS MATERIALIZED (SELECT host, received_at, message FROM logs WHERE received_at >= %(since)s AND program = 'sshd'),
e AS MATERIALIZED (SELECT host, received_at AS at, substring(message FROM 'from ([0-9a-fA-F.:]+) port') AS key, message
      FROM l WHERE message ~ '^(Failed password for|Invalid user )'),
m AS (SELECT DISTINCT ON (host(ip)) host(ip) AS ip, mac::text AS mac, vendor FROM net_devices WHERE ip IS NOT NULL
      ORDER BY host(ip), last_seen_at DESC NULLS LAST)
SELECT e.*, m.mac, m.vendor FROM e LEFT JOIN m ON m.ip = e.key
"""


def _ssh_text(events, count):
    users = []
    for e in events:
        m = re.search(r"(?:Failed password for (?:invalid user )?|Invalid user )(\S+)", e["message"])
        if m and m.group(1) not in users:
            users.append(m.group(1))
    source = events[0]["key"] or "bilinmeyen kaynak"
    mac = next((e.get("mac") for e in reversed(events) if e.get("mac")), None)
    vendor = next((e.get("vendor") for e in reversed(events) if e.get("vendor")), None)
    who = f"MAC {mac}" + (f", {vendor}" if vendor else "") if mac else "MAC bilinmiyor (ağ envanterinde yok)"
    return (f"{source} adresinden ({who}) {count} başarısız SSH girişi (hesaplar: {', '.join(users[:5]) or '?'})",
            {"source": source, "mac": mac, "vendor": vendor, "users": users[:10]})


ssh_rule = event_rule("ssh_bruteforce", _SSH, gap=datetime.timedelta(minutes=10), min_count=10, text=_ssh_text)

_DHCP = r"""
WITH l AS MATERIALIZED (SELECT host, received_at, message FROM logs WHERE received_at >= %(since)s AND program = 'NetworkManager')
SELECT host, received_at AS at, substring(message FROM 'dhcp4 \(([^)]+)\)') AS key, message
FROM l WHERE message ~ 'dhcp4 \([^)]+\): .*(state changed no lease|state changed (fail|timeout|expire)|request timed out|failed)'
"""


def _dhcp_text(events, count):
    iface = events[0]["key"] or "?"
    return f"{iface} DHCP ile adres alamadı ({count} kez)", {"iface": iface}


dhcp_rule = event_rule("dhcp_issue", _DHCP, gap=datetime.timedelta(minutes=15), min_count=3, text=_dhcp_text)

_NIC = r"""
WITH l AS MATERIALIZED (SELECT host, received_at, message FROM logs WHERE received_at >= %(since)s AND program = 'kernel')
SELECT host, received_at AS at, '' AS key, message
FROM l WHERE message ~* '(NETDEV WATCHDOG|transmit queue [0-9]+ timed out|tx timeout|Tx Unit Hang|Detected Hardware Unit Hang|rtl_rxtx_empty_cond|r8169.*(timeout|error|failed))'
"""


def _nic_text(events, count):
    line = re.sub(r"^\[\s*[0-9.]+\]\s*", "", events[-1]["message"])[:140]
    return f"Ağ kartı hatası ({count} satır): {line}", {"last": line}


nic_rule = event_rule("nic_error", _NIC, gap=datetime.timedelta(minutes=30), min_count=1, text=_nic_text)

RULES = [ssh_rule, dhcp_rule, nic_rule]
