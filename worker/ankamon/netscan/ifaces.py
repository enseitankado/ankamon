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

"""Sunucunun bağlı olduğu FİZİKSEL ağları bulur.

Konteyner host ağında çalışır (docker-compose network_mode: host), yani buradaki arabirimler host'un
gerçek arabirimleridir. Sanal arabirimler (lo, docker0, br-*, veth*, tun…) /sys/devices/virtual altında
durur ve `device` bağlantısı yoktur — yalnız gerçek bir aygıta (PCI/USB/virtio) bağlı, açık ve IPv4
adresi olanlar alınır. Aynı alt ağa birden çok arabirimle bağlıysa (ör. eth0+eth1) tek ağ sayılır.
"""

from __future__ import annotations

import ipaddress
import os
import re
import socket
import struct
import subprocess

_SYS = "/sys/class/net"
# Bundan büyük alt ağlar taranmaz (ör. /8): ARP taraması anlamsız uzun sürer ve ağı yorar.
MAX_HOSTS = 65536


def _physical(name: str) -> bool:
    path = os.path.join(_SYS, name)
    return os.path.exists(os.path.join(path, "device")) and not os.path.realpath(path).startswith("/sys/devices/virtual/")


def _read(path: str) -> str:
    try:
        with open(path) as fh:
            return fh.read().strip()
    except OSError:
        return ""


def _gateways() -> dict[str, str]:
    """Arabirim → varsayılan ağ geçidi (/proc/net/route)."""
    result: dict[str, str] = {}
    for line in _read("/proc/net/route").splitlines()[1:]:
        parts = line.split()
        if len(parts) > 2 and parts[1] == "00000000" and parts[2] != "00000000":
            result.setdefault(parts[0], socket.inet_ntoa(struct.pack("<L", int(parts[2], 16))))
    return result


def mac_of(name: str) -> str:
    return _read(os.path.join(_SYS, name, "address")).lower()


def networks() -> list[dict]:
    """[{cidr, ifaces:[…], iface (taramada kullanılan), local_ip, local_macs:{ip:mac}, gateway}]"""
    gateways = _gateways()
    found: dict[str, dict] = {}
    try:
        out = subprocess.run(["ip", "-o", "-4", "addr", "show"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    for line in out.splitlines():
        m = re.match(r"\d+:\s+(\S+)\s+inet\s+(\S+)", line)
        if not m:
            continue
        name, addr = m.group(1).split("@")[0], m.group(2)
        if not _physical(name) or _read(os.path.join(_SYS, name, "operstate")) == "down":
            continue
        try:
            iface = ipaddress.ip_interface(addr)
        except ValueError:
            continue
        net = iface.network
        if net.prefixlen >= 31 or net.num_addresses > MAX_HOSTS or iface.ip.is_loopback or iface.ip.is_link_local:
            continue
        entry = found.setdefault(str(net), {
            "cidr": str(net), "ifaces": [], "iface": name, "local_ip": str(iface.ip),
            "local_macs": {}, "gateway": gateways.get(name),
        })
        if name not in entry["ifaces"]:
            entry["ifaces"].append(name)
        entry["local_macs"][str(iface.ip)] = (mac_of(name), name)
        entry["gateway"] = entry["gateway"] or gateways.get(name)
    return list(found.values())
