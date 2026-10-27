# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Darboğaz denetimi: dakikada bir (supervisord TICK_60) sunucu kaynaklarına bakar, sınır aşılınca kayıt üretir.

Her denetim bir kez uyarır ve değer düzelene dek (histerezis: uyarı eşiğinin altına inince) susar; düzelince
"düzeldi" kaydı düşer. Böylece sürekli yüksek bir değer akışı doldurmaz. Ölçümler ucuzdur (/proc, statvfs,
tek bir SQL); en çok CPU yiyen süreçler yalnız CPU uyarısında hesaplanır.
"""

from __future__ import annotations

import glob
import os
import shutil

CPU_WARN, CPU_CLEAR, CPU_MINUTES = 90.0, 70.0, 3  # son 3 dakikanın her biri ≥ %90
MEM_WARN, MEM_ERROR, MEM_CLEAR = 90.0, 97.0, 80.0
DISK_WARN_PCT, DISK_ERROR_PCT = 10.0, 3.0  # /data'da boş yer yüzdesi
DISK_WARN_GB, DISK_ERROR_GB = 2.0, 0.5
PG_WARN, PG_CLEAR = 0.8, 0.6  # bağlantı sayısı / max_connections
QUEUE_WARN_MB = 50  # rsyslog disk kuyruğu (veritabanına yazılamayan tahta logları)
SPOOL = "/data/rsyslog"


class Health:
    def __init__(self):
        self._active: dict[str, str] = {}  # denetim → şu an uyarıda olan düzey
        self._cpu_prev = None
        self._cpu_high = 0
        self._proc_prev: dict[int, tuple[str, int]] = {}
        self._quarantine_seen: set[str] | None = None

    def check(self, conn) -> list[tuple[str, str, str]]:
        """(düzey, ileti, ayrıntı) listesi; düzey "info" düzelme bildirimidir."""
        out: list[tuple[str, str, str]] = []
        for fn in (self._cpu, self._memory, self._disk, self._log_queue):
            try:
                fn(out)
            except OSError:
                pass
        if conn is not None:
            try:
                self._postgres(conn, out)
            except Exception:  # bağlantı koptuysa çağıran yeniden bağlanır; denetim bir tur atlanır
                pass
        return out

    def _state(self, out, key: str, level: str | None, message: str, detail: str = "", cleared: str = ""):
        """level None = durum normal. Yalnız düzey değişince kayıt üretir."""
        prev = self._active.get(key)
        if level and level != prev:
            self._active[key] = level
            out.append((level, message, detail))
        elif not level and prev:
            del self._active[key]
            out.append(("info", cleared, ""))

    def _cpu(self, out):
        with open("/proc/stat") as fh:
            vals = [int(v) for v in fh.readline().split()[1:]]
        idle, total = vals[3] + vals[4], sum(vals[:8])
        prev, self._cpu_prev = self._cpu_prev, (idle, total)
        procs = self._proc_times()
        prev_procs, self._proc_prev = self._proc_prev, procs
        if not prev or total == prev[1]:
            return
        busy = 100.0 * (1 - (idle - prev[0]) / (total - prev[1]))
        if busy >= CPU_WARN:
            self._cpu_high += 1
        elif busy < CPU_CLEAR:
            self._cpu_high = 0
        high = self._cpu_high >= CPU_MINUTES
        if high and "cpu" not in self._active:
            top = sorted(((t - prev_procs[pid][1], name) for pid, (name, t) in procs.items()
                          if pid in prev_procs and prev_procs[pid][0] == name), reverse=True)[:5]
            spent = total - prev[1]
            detail = "En çok CPU kullanan süreçler (son 1 dk):\n" + "\n".join(
                f"  {name}: %{100.0 * ticks / spent * os.cpu_count():.0f} (tek çekirdek = %100)" for ticks, name in top if ticks > 0)
            self._state(out, "cpu", "warn", f"Darboğaz: CPU {CPU_MINUTES} dakikadır %{CPU_WARN:.0f} üzerinde "
                        f"(şu an %{busy:.0f})", detail)
        elif not high and self._cpu_high == 0:
            self._state(out, "cpu", None, "", cleared=f"CPU kullanımı normale döndü (%{busy:.0f})")

    @staticmethod
    def _proc_times() -> dict[int, tuple[str, int]]:
        procs = {}
        for path in glob.glob("/proc/[0-9]*/stat"):
            try:
                with open(path) as fh:
                    raw = fh.read()
            except OSError:
                continue
            name = raw[raw.find("(") + 1:raw.rfind(")")]
            fields = raw[raw.rfind(")") + 2:].split()
            procs[int(path.split("/")[2])] = (name, int(fields[11]) + int(fields[12]))  # utime + stime
        return procs

    def _memory(self, out):
        info = {}
        with open("/proc/meminfo") as fh:
            for line in fh:
                key, value = line.split(":", 1)
                info[key] = int(value.split()[0])
        used = 100.0 * (1 - info["MemAvailable"] / info["MemTotal"])
        level = "error" if used >= MEM_ERROR else "warn" if used >= MEM_WARN else None
        if not level and used >= MEM_CLEAR and "mem" in self._active:
            return  # histerezis: %80'in altına inene dek uyarı sürer
        free_mb = info["MemAvailable"] // 1024
        self._state(out, "mem", level, f"Darboğaz: bellek %{used:.0f} dolu (boş {free_mb} MB)",
                    cleared=f"Bellek kullanımı normale döndü (%{used:.0f})")

    def _disk(self, out):
        usage = shutil.disk_usage("/data")
        free_pct, free_gb = 100.0 * usage.free / usage.total, usage.free / 1024 ** 3
        level = ("error" if free_pct < DISK_ERROR_PCT or free_gb < DISK_ERROR_GB
                 else "warn" if free_pct < DISK_WARN_PCT or free_gb < DISK_WARN_GB else None)
        self._state(out, "disk", level,
                    f"Disk: /data'da boş yer azaldı — {free_gb:.1f} GB (%{free_pct:.0f}); veri kaybı riski",
                    "Sistem ▸ Disk kullanımı'ndan saklama süreleri kısaltılabilir ya da eski yedekler silinebilir.",
                    cleared=f"Disk: /data'da yeniden yeterli boş yer var ({free_gb:.1f} GB)")

    def _log_queue(self, out):
        size = sum(os.path.getsize(p) for p in glob.glob(f"{SPOOL}/ankamon_pg.*") if os.path.isfile(p))
        mb = size / 1024 ** 2
        self._state(out, "queue", "warn" if mb >= QUEUE_WARN_MB else None,
                    f"Log kuyruğu birikiyor: {mb:.0f} MB tahta logu veritabanına yazılmayı bekliyor",
                    "Veritabanı yavaş ya da erişilemiyor olabilir (bkz. Sistem ▸ Disk kullanımı ▸ Log kuyruğu).",
                    cleared="Log kuyruğu boşaldı")
        dirs = {os.path.basename(p) for p in glob.glob(f"{SPOOL}/bozuk-*") if os.path.isdir(p)}
        if self._quarantine_seen is not None:
            for name in sorted(dirs - self._quarantine_seen):
                out.append(("error", f"Log kuyruğunda bozuk dosyalar karantinaya alındı: {name}",
                            "Bu dosyalardaki tahta logları veritabanına yazılamadı (bkz. Sistem ▸ Disk kullanımı)."))
        self._quarantine_seen = dirs

    def _postgres(self, conn, out):
        row = conn.execute(
            "SELECT count(*) AS n, current_setting('max_connections')::int AS max FROM pg_stat_activity").fetchone()
        ratio = row["n"] / row["max"]
        if not ratio >= PG_WARN and ratio >= PG_CLEAR and "pg" in self._active:
            return
        detail = ""
        if ratio >= PG_WARN and "pg" not in self._active:
            rows = conn.execute(
                "SELECT coalesce(nullif(application_name, ''), usename, backend_type) AS who, count(*) AS n"
                " FROM pg_stat_activity GROUP BY 1 ORDER BY 2 DESC LIMIT 8").fetchall()
            detail = "Bağlantılar:\n" + "\n".join(f"  {r['who']}: {r['n']}" for r in rows)
        self._state(out, "pg", "warn" if ratio >= PG_WARN else None,
                    f"Darboğaz: veritabanı bağlantıları sınıra yaklaştı ({row['n']}/{row['max']})", detail,
                    cleared=f"Veritabanı bağlantı sayısı normale döndü ({row['n']}/{row['max']})")
