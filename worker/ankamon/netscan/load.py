"""Makinenin anlık yükünü ölçer ve taramanın ne zaman yapılacağına karar verir.

Ölçülenler (host geneli — konteynerde cgroup sınırı yok, /proc host'un değerlerini verir):
  - CPU kullanımı: /proc/stat iki okuma arasındaki fark (%)
  - CPU baskısı (PSI): /proc/pressure/cpu "some avg10" — iş parçacıklarının CPU beklediği zaman (%)
  - Boş bellek: /proc/meminfo MemAvailable / MemTotal (%)

Karar (bkz. decide):
  - Yoğun (CPU ≥ BUSY_CPU ya da baskı ≥ BUSY_PSI ya da boş bellek < BUSY_MEM): tarama ERTELENİR,
    DEFER_SECONDS sonra yeniden bakılır.
  - Değilse varlık taramaları arasındaki süre yükle doğru orantılı uzar: boşta MIN_INTERVAL,
    yoğunluk sınırına yaklaştıkça MAX_INTERVAL'e kadar.
  - Servis (port) taraması daha ağırdır: yalnız makine gerçekten müsaitken (CPU < SERVICE_CPU) yapılır.
"""

from __future__ import annotations

import os
import time

MIN_INTERVAL = int(os.environ.get("NETSCAN_MIN_INTERVAL", "30"))
MAX_INTERVAL = int(os.environ.get("NETSCAN_MAX_INTERVAL", "300"))
DEFER_SECONDS = 20
BUSY_CPU = 85.0
BUSY_PSI = 40.0
BUSY_MEM = 10.0
IDLE_CPU = 20.0
SERVICE_CPU = 50.0
SERVICE_MEM = 20.0

_last: tuple[int, int] | None = None


def _cpu_times() -> tuple[int, int]:
    with open("/proc/stat") as fh:
        values = [int(v) for v in fh.readline().split()[1:]]
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return sum(values), idle


def _psi() -> float:
    try:
        with open("/proc/pressure/cpu") as fh:
            for part in fh.readline().split():
                if part.startswith("avg10="):
                    return float(part[6:])
    except (OSError, ValueError):
        pass
    return 0.0


def _mem_free_pct() -> float:
    info = {}
    with open("/proc/meminfo") as fh:
        for line in fh:
            key, _, rest = line.partition(":")
            info[key] = int(rest.split()[0])
    total = info.get("MemTotal") or 1
    return 100.0 * info.get("MemAvailable", total) / total


def sample() -> dict:
    """{cpu, psi, mem_free, load1}. İlk çağrıda CPU için kısa (0,5 sn) bir ölçüm penceresi alınır."""
    global _last
    now = _cpu_times()
    if _last is None:
        time.sleep(0.5)
        _last, now = now, _cpu_times()
    total, idle = now[0] - _last[0], now[1] - _last[1]
    _last = now
    cpu = 100.0 * (1 - idle / total) if total > 0 else 0.0
    return {
        "cpu": round(cpu, 1),
        "psi": round(_psi(), 1),
        "mem_free": round(_mem_free_pct(), 1),
        "load1": round(os.getloadavg()[0], 2),
        "cpus": os.cpu_count() or 1,
    }


def decide(s: dict) -> dict:
    """{busy, reason, interval, services_ok}"""
    reasons = []
    if s["cpu"] >= BUSY_CPU:
        reasons.append(f"CPU %{s['cpu']:.0f}")
    if s["psi"] >= BUSY_PSI:
        reasons.append(f"CPU baskısı %{s['psi']:.0f}")
    if s["mem_free"] < BUSY_MEM:
        reasons.append(f"boş bellek %{s['mem_free']:.0f}")
    if reasons:
        return {"busy": True, "reason": ", ".join(reasons), "interval": DEFER_SECONDS, "services_ok": False}
    # Yük oranı 0 (≤ IDLE_CPU) … 1 (BUSY_CPU sınırı); bellek baskısı da hesaba katılır.
    ratio = max(
        (s["cpu"] - IDLE_CPU) / (BUSY_CPU - IDLE_CPU),
        (50.0 - s["mem_free"]) / (50.0 - BUSY_MEM),
        s["psi"] / BUSY_PSI,
        0.0,
    )
    ratio = min(ratio, 1.0)
    interval = int(MIN_INTERVAL + (MAX_INTERVAL - MIN_INTERVAL) * ratio)
    return {
        "busy": False,
        "reason": "",
        "interval": interval,
        "services_ok": s["cpu"] < SERVICE_CPU and s["mem_free"] >= SERVICE_MEM and s["psi"] < BUSY_PSI / 2,
    }
