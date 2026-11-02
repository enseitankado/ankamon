# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
# Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
# https://github.com/enseitankado/ankamon
#
# Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
# GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
# daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
# değiştirebilirsiniz.
#
# Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
# YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
# verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
#
# Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
# dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
# adresine bakınız.
#
# Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
# parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
# lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
# korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
# kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).

"""Sağ menü "Wi-Fi Monitör": tahtanın Wi-Fi kartı, bağlantısı, çevredeki ağlar ve Bluetooth cihazları (ws /screen/ws/wifi/<tahta id>).

Varsayılan tek atış: bir tarama, sonuç, tahtada durum geri yüklenir, kapanış 1000. `?watch=1`: tarama döngüsü; tarayıcıdan "stop" iletisi
ya da bağlantının kapanması biter. Wi-Fi/Bluetooth kapalıysa tarama süresince geçici açılır, bağlantı kurulmaz, sonra eski durumuna
döner: tahtadaki program ve geri yükleme güvenceleri wifi_remote_scan.py'de. Bu köprü SSH stdin'ine kalp atışı yazar; stdin'in
kapanması (ya da SSH'nin ölmesi) tahtadaki bekçiyi tetikler. Yetki: /screen/ws/ ile aynı ("screen", nginx).
Sunucu iletileri, `phase` alanıyla:
  scanning {info}: tarama başladı.
  data {radio, device, state, connection, rows: [{kind: wifi|bt, name, addr, signal, chan, freq, rate, security, active}], info, at}.
  done {result: restored|shared|none|fail|lock, radio, wifi_temp, wifi_fail, bt}: geri yükleme sonucu, ardından kapanış 1000.
info: {wifi_temp: "0"|"1", wifi_fail, bt: absent|on|temp|fail:<neden>, disconnected}.
Kapanış kodları: 4001 tahta yok · 4002 SSH · 4003 giriş reddedildi · 4009 tahtada nmcli yok · 4010 tahtada /run yazılamıyor.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time

import tornado.websocket

from .wifi_remote_scan import wifimon_remote_command

log = logging.getLogger("ankamon.screen.wifi")

_HEARTBEAT_SECONDS = 5
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]|[\x01\x02]")
_BT_DEVICE_RE = re.compile(r"^Device ((?:[0-9A-F]{2}:){5}[0-9A-F]{2})\b")
_BT_RSSI_RE = re.compile(r"(-\d+)")


def _fields(line: str) -> list[str]:
    """nmcli -t: alanlar ':' ile ayrılır, alan içindeki ':' '\\:' olarak kaçar."""
    return [p.replace("\\:", ":").replace("\\\\", "\\") for p in re.split(r"(?<!\\):", line)]


def _keyvals(lines: list[str]) -> dict:
    return dict(line.split("=", 1) for line in lines if "=" in line)


def rssi_to_percent(rssi: int) -> int:
    """-100 dBm ve altı %0, -50 dBm ve üstü %100 (NetworkManager'ın Wi-Fi yüzdesine yakın ölçek)."""
    return max(0, min(100, 2 * (rssi + 100)))


def parse_bluetooth(lines: list[str]) -> list[dict]:
    """`bluetoothctl info` blokları. RSSI (5.66: "RSSI: -60"; yeni sürümler: "RSSI: 0xffffffc4 (-60)") yoksa signal None."""
    devices: list[dict] = []
    dev = None
    for raw in lines:
        line = _ANSI_RE.sub("", raw).strip()
        m = _BT_DEVICE_RE.match(line)
        if m:
            dev = {"kind": "bt", "addr": m.group(1), "name": "", "signal": None, "chan": "", "freq": "", "rate": "",
                   "security": "", "active": False}
            devices.append(dev)
        elif dev is not None and ":" in line:
            key, value = (p.strip() for p in line.split(":", 1))
            if key == "Name":
                dev["name"] = value
            elif key == "RSSI" and (r := _BT_RSSI_RE.search(value)):
                dev["signal"] = rssi_to_percent(int(r.group(1)))
            elif key == "Paired" and value == "yes":
                dev["security"] = "eşli"
            elif key == "Connected" and value == "yes":
                dev["active"] = True
    return devices


def parse(sections: dict) -> dict:
    out = {"phase": "data", "radio": (sections.get("RADIO") or [""])[0].strip(), "device": None, "state": None,
           "connection": None, "rows": [], "info": _keyvals(sections.get("INFO", [])), "at": int(time.time())}
    for line in sections.get("DEV", []):
        f = _fields(line)
        if len(f) >= 4 and f[1] == "wifi":
            out.update(device=f[0], state=f[2], connection=f[3] if f[3] not in ("", "--") else None)
            break
    wifi = []
    for line in sections.get("LIST", []):
        f = _fields(line)
        if len(f) < 8:
            continue
        wifi.append({
            "kind": "wifi", "active": f[0].strip() == "*", "addr": f[1], "name": f[2], "chan": f[3], "freq": f[4], "rate": f[5],
            "signal": int(f[6]) if f[6].isdigit() else 0, "security": f[7]})
    bluetooth = parse_bluetooth(sections.get("BT", []))
    by_signal = lambda n: (-n["active"], -(n["signal"] if n["signal"] is not None else -1))
    out["rows"] = sorted(wifi, key=by_signal) + sorted(bluetooth, key=by_signal)
    return out


class WifiSocket(tornado.websocket.WebSocketHandler):
    proc: asyncio.subprocess.Process | None = None

    def initialize(self, lookup, ssh_opts):
        self._lookup = lookup
        self._ssh_opts = ssh_opts

    async def open(self, board_id: str):
        found = await asyncio.to_thread(self._lookup, int(board_id))
        if found is None:
            self.close(4001, "board")
            return
        board, ssh_user, password = found
        watch = self.get_argument("watch", "0") == "1"
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
        self.proc = await asyncio.create_subprocess_exec(
            "sshpass", "-e", "ssh", *self._ssh_opts, f"{ssh_user}@{board['ip']}", wifimon_remote_command(watch),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, env=env,
        )
        self._beat_task = asyncio.ensure_future(self._heartbeat())
        asyncio.ensure_future(self._pump())

    async def _heartbeat(self):
        """Tahtadaki bekçinin kirası: kesilirse (ağ koptu, süreç öldü) tahta durumu kendisi geri yükler."""
        proc = self.proc
        try:
            while proc.returncode is None and not proc.stdin.is_closing():
                proc.stdin.write(b"k\n")
                await proc.stdin.drain()
                await asyncio.sleep(_HEARTBEAT_SECONDS)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _end_remote(self):
        """stdin EOF: tahtada bekçi taramayı bitirir, durumu geri yükler, @@DONE gelir."""
        if self.proc and self.proc.stdin and not self.proc.stdin.is_closing():
            self.proc.stdin.close()

    async def _pump(self):
        proc = self.proc
        sections: dict = {}
        current = None
        finished = False
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", "replace").rstrip("\n")
                if line == "@@START":
                    await self.write_message(json.dumps(
                        {"phase": "scanning", "info": _keyvals(sections.get("INFO", []))}, ensure_ascii=False))
                    sections, current = {}, None
                elif line == "@@END":
                    await self.write_message(json.dumps(parse(sections), ensure_ascii=False))
                    sections, current = {}, None
                elif line == "@@DONE":
                    finished = True
                    await self.write_message(json.dumps(
                        {"phase": "done", **_keyvals(sections.get("RESTORED", []))}, ensure_ascii=False))
                    sections, current = {}, None
                elif line.startswith("@@"):
                    current = sections.setdefault(line[2:], [])
                elif current is not None and line:
                    current.append(line)
        except tornado.websocket.WebSocketClosedError:
            pass
        finally:
            self._end_remote()
            if proc.returncode is None and not finished:
                proc.kill()
            rc = await proc.wait()
        if self.ws_connection is not None:
            if finished:
                self.close(1000, "done")
            else:
                self.close({49: 4009, 48: 4010, 5: 4003, 255: 4002}.get(rc, 4005), f"exit {rc}")

    def on_message(self, message):
        if message == "stop":
            self._end_remote()

    def on_close(self):
        self._end_remote()
        if self.proc and self.proc.returncode is None:
            self.proc.kill()
