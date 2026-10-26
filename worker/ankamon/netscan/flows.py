"""Görülen akış gözlemi: sunucunun arabirimlerinde PASİF yakalamayla cihaz başına ağ yoğunluğu.

Anahtarlı ağda sunucu, başka iki cihaz arasındaki unicast'i GÖRMEZ (switch öğrenir); ama şunları görür
ve bunlardan bir yoğunluk sinyali çıkarırız: broadcast (ARP, DHCP, NetBIOS, SSDP…), multicast (mDNS,
SSDP, ONVIF…) ve sunucunun KENDİSİYLE konuşan trafik (tahta logları, node_exporter kazıması…). Bu, IP ID
örneklemesinin (yalnız Windows) aksine tüm cihazlarda çalışır; kaynak MAC ile net_devices'a eşlenir.

AF_PACKET (SOCK_RAW) kullanılır; promiscuous AÇILMAZ — amaç "görülebilir" akışlar, switch'i taşırmak değil.
Aynı alt ağa birden çok arabirim bağlıysa çağıran alt ağ başına TEK arabirim vermeli (çift sayma olmasın;
bkz. ifaces.networks "iface"). Root gerekir (netscan zaten root). Frame başına yalnız ilk 128 bayt okunur.
"""

from __future__ import annotations

import collections
import select
import socket
import struct
import time

_ETH_P_ALL = 0x0003
# İyi bilinen UDP portları → okunur protokol adı (akışın "neden"ini verir).
_UDP_NAMES = {5353: "mDNS", 5355: "LLMNR", 137: "NetBIOS", 138: "NetBIOS", 1900: "SSDP",
              3707: "ONVIF", 67: "DHCP", 68: "DHCP", 123: "NTP", 161: "SNMP", 162: "SNMP"}


def _classify(data: bytes) -> str:
    """Frame'in baskın protokol etiketi (kaba)."""
    et = struct.unpack("!H", data[12:14])[0]
    if et == 0x0806:
        return "ARP"
    if et == 0x86DD:
        return "IPv6"
    if et == 0x0800 and len(data) >= 34:
        ihl = (data[14] & 0x0F) * 4
        proto = data[14 + 9]
        if proto == 1:
            return "ICMP"
        if proto == 6:
            return "TCP"
        if proto == 17 and len(data) >= 14 + ihl + 4:
            sport = struct.unpack("!H", data[14 + ihl:14 + ihl + 2])[0]
            dport = struct.unpack("!H", data[14 + ihl + 2:14 + ihl + 4])[0]
            return _UDP_NAMES.get(dport) or _UDP_NAMES.get(sport) or "UDP"
        return "IP"
    return "L2"


def observe(iface_names: list[str], exclude_macs: set[str], window: float) -> dict[str, dict]:
    """`window` sn pasif dinler. {mac: {pps, kbps, proto}} — mac küçük harf 'aa:bb:..' biçiminde.

    Yalnız kaynak MAC'i exclude_macs (sunucunun kendi arabirimleri) DIŞINDA olan frame'ler sayılır:
    yani cihazların AĞA yaptığı, sunucunun görebildiği akışlar. proto = pencerede en çok görülen etiket.
    """
    socks = []
    for name in iface_names:
        try:
            sock = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(_ETH_P_ALL))
            sock.bind((name, 0))
            sock.setblocking(False)
            socks.append(sock)
        except OSError:
            continue
    if not socks:
        return {}
    exclude = {m.lower() for m in exclude_macs}
    pkts: collections.Counter = collections.Counter()
    bits: collections.Counter = collections.Counter()
    protos: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    started = time.monotonic()
    end = started + window
    try:
        while True:
            left = end - time.monotonic()
            if left <= 0:
                break
            readable, _, _ = select.select(socks, [], [], left)
            for sock in readable:
                try:
                    data = sock.recv(128)
                except OSError:
                    continue
                if len(data) < 14:
                    continue
                mac = ":".join("%02x" % b for b in data[6:12])
                if mac in exclude:
                    continue
                pkts[mac] += 1
                bits[mac] += len(data) * 8
                protos[mac][_classify(data)] += 1
    finally:
        for sock in socks:
            sock.close()
    elapsed = max(0.5, time.monotonic() - started)
    out: dict[str, dict] = {}
    for mac, n in pkts.items():
        top = protos[mac].most_common(1)
        out[mac] = {
            "pps": round(n / elapsed, 1),
            "kbps": round(bits[mac] / elapsed / 1000, 1),
            "proto": top[0][0] if top else "",
        }
    return out
