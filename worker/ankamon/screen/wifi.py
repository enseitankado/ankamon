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

"""Sağ menü "Wi-Fi Monitör": tahtanın Wi-Fi kartı, bağlantısı ve çevredeki ağlar, canlı (ws /screen/ws/wifi/<tahta id>).

Salt okunur: tahtada `nmcli` birkaç saniyede bir okunur, kart açılıp kapatılmaz, bağlantı değiştirilmez. Pencere kapanınca
SSH ölür, döngü biter. Yetki: /screen/ws/ ile aynı ("screen", nginx). Sunucu iletisi: {radio, device, state, connection,
networks: [{ssid, bssid, chan, freq, rate, signal, security, active}], at}.
Kapanış kodları: 4001 tahta yok · 4002 SSH · 4003 giriş reddedildi · 4009 tahtada nmcli yok.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time

import tornado.websocket

log = logging.getLogger("ankamon.screen.wifi")

_REMOTE = r"""
command -v nmcli >/dev/null 2>&1 || { echo NO_NMCLI >&2; exit 49; }
while :; do
  echo '@@RADIO'; nmcli -t -f WIFI general 2>/dev/null
  echo '@@DEV'; nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device 2>/dev/null
  echo '@@LIST'; LC_ALL=C nmcli -t -f IN-USE,BSSID,SSID,CHAN,FREQ,RATE,SIGNAL,SECURITY device wifi list 2>/dev/null
  echo '@@END'
  sleep 6
done
"""


def _fields(line: str) -> list[str]:
    """nmcli -t: alanlar ':' ile ayrılır, alan içindeki ':' '\\:' olarak kaçar."""
    return [p.replace("\\:", ":").replace("\\\\", "\\") for p in re.split(r"(?<!\\):", line)]


def parse(sections: dict) -> dict:
    out = {"radio": (sections.get("RADIO") or [""])[0].strip(), "device": None, "state": None, "connection": None,
           "networks": [], "at": int(time.time())}
    for line in sections.get("DEV", []):
        f = _fields(line)
        if len(f) >= 4 and f[1] == "wifi":
            out.update(device=f[0], state=f[2], connection=f[3] if f[3] not in ("", "--") else None)
            break
    for line in sections.get("LIST", []):
        f = _fields(line)
        if len(f) < 8:
            continue
        out["networks"].append({
            "active": f[0].strip() == "*", "bssid": f[1], "ssid": f[2], "chan": f[3], "freq": f[4], "rate": f[5],
            "signal": int(f[6]) if f[6].isdigit() else 0, "security": f[7]})
    out["networks"].sort(key=lambda n: (-n["active"], -n["signal"]))
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
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
        self.proc = await asyncio.create_subprocess_exec(
            "sshpass", "-e", "ssh", *self._ssh_opts, f"{ssh_user}@{board['ip']}", _REMOTE,
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env,
        )
        asyncio.ensure_future(self._pump())

    async def _pump(self):
        proc = self.proc
        sections: dict = {}
        current = None
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", "replace").rstrip("\n")
                if line == "@@END":
                    await self.write_message(json.dumps(parse(sections), ensure_ascii=False))
                    sections, current = {}, None
                elif line.startswith("@@"):
                    current = sections.setdefault(line[2:], [])
                elif current is not None and line:
                    current.append(line)
        except tornado.websocket.WebSocketClosedError:
            pass
        finally:
            if proc.returncode is None:
                proc.kill()
            rc = await proc.wait()
        if self.ws_connection is not None:
            self.close({49: 4009, 5: 4003, 255: 4002}.get(rc, 4005), f"exit {rc}")

    def on_message(self, message):
        pass

    def on_close(self):
        if self.proc and self.proc.returncode is None:
            self.proc.kill()
