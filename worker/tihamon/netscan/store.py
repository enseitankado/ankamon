"""Ağ envanteri tablolarına yazma (bkz. db/migrations/015_network_inventory.sql)."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from psycopg.types.json import Jsonb

from .. import activity
from . import classify, oui, probe

log = logging.getLogger("tihamon.netscan")

# Üst üste bu kadar taramada görülmeyen cihaz çevrimdışı sayılır (telefonlar uykuda ARP'yi kaçırabilir).
MISSES_BEFORE_OFFLINE = 2


def bump(conn) -> None:
    """Arayüze "liste değişti" der (netscan_state.version; arayüz birkaç saniyede bir bakar)."""
    conn.execute("UPDATE netscan_state SET version = version + 1 WHERE id = 1")


def publish(conn, state: dict) -> None:
    conn.execute("UPDATE netscan_state SET state = %s, updated_at = now() WHERE id = 1", (Jsonb(state),))


def sync_networks(conn, detected: list[dict]) -> list[dict]:
    """Algılanan ağları kaydeder; artık bağlı olmayanları attached=false yapar. Taranacakları döner."""
    cidrs = []
    changed = False
    for net in detected:
        row = conn.execute(
            """INSERT INTO net_networks (cidr, ifaces, local_ip, gateway, attached)
               VALUES (%s, %s, %s, %s, true)
               ON CONFLICT (cidr) DO UPDATE SET ifaces = EXCLUDED.ifaces, local_ip = EXCLUDED.local_ip,
                   gateway = EXCLUDED.gateway, attached = true
               RETURNING id, scan_enabled, (xmax = 0) AS inserted""",
            (net["cidr"], net["ifaces"], net["local_ip"], net["gateway"]),
        ).fetchone()
        net["id"], net["scan_enabled"] = row["id"], row["scan_enabled"]
        changed |= row["inserted"]
        if row["inserted"]:
            activity.record(conn, f"Ağ: yeni ağ bulundu — {net['cidr']} ({', '.join(net['ifaces'])})")
        cidrs.append(net["cidr"])
    gone = conn.execute(
        "UPDATE net_networks SET attached = false WHERE attached AND NOT (cidr::text = ANY(%s)) RETURNING cidr",
        (cidrs,),
    ).fetchall()
    for row in gone:
        activity.record(conn, f"Ağ: sunucu artık bu ağa bağlı değil — {row['cidr']}", "warn")
    if changed or gone:
        bump(conn)
    return [n for n in detected if n["scan_enabled"]]


def _boards(conn) -> dict[str, dict]:
    rows = conn.execute(
        "SELECT mac::text AS mac, coalesce(nullif(label, ''), hostname, '') AS name, hostname,"
        " coalesce(facts->>'motherboard_model', '') AS model FROM boards WHERE mac IS NOT NULL"
    ).fetchall()
    return {r["mac"]: r for r in rows}


def apply_sweep(conn, net: dict, found: dict[str, str]) -> int:
    """Tek ağın varlık taraması sonucunu işler. {mac: ip}. Değişen (yeni/durum/IP/ad) cihaz sayısını döner."""
    boards = _boards(conn)
    existing = {r["mac"]: r for r in conn.execute(
        "SELECT id, mac::text AS mac, host(ip) AS ip, online, misses, source, hostname, type_auto"
        " FROM net_devices WHERE network_id = %s", (net["id"],)).fetchall()}
    self_macs = {mac: ip for ip, (mac, _) in net["local_macs"].items()}
    found = dict(found)
    found.update(self_macs)
    first_scan = not existing

    new = [mac for mac in found if mac not in existing]
    # Yeni cihazların adları paralel çözülür (ilk taramada yüzlerce cihaz olabilir; her biri ≤3 sn).
    names: dict[str, str] = {}
    if new:
        with ThreadPoolExecutor(max_workers=16) as pool:
            for mac, name in zip(new, pool.map(lambda m: probe.reverse_dns(found[m]), new)):
                names[mac] = name

    changes = 0
    for mac in new:
        ip = found[mac]
        board = boards.get(mac)
        vendor = oui.vendor(mac)
        kind = classify.guess_type(vendor=vendor, mac_random=oui.is_random(mac), is_board=bool(board),
                                   is_gateway=ip == net.get("gateway"), is_self=mac in self_macs, scan=None)
        hostname = names.get(mac) or (board["hostname"] if board else "") or ""
        conn.execute(
            """INSERT INTO net_devices (network_id, mac, ip, hostname, vendor, type_auto, model_auto, source,
                   online, first_seen_at, last_seen_at, state_changed_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, true, now(), now(), now())
               ON CONFLICT (network_id, mac) DO NOTHING""",
            (net["id"], mac, ip, hostname, vendor, kind, board["model"] if board else "",
             "self" if mac in self_macs else "scan"),
        )
        changes += 1
        if not first_scan:
            activity.record(conn, f"Ağ: yeni cihaz — {ip} {mac} {vendor or ''} {hostname}".strip())
    if first_scan and new:
        activity.record(conn, f"Ağ: {net['cidr']} ilk tarama — {len(new)} cihaz bulundu")

    for mac, dev in existing.items():
        if mac in found:
            ip = found[mac]
            board = boards.get(mac)
            sets = ["last_seen_at = now()", "misses = 0"]
            args: list = []
            changed = False
            if not dev["online"]:
                sets += ["online = true", "state_changed_at = now()"]
                changed = True
            if dev["ip"] != ip:
                sets.append("ip = %s")
                args.append(ip)
                changed = True
            # Sonradan Tiha-Mon'a tahta olarak kaydedilen cihaz: türü/modeli tahtadan gelsin.
            if board and dev["type_auto"] != classify.BOARD:
                sets += ["type_auto = %s", "model_auto = %s"]
                args += [classify.BOARD, board["model"]]
                changed = True
            if not dev["hostname"] and board and board["hostname"]:
                sets.append("hostname = %s")
                args.append(board["hostname"])
                changed = True
            conn.execute(f"UPDATE net_devices SET {', '.join(sets)} WHERE id = %s", (*args, dev["id"]))
            changes += changed
        elif dev["online"] and dev["source"] != "self":
            misses = dev["misses"] + 1
            if misses >= MISSES_BEFORE_OFFLINE:
                conn.execute("UPDATE net_devices SET online = false, misses = %s, state_changed_at = now()"
                             " WHERE id = %s", (misses, dev["id"]))
                changes += 1
            else:
                conn.execute("UPDATE net_devices SET misses = %s WHERE id = %s", (misses, dev["id"]))
    conn.execute("UPDATE net_networks SET last_scan_at = now() WHERE id = %s", (net["id"],))
    if changes:
        bump(conn)
    return changes


def fill_labels(conn) -> int:
    """Boş takma adları doldurur (kalıcı; her tarama sonunda — kullanıcı isteği). Doldurulan kayıt sayısı.

    Kaynak önceliği: Tahtalar'daki takma ad, sonra net_known_aliases (MAC'e göre bilinen adlar, ör. eski
    envanterden). Ağ grid'i (net_devices) MAC ile eşleşir — tahta kaydında MAC yoksa IP ile; Tahtalar
    grid'i (boards) bilinen adlardan MAC ile dolar. Elle girilmiş ad asla ezilmez (yalnız boş olanlar);
    bilinen adın notu, cihazın notu boşsa ona yazılır.
    """
    rows = conn.execute(
        """UPDATE net_devices d SET label = b.label
           FROM boards b
           WHERE d.label = '' AND coalesce(b.label, '') <> ''
             AND (d.mac = b.mac OR (b.mac IS NULL AND b.ip IS NOT NULL AND d.ip = b.ip))
           RETURNING d.label"""
    ).fetchall()
    rows += conn.execute(
        """UPDATE net_devices d SET label = k.label,
               notes = CASE WHEN d.notes = '' THEN k.notes ELSE d.notes END
           FROM net_known_aliases k
           WHERE d.mac = k.mac AND d.label = ''
           RETURNING d.label"""
    ).fetchall()
    rows += conn.execute(
        """UPDATE boards b SET label = k.label, updated_at = now()
           FROM net_known_aliases k
           WHERE b.mac = k.mac AND coalesce(b.label, '') = ''
           RETURNING b.label"""
    ).fetchall()
    if rows:
        activity.record(conn, "Takma ad dolduruldu — " + ", ".join(dict.fromkeys(r["label"] for r in rows)))
        bump(conn)
    return len(rows)


def next_service_target(conn, rescan_hours: int, requested_only: bool) -> dict | None:
    """Servis taraması sıradaki cihaz: önce kullanıcının istedikleri, sonra hiç taranmamışlar, sonra eskiler."""
    cond = "d.services_requested_at IS NOT NULL" if requested_only else (
        "(d.services_requested_at IS NOT NULL OR d.services_scanned_at IS NULL"
        " OR d.services_scanned_at < now() - make_interval(hours => %s))")
    return conn.execute(
        f"""SELECT d.id, host(d.ip) AS ip, d.mac::text AS mac, d.vendor, d.hostname, d.network_id,
                  host(n.gateway) AS gateway
           FROM net_devices d JOIN net_networks n ON n.id = d.network_id
           WHERE d.online AND d.ip IS NOT NULL AND d.source <> 'self' AND n.scan_enabled AND n.attached
             AND {cond}
           ORDER BY d.services_requested_at DESC NULLS LAST, d.services_scanned_at NULLS FIRST, d.id
           LIMIT 1""",
        () if requested_only else (rescan_hours,),
    ).fetchone()


def apply_services(conn, dev: dict, scan: dict | None) -> None:
    """nmap sonucunu yazar; tür/modeli yeniden tahmin eder. scan None (hata) ise yalnız zaman damgası."""
    if scan is None:
        conn.execute("UPDATE net_devices SET services_scanned_at = now(), services_requested_at = NULL"
                     " WHERE id = %s", (dev["id"],))
        bump(conn)
        return
    board = _boards(conn).get(dev["mac"])
    kind = classify.guess_type(vendor=dev["vendor"], mac_random=oui.is_random(dev["mac"]), is_board=bool(board),
                               is_gateway=dev["ip"] == dev.get("gateway"), is_self=False, scan=scan)
    model = classify.guess_model(scan, board["model"] if board else "")
    with conn.transaction():
        conn.execute(
            "DELETE FROM net_services WHERE device_id = %s AND NOT (proto || '/' || port = ANY(%s))",
            (dev["id"], [f"{p['proto']}/{p['port']}" for p in scan["ports"]]),
        )
        for p in scan["ports"]:
            conn.execute(
                """INSERT INTO net_services (device_id, proto, port, service, product, version, extra, last_seen_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, now())
                   ON CONFLICT (device_id, proto, port) DO UPDATE SET service = EXCLUDED.service,
                       product = EXCLUDED.product, version = EXCLUDED.version, extra = EXCLUDED.extra,
                       last_seen_at = now()""",
                (dev["id"], p["proto"], p["port"], p["service"], p["product"], p["version"], p["extra"]),
            )
        conn.execute(
            """UPDATE net_devices SET services_scanned_at = now(), services_requested_at = NULL,
                   os_guess = %s, scan_info = %s,
                   type_auto = CASE WHEN %s <> '' THEN %s ELSE type_auto END,
                   model_auto = CASE WHEN %s <> '' THEN %s ELSE model_auto END,
                   hostname = CASE WHEN hostname = '' THEN %s ELSE hostname END
               WHERE id = %s""",
            (scan["os"], Jsonb({"os_type": scan["os_type"], "os_vendor": scan["os_vendor"]}),
             kind, kind, model, model, scan["hostname"], dev["id"]),
        )
    bump(conn)


def service_queue(conn, rescan_hours: int) -> tuple[int, int]:
    """(bekleyen, toplam): servis taraması gereken çevrim içi cihazlar / taranabilir tüm çevrim içi cihazlar."""
    row = conn.execute(
        """SELECT count(*) FILTER (WHERE d.services_requested_at IS NOT NULL OR d.services_scanned_at IS NULL
                                   OR d.services_scanned_at < now() - make_interval(hours => %s)) AS pending,
                  count(*) AS total
           FROM net_devices d JOIN net_networks n ON n.id = d.network_id
           WHERE d.online AND d.ip IS NOT NULL AND d.source <> 'self' AND n.scan_enabled AND n.attached""",
        (rescan_hours,),
    ).fetchone()
    return row["pending"], row["total"]
