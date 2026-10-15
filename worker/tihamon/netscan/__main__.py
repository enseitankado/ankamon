"""Ağ envanteri tarayıcısı (supervisord "netscan").

İki iş, iki iş parçacığı:
  - Varlık taraması (ana döngü): bağlı her fiziksel ağı ARP ile tarar, cihazları çevrimiçi/çevrimdışı
    işaretler. Öncelik budur. Aralık makinenin yüküne göre MIN..MAX_INTERVAL arasında kendiliğinden
    ayarlanır; makine yoğunsa tarama ertelenir (bkz. load.py).
  - Servis taraması (arka iş parçacığı): çevrimiçi cihazların açık portlarını/servislerini nmap ile
    TEK TEK, yalnız makine gerçekten müsaitken tarar (her cihaz SERVICE_RESCAN_HOURS'ta bir).
    Kullanıcının "Servisleri tara" dediği cihazlar sıranın başına geçer.

Arayüz istekleri pg_notify('tihamon_netscan', 'sweep' | 'services') ile anında gelir (bkz. NetworkApi).
Her değişiklikte netscan_state.version artar; arayüz bunu birkaç saniyede bir okuyup listeyi tazeler.
"""

from __future__ import annotations

import logging
import os
import select
import threading
import time

from .. import db
from . import ifaces, load, probe, store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("tihamon.netscan")

SERVICE_RESCAN_HOURS = int(os.environ.get("NETSCAN_SERVICE_RESCAN_HOURS", "24"))
TOP_PORTS = int(os.environ.get("NETSCAN_TOP_PORTS", "100"))
# Servis taramaları arasında makineye nefes aldırılır.
SERVICE_PAUSE = 5

_state_lock = threading.Lock()
_state: dict = {"phase": "starting"}
_wake_services = threading.Event()
# Ana döngünün son yük kararı (load.sample() iki okuma arasındaki farkı ölçtüğünden tek yerden çağrılır).
_decision: dict = {"busy": True, "reason": "başlıyor", "interval": load.DEFER_SECONDS, "services_ok": False}


def _set(conn, **changes) -> None:
    with _state_lock:
        _state.update(changes)
        snapshot = dict(_state)
    try:
        store.publish(conn, snapshot)
    except Exception:  # durum yazımı taramayı durdurmasın
        log.exception("durum yazılamadı")


def _service_loop() -> None:
    while True:
        try:
            with db.connect() as conn:
                while True:
                    decision = _decision
                    dev = None
                    if not decision["busy"]:
                        # Müsaitken sıradaki herhangi bir cihaz; orta yükte yalnız kullanıcının istedikleri.
                        dev = store.next_service_target(conn, SERVICE_RESCAN_HOURS,
                                                        requested_only=not decision["services_ok"])
                    pending, total = store.service_queue(conn, SERVICE_RESCAN_HOURS)
                    if dev is None:
                        waiting = pending > 0
                        _set(conn, service={"phase": "deferred" if waiting else "idle", "pending": pending, "total": total,
                                            "target": None,
                                            "reason": (decision["reason"] or "makine yeterince boş değil") if waiting else ""})
                        _wake_services.wait(60)
                        _wake_services.clear()
                        continue
                    _set(conn, service={"phase": "scanning", "pending": pending, "total": total, "target": dev["ip"],
                                        "reason": "", "started": time.time()})
                    log.info("servis taraması: %s (%s)", dev["ip"], dev["mac"])
                    started = time.monotonic()
                    scan = probe.service_scan(dev["ip"], TOP_PORTS)
                    store.apply_services(conn, dev, scan)
                    log.info("servis taraması bitti: %s — %s port, %.0f sn", dev["ip"],
                             len(scan["ports"]) if scan else "?", time.monotonic() - started)
                    _wake_services.wait(SERVICE_PAUSE)
                    _wake_services.clear()
        except Exception:
            log.exception("servis tarama döngüsü hatası")
            time.sleep(30)


def _sweep(conn) -> None:
    nets = store.sync_networks(conn, ifaces.networks())
    _set(conn, networks=len(nets))
    for index, net in enumerate(nets):
        _set(conn, phase="sweeping", current=net["cidr"],
             progress={"pct": 0, "found": 0, "index": index + 1, "count": len(nets)})
        started = time.monotonic()
        previous = conn.execute("SELECT last_scan_ms FROM net_networks WHERE id = %s", (net["id"],)).fetchone()

        def report(ratio, count, index=index):
            _set(conn, progress={"pct": round(ratio * 100), "found": count, "index": index + 1, "count": len(nets)})

        found = probe.arp_sweep(net["iface"], net["cidr"], on_progress=report,
                                expected=(previous["last_scan_ms"] or 0) / 1000 or None)
        found.update({mac: ip for mac, ip in probe.neighbors(net["ifaces"]).items() if mac not in found})
        changes = store.apply_sweep(conn, net, found)
        ms = int((time.monotonic() - started) * 1000)
        conn.execute("UPDATE net_networks SET last_scan_ms = %s WHERE id = %s", (ms, net["id"]))
        log.info("varlık taraması %s: %d cihaz yanıt verdi, %d değişiklik, %.1f sn",
                 net["cidr"], len(found), changes, ms / 1000)
    # Tarama sonu: boş takma adları Tahtalar'dan ve bilinen takma adlardan (net_known_aliases) doldur.
    filled = store.fill_labels(conn)
    if filled:
        log.info("takma ad dolduruldu: %d kayıt", filled)


def main() -> None:
    global _decision
    listen = db.connect()
    requests: list[str] = []
    listen.add_notify_handler(lambda n: requests.append(n.payload))
    listen.execute("LISTEN tihamon_netscan")
    log.info("ağ tarayıcısı başladı (aralık %d–%d sn, servis taraması %d saatte bir, ilk %d port)",
             load.MIN_INTERVAL, load.MAX_INTERVAL, SERVICE_RESCAN_HOURS, TOP_PORTS)
    threading.Thread(target=_service_loop, name="services", daemon=True).start()

    next_sweep = 0.0
    while True:
        forced = "sweep" in requests
        if "services" in requests:
            _wake_services.set()
        requests.clear()
        try:
            with db.connect() as conn:
                sample = load.sample()
                decision = _decision = load.decide(sample)
                if decision["services_ok"]:
                    _wake_services.set()
                now = time.monotonic()
                if decision["busy"]:
                    next_sweep = max(next_sweep, now + decision["interval"])
                    _set(conn, phase="deferred", reason=decision["reason"], load=sample,
                         interval=decision["interval"], next_at=time.time() + decision["interval"], current=None)
                elif forced or now >= next_sweep:
                    _set(conn, phase="sweeping", reason="", load=sample)
                    _sweep(conn)
                    next_sweep = time.monotonic() + decision["interval"]
                    _set(conn, phase="idle", current=None, progress=None, interval=decision["interval"],
                         last_at=time.time(), next_at=time.time() + decision["interval"])
                else:
                    _set(conn, load=sample)
        except Exception:
            log.exception("varlık taraması hatası")
            next_sweep = time.monotonic() + load.DEFER_SECONDS
        # Bir sonraki taramaya kadar (en çok 15 sn'de bir yük yeniden ölçülür) ya da bir istek gelene dek.
        wait = max(1.0, min(15.0, next_sweep - time.monotonic()))
        readable, _, _ = select.select([listen.fileno()], [], [], wait)
        if readable:
            listen.execute("SELECT 1")  # bildirimleri işle (handler requests'e ekler)


if __name__ == "__main__":
    main()
