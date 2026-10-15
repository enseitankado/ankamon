"""Otomatik sorun tespiti: çevrimiçi her tahta haftada EN AZ bir kez denetlensin (bkz. executor/diagnose.py).

Konteyner dışında hiçbir şeye (cron, systemd timer) dayanmaz: worker'ın TICK_SECONDS döngüsünde çalışır,
gerekirse kuyruğa "diagnose" görevi yazar (pg_notify) — runner onu, elle başlatılan taramayla AYNI yoldan
çalıştırır.

Tahta bazında: bir tahtanın son BAŞARILI denetiminin (elle ya da otomatik) üzerinden INTERVAL'in
EARLY_FRACTION'ı (≈6 gün) geçtiyse "zamanı yaklaşmış" sayılır ve kaynaklar müsait olduğu ilk anda taranır.
Kaynak müsaitliği sunucunun (konteyner host ağında; /proc host çekirdeğinin değerlerini gösterir) işlemci
yükü, boş belleği ve ağ trafiğine bakılarak belirlenir:
  - zamanı yaklaşmış (≥ ~6 gün):   sıkı eşikler (gerçekten boşta)
  - süresi dolmuş   (≥ 7 gün):    gevşek eşikler (aşırı yük yoksa)
  - bir gün daha gecikmiş (≥ 8 gün): yalnız bellek kontrolü — "haftada en az bir kez" garantisi için
Tahtalar yalnız açıkken taranabilir; açılmayan tahta ilk açıldığı uygun anda taranır.
Tarama hafiftir (tahta başına tek SSH turu, ~1-2 sn) — eşikler sunucudaki diğer işleri korumak içindir.
"""

from __future__ import annotations

import json
import logging
import os
import time

from .. import activity

log = logging.getLogger(__name__)

INTERVAL_SECONDS = float(os.environ.get("DIAGNOSE_INTERVAL_DAYS", "7")) * 86400
EARLY_FRACTION = 0.85
FORCE_AFTER_SECONDS = INTERVAL_SECONDS + 86400

# (1 dk yük / çekirdek, boş bellek oranı, ağ trafiği bayt/sn) üst/alt sınırları
_STRICT = {"load": 0.5, "mem": 0.25, "net": 2 * 1024 * 1024}
_RELAXED = {"load": 0.85, "mem": 0.10, "net": 10 * 1024 * 1024}
_FORCE = {"load": float("inf"), "mem": 0.05, "net": float("inf")}

_net_prev: tuple[float, int] | None = None
_last_skip_log = 0.0


def _net_bytes() -> int:
    total = 0
    with open("/proc/net/dev", encoding="ascii") as f:
        for line in f.readlines()[2:]:
            name, data = line.split(":", 1)
            name = name.strip()
            if name == "lo" or name.startswith(("docker", "veth", "br-")):
                continue
            fields = data.split()
            total += int(fields[0]) + int(fields[8])  # alınan + gönderilen bayt
    return total


def _resources() -> dict | None:
    """Anlık kaynak durumu; ağ hızı iki ölçüm arasından hesaplandığından ilk çağrıda None."""
    global _net_prev
    now, nbytes = time.monotonic(), _net_bytes()
    prev, _net_prev = _net_prev, (now, nbytes)
    if prev is None or now <= prev[0]:
        return None
    with open("/proc/meminfo", encoding="ascii") as f:
        mem = {line.split(":")[0]: int(line.split()[1]) for line in f if ":" in line}
    return {
        "load": os.getloadavg()[0] / (os.cpu_count() or 1),
        "mem": mem.get("MemAvailable", 0) / max(1, mem.get("MemTotal", 1)),
        "net": max(0, nbytes - prev[1]) / (now - prev[0]),
    }


def run(conn) -> None:
    global _last_skip_log
    res = _resources()  # her turda ölçülsün (ağ hızı için önceki örnek gerekir)
    if res is None:
        return

    rows = conn.execute(
        """SELECT b.id, extract(epoch FROM max(j.created_at))::float8 AS last
           FROM boards b
           LEFT JOIN job_targets t ON t.board_id = b.id AND t.status = 'ok'
           LEFT JOIN jobs j ON j.id = t.job_id AND j.type = 'diagnose'
           WHERE b.online AND b.ip IS NOT NULL
           GROUP BY b.id"""
    ).fetchall()
    now = time.time()
    due = [(r["id"], now - (r["last"] or 0)) for r in rows if now - (r["last"] or 0) >= INTERVAL_SECONDS * EARLY_FRACTION]
    if not due:
        return
    # Kuyrukta/çalışan bir görev varsa (elle başlatılmış tarama dahil) araya girme.
    if conn.execute("SELECT 1 FROM jobs WHERE status IN ('queued', 'running') LIMIT 1").fetchone():
        return

    oldest = max(age for _, age in due)
    if oldest >= FORCE_AFTER_SECONDS:
        limits, mode = _FORCE, "gecikmiş"
    elif oldest >= INTERVAL_SECONDS:
        limits, mode = _RELAXED, "süresi dolmuş"
    else:
        limits, mode = _STRICT, "uygun an"
    if res["load"] > limits["load"] or res["mem"] < limits["mem"] or res["net"] > limits["net"]:
        if time.monotonic() - _last_skip_log > 3600:  # günlüğü doldurmasın
            _last_skip_log = time.monotonic()
            log.info("otomatik sorun tespiti ertelendi (%s, %d tahta): yük %.2f, boş bellek %%%.0f, ağ %.1f MB/sn",
                     mode, len(due), res["load"], res["mem"] * 100, res["net"] / 1048576)
        return

    ids = [board_id for board_id, _ in due]
    params = {"auto": True, "mode": mode, "load": round(res["load"], 2), "mem_free": round(res["mem"], 2),
              "net_bps": int(res["net"])}
    job_id = conn.execute(
        "INSERT INTO jobs (type, title, params, created_by) VALUES ('diagnose', 'Sorun tespiti (otomatik)', %s::jsonb, NULL) RETURNING id",
        (json.dumps(params),),
    ).fetchone()["id"]
    conn.execute("INSERT INTO job_targets (job_id, board_id) SELECT %s, unnest(%s::int[])", (job_id, ids))
    conn.execute("SELECT pg_notify('tihamon_jobs', %s)", (str(job_id),))
    activity.record(conn, f"Otomatik sorun tespiti başlatıldı: {len(ids)} tahta ({mode})")
    log.info("otomatik sorun tespiti #%s: %d tahta (%s)", job_id, len(ids), mode)
