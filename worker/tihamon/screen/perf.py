"""Başarım akışı: ws://127.0.0.1:8890/screen/ws/perf/<tahta id> (nginx /screen/ws/ vekiller, yetki "screen").

Tahtalar → Ekranlar sekmesindeki "Başarım" görünümü (bkz. docker/rootfs/screen/index.html Tile.perf*)
htop'un varsayılan üst panellerini (sol: çekirdek başına CPU, Mem, Swp; sağ: görevler, yük ortalaması,
çalışma süresi) kutucuğun üstünde saniyelik gösterir. Tahta başına TEK bir SSH oturumu açılır; tahtada
çalışan küçük bir sh döngüsü her saniye /proc'tan ham değerleri basar (htop da aynı dosyaları okur),
hesap (fark → yüzde) burada yapılır ve her saniye tek bir JSON mesajı gönderilir. WebSocket kapanınca
SSH süreci öldürülür; tahtadaki döngü ilk yazışında SIGPIPE ile kendiliğinden biter.

Mesaj: {"cpus": [[user, nice, sys, other], ...] (yüzde), "cpu": toplam yüzde,
        "mem": {"total", "used", "buffers", "cache"} (KiB), "swap": {"total", "used"} (KiB),
        "load": [1, 5, 15], "tasks": süreç sayısı, "threads": iş parçacığı, "running": çalışan,
        "uptime": saniye}
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

import tornado.websocket

log = logging.getLogger("tihamon.screen.perf")

# Aynı anda açık başarım akışı sınırı (her biri bu makinede bir ssh süreci).
MAX_STREAMS = int(os.environ.get("SCREEN_MAX_PERF_STREAMS", "64"))

# Tahtada çalışır (dash uyumlu). "@" her saniyelik çerçevenin başıdır.
_REMOTE_LOOP = r"""
while :; do
  echo @
  grep '^cpu' /proc/stat
  grep -E '^(MemTotal|MemFree|Buffers|Cached|SReclaimable|Shmem|SwapTotal|SwapFree):' /proc/meminfo
  echo "L $(cat /proc/loadavg)"
  echo "U $(cat /proc/uptime)"
  set -- /proc/[0-9]*
  echo "P $#"
  sleep 1
done
"""

_streams = 0


def _parse(lines: list[str]) -> dict:
    """Bir çerçevenin ham satırları → {"cpu": {ad: [alanlar]}, "mem": {...}, ...}."""
    frame: dict = {"cpu": {}, "mem": {}}
    for line in lines:
        parts = line.split()
        if not parts:
            continue
        key = parts[0]
        if key.startswith("cpu"):
            frame["cpu"][key] = [int(x) for x in parts[1:9]] + [0] * (8 - len(parts[1:9]))
        elif key.endswith(":"):
            frame["mem"][key[:-1]] = int(parts[1])
        elif key == "L" and len(parts) >= 5:
            frame["load"] = [float(x) for x in parts[1:4]]
            running, _, total = parts[4].partition("/")
            frame["running"], frame["threads"] = int(running), int(total or 0)
        elif key == "U" and len(parts) >= 2:
            frame["uptime"] = int(float(parts[1]))
        elif key == "P" and len(parts) >= 2:
            frame["tasks"] = int(parts[1])
    return frame


def _cpu_split(prev: list[int], cur: list[int]) -> list[float]:
    """/proc/stat alanları (user nice system idle iowait irq softirq steal) farkından htop renkleri:
    [kullanıcı, nice, sistem (+irq/softirq), diğer (iowait+steal)] yüzdeleri."""
    d = [max(0, c - p) for p, c in zip(prev, cur)]
    total = sum(d) or 1
    user, nice, system, _idle, iowait, irq, softirq, steal = d
    return [round(100 * v / total, 1) for v in (user, nice, system + irq + softirq, iowait + steal)]


def _message(prev: dict, cur: dict) -> dict:
    cpus = []
    names = sorted((k for k in cur["cpu"] if k != "cpu"), key=lambda k: int(k[3:] or 0))
    for name in names:
        if name in prev["cpu"]:
            cpus.append(_cpu_split(prev["cpu"][name], cur["cpu"][name]))
    total = _cpu_split(prev["cpu"].get("cpu", cur["cpu"]["cpu"]), cur["cpu"]["cpu"]) if "cpu" in cur["cpu"] else [0, 0, 0, 0]
    m = cur["mem"]
    mem_total = m.get("MemTotal", 0)
    buffers = m.get("Buffers", 0)
    # htop'un hesabı: önbellek = Cached + SReclaimable - Shmem; kullanılan = toplam - boş - tampon - önbellek.
    cache = max(0, m.get("Cached", 0) + m.get("SReclaimable", 0) - m.get("Shmem", 0))
    used = max(0, mem_total - m.get("MemFree", 0) - buffers - cache)
    swap_total = m.get("SwapTotal", 0)
    return {
        "cpus": cpus,
        "cpu": round(sum(total[:3]) + total[3], 1),
        "mem": {"total": mem_total, "used": used, "buffers": buffers, "cache": cache},
        "swap": {"total": swap_total, "used": max(0, swap_total - m.get("SwapFree", 0))},
        "load": cur.get("load", [0, 0, 0]),
        "tasks": cur.get("tasks", 0),
        "threads": cur.get("threads", 0),
        "running": cur.get("running", 0),
        "uptime": cur.get("uptime", 0),
    }


class PerfSocket(tornado.websocket.WebSocketHandler):
    """Bağlantı bilgisi (ssh komutu/ortamı) ekran köprüsüyle ortak: bkz. __main__.lookup/SSH_OPTS."""

    proc: asyncio.subprocess.Process | None = None
    counted = False

    def initialize(self, lookup, ssh_opts):
        self._lookup = lookup
        self._ssh_opts = ssh_opts

    async def open(self, board_id: str):
        global _streams
        if _streams >= MAX_STREAMS:
            self.close(4029, "limit")
            return
        _streams += 1
        self.counted = True
        found = await asyncio.to_thread(self._lookup, int(board_id))
        if found is None:
            self.close(4001, "board")
            return
        board, ssh_user, password = found
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
        self.proc = await asyncio.create_subprocess_exec(
            "sshpass", "-e", "ssh", *self._ssh_opts, f"{ssh_user}@{board['ip']}", _REMOTE_LOOP,
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            env=env,
        )
        asyncio.ensure_future(self._pump())

    async def _pump(self):
        proc = self.proc
        prev = None
        lines: list[str] = []
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode(errors="replace").strip()
                if line != "@":
                    lines.append(line)
                    continue
                if lines:
                    cur = _parse(lines)
                    if prev is not None and "cpu" in cur["cpu"]:
                        await self.write_message(json.dumps(_message(prev, cur)))
                    prev = cur
                lines = []
        except tornado.websocket.WebSocketClosedError:
            pass
        except (ValueError, KeyError, IndexError):
            log.exception("başarım çerçevesi çözümlenemedi")
        finally:
            if proc.returncode is None:
                proc.kill()
            rc = await proc.wait()
        if self.ws_connection is not None:
            self.close(4002 if rc == 255 else 4005, "ssh" if rc == 255 else f"exit {rc}")

    def on_close(self):
        global _streams
        if self.counted:
            self.counted = False
            _streams -= 1
        proc = self.proc
        if proc and proc.returncode is None:
            proc.kill()
