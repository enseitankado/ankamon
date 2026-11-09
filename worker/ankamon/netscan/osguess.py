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

"""Ağ envanteri: cihazın işletim sistemi tahmini (servis taramasının sonucundan).

Kanıtlar, güvenilirlik sırasıyla (ilk bulunan kazanır):
  0. Ankamon'da kayıtlı ETAP tahtası → Pardus (ETAP) (kesin bilgi; nmap yalnız "Linux 4.x" der)
  1. nmap -O eşleşmesi, doğruluk ≥ %85 (TCP/IP parmak izi)
  2. SMB keşfi (smb-os-discovery betiği; Windows ve Samba sürümünü adıyla verir)
  3. Servis imzaları: servisin bildirdiği ostype (ör. "Windows", "Linux"), Microsoft'a özgü servisler
     (msrpc, microsoft-ds, RDP, IIS, WinRM), OpenSSH sürüm metnindeki dağıtım (Ubuntu/Debian/Pardus…)
  4. nmap'in düşük doğruluklu tahmini (--osscan-guess, ≥ %70) — "(tahmini)" ekiyle
Hiçbiri yoksa boş döner; çağıran (store.save_services) eski tahmini korur — bir cihazın işletim sistemi bir kez
bulunduysa yenisi gelene kadar hatırlanır (kullanıcı isteği 2026-11-09).
"""

from __future__ import annotations

import re

_STRONG = 85
_WEAK = 70

_MS_SERVICES = {"msrpc", "microsoft-ds", "ms-wbt-server", "netbios-ssn", "wsman", "wsmans", "ms-sql-s"}
_DISTROS = (("pardus", "Pardus"), ("ubuntu", "Ubuntu"), ("debian", "Debian"), ("raspbian", "Raspbian"),
            ("centos", "CentOS"), ("red hat", "Red Hat"), ("fedora", "Fedora"), ("freebsd", "FreeBSD"),
            ("synology", "Synology DSM"), ("qnap", "QNAP QTS"))


def _from_services(ports: list[dict]) -> str:
    texts = [" ".join(str(p.get(k) or "") for k in ("product", "version", "extra")).lower() for p in ports]
    blob = " ".join(texts)
    for key, name in _DISTROS:
        if key in blob:
            return f"Linux ({name})" if name not in ("FreeBSD", "Synology DSM", "QNAP QTS") else name
    ostypes = [str(p.get("ostype") or "").strip() for p in ports if p.get("ostype")]
    if any("windows" in t.lower() for t in ostypes) or "microsoft windows" in blob or "microsoft iis" in blob:
        return "Microsoft Windows"
    names = {str(p.get("service") or "") for p in ports}
    ms = names & _MS_SERVICES
    # netbios-ssn tek başına Samba da olabilir; en az iki Microsoft servisi ya da RDP/msrpc gerekir.
    if ms - {"netbios-ssn", "microsoft-ds"} or len(ms) >= 3:
        return "Microsoft Windows"
    if "samba" in blob or "openssh" in blob or "dropbear" in blob:
        return "Linux"
    for t in ostypes:
        if t:
            return t
    return ""


def guess(scan: dict, is_board: bool = False) -> str:
    """scan: probe.service_scan sonucu. Bulunamazsa ''."""
    if is_board:
        return "Linux (Pardus ETAP)"
    os_name = scan.get("os") or ""
    accuracy = int(scan.get("os_accuracy") or 0)
    if os_name and accuracy >= _STRONG:
        return os_name
    smb = (scan.get("smb_os") or "").strip()
    if smb:
        return re.sub(r"\s+", " ", smb)
    by_service = _from_services(scan.get("ports") or [])
    if by_service:
        return by_service
    if os_name and accuracy >= _WEAK:
        return f"{os_name} (tahmini)"
    return ""
