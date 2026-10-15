"""Wake-on-LAN sihirli paketi (uzaktan uyandırma).

NOT: Sihirli paket yerel ağ yayınıyla (broadcast) gider. Konteyner köprü ağındaysa (yalnız 80/514
dışarı) yayın fiziksel ağa ulaşmayabilir; bu durumda sunucunun tahtalarla aynı ağ yayınına erişmesi
gerekir. Paket hem genel yayına hem de tahtanın bilinen adresinden türetilen /24 yayınına gönderilir.
"""

from __future__ import annotations

import ipaddress
import logging
import socket

log = logging.getLogger(__name__)


def _magic(mac: str) -> bytes:
    raw = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    return b"\xff" * 6 + raw * 16


def _broadcasts(ip: str | None) -> list[str]:
    targets = ["255.255.255.255"]
    if ip:
        try:
            net = ipaddress.ip_network(f"{ip}/24", strict=False)
            targets.append(str(net.broadcast_address))
        except ValueError:
            pass
    return targets


def wake(mac: str, ip: str | None) -> tuple[bool, str]:
    """Verilen MAC'e sihirli paket gönderir. (başarı, ileti) döner."""
    if not mac:
        return False, "Bu tahtanın MAC adresi kayıtlı değil; uyandırma gönderilemez."
    try:
        packet = _magic(mac)
    except ValueError:
        return False, f"Geçersiz MAC adresi: {mac}"

    sent = []
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for address in _broadcasts(ip):
            for port in (9, 7):
                try:
                    sock.sendto(packet, (address, port))
                    sent.append(f"{address}:{port}")
                except OSError as exc:
                    log.warning("WoL gönderilemedi (%s): %s", address, exc)
    if sent:
        return True, "Sihirli paket gönderildi: " + ", ".join(sent)
    return False, "Sihirli paket gönderilemedi."
