"""Wake-on-LAN sihirli paketi (uzaktan uyandırma).

Sihirli paket yerel ağ yayınıyla (broadcast) gider; konteyner host ağını kullandığından fiziksel ağa ulaşır
(bkz. docker-compose.yml network_mode). Sunucu birden çok ağa bağlı olabilir (tahta + idari ağ): paket,
tahtanın bilinen IP'sinin düştüğü yerel ağın arabirimine BAĞLANARAK (SO_BINDTODEVICE) o ağın kendi yayın
adresine (maske arabirimden) ve 255.255.255.255'e gönderilir — varsayılan rotanın arabirimine değil.
IP bilinmiyorsa ya da hiçbir yerel ağa düşmüyorsa bağlı her ağa ayrı ayrı gönderilir.
"""

from __future__ import annotations

import ipaddress
import logging
import socket

from ..netscan import ifaces

log = logging.getLogger(__name__)


def _magic(mac: str) -> bytes:
    raw = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    return b"\xff" * 6 + raw * 16


def _targets(ip: str | None) -> list[tuple[str | None, str]]:
    """[(arabirim, yayın adresi)] — tahtanın ağı bulunursa yalnız o, yoksa bağlı her ağ."""
    nets = [(n["iface"], ipaddress.ip_network(n["cidr"])) for n in ifaces.networks()]
    if ip:
        try:
            addr = ipaddress.ip_address(ip)
            nets = [n for n in nets if addr in n[1]] or nets
        except ValueError:
            pass
    if not nets:  # arabirim okunamadı: eski davranış (varsayılan rotadan genel yayın)
        return [(None, "255.255.255.255")]
    return [(iface, str(net.broadcast_address)) for iface, net in nets]


def wake(mac: str, ip: str | None) -> tuple[bool, str]:
    """Verilen MAC'e sihirli paket gönderir. (başarı, ileti) döner."""
    if not mac:
        return False, "Bu tahtanın MAC adresi kayıtlı değil; uyandırma gönderilemez."
    try:
        packet = _magic(mac)
    except ValueError:
        return False, f"Geçersiz MAC adresi: {mac}"

    sent = []
    for iface, broadcast in _targets(ip):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            if iface:
                try:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, iface.encode())
                except OSError as exc:
                    log.warning("WoL arabirime bağlanamadı (%s): %s", iface, exc)
                    continue
            for address in dict.fromkeys((broadcast, "255.255.255.255")):
                for port in (9, 7):
                    try:
                        sock.sendto(packet, (address, port))
                        sent.append(f"{address}:{port}" + (f" ({iface})" if iface else ""))
                    except OSError as exc:
                        log.warning("WoL gönderilemedi (%s %s): %s", iface or "-", address, exc)
    if sent:
        return True, "Sihirli paket gönderildi: " + ", ".join(sent)
    return False, "Sihirli paket gönderilemedi."
