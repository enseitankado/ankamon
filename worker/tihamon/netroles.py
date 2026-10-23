"""Ağ rolleri: hangi arabirim tahta ağı, hangisi idari ağ (Ayarlar ▸ Ağ arabirimleri; settings.network_roles).

Sunucu iki ağa bağlı olabilir: tahta ağı (tahtaları görmek/yönetmek) ve idari ağ (panele erişim). Tahta
işleri — ağ taraması, pasif akış gözlemi, servis/paylaşım/etkinlik taramaları ve syslog'dan otomatik tahta
kaydı — yalnız tahta ağında yapılır; idari ağa taşmaz. Panel, web terminal, syslog alımı, WoL, ekran
yansıtma ve Avahi iki ağda da çalışır (rol onları kısıtlamaz).

Kural (Python: is_board_net, SQL: board_net_sql — ikisi aynı):
  - board_iface seçiliyse: o arabirimin bağlı olduğu ağlar tahta ağıdır.
  - yalnız admin_iface seçiliyse: YALNIZ idari arabirime bağlı ağlar dışındaki her ağ tahta ağıdır.
  - hiçbiri seçili değilse (varsayılan): bağlı her ağ (eski davranış).
İki arabirim aynı alt ağdaysa (geliştirme ortamı) o ağ hem tahta hem idari ağdır.
"""

from __future__ import annotations

import ipaddress

_SETTING = "(SELECT value FROM settings WHERE key = 'network_roles')"


def roles(conn) -> dict:
    row = conn.execute(f"SELECT {_SETTING} AS value").fetchone()
    value = (row["value"] if row else None) or {}
    return {"board_iface": value.get("board_iface") or "", "admin_iface": value.get("admin_iface") or ""}


def is_board_net(ifaces: list[str], role: dict) -> bool:
    if role["board_iface"]:
        return role["board_iface"] in ifaces
    if role["admin_iface"]:
        return not set(ifaces) <= {role["admin_iface"]}
    return True


def scan_iface(net: dict, role: dict) -> str:
    """Ağı taramak için kullanılacak arabirim: ağ tahta arabirimine de bağlıysa o, değilse ilk bulunan."""
    return role["board_iface"] if role["board_iface"] in net["ifaces"] else net["iface"]


def board_net_sql(alias: str = "n") -> str:
    """net_networks satırı (alias) tahta ağı mı — SQL koşulu; ayar her sorguda tablodan okunur."""
    return (f"(CASE WHEN coalesce({_SETTING}->>'board_iface', '') <> ''"
            f" THEN {_SETTING}->>'board_iface' = ANY({alias}.ifaces)"
            f" WHEN coalesce({_SETTING}->>'admin_iface', '') <> ''"
            f" THEN NOT ({alias}.ifaces <@ ARRAY[{_SETTING}->>'admin_iface'])"
            f" ELSE true END)")


def board_cidrs(conn, networks: list[dict]) -> list:
    """Tahta ağlarının ip_network listesi (networks: ifaces.networks() çıktısı)."""
    role = roles(conn)
    return [ipaddress.ip_network(n["cidr"]) for n in networks if is_board_net(n["ifaces"], role)]
