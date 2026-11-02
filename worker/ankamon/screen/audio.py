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

"""Ekran penceresindeki hoparlör düğmesi: tahtanın çıkış sesi tarayıcıya (ws /screen/ws/audio/<tahta id>).

Tahtada `parec`, oturum kullanıcısının pipewire-pulse soketinden varsayılan çıkışın izleme (monitor) kaynağını okur: ham
PCM SSH üstünden WebSocket'e akar, tarayıcı çalar (bkz. screen/index.html Tile.setAudio). Kurulum gerekmez, tahtanın
ses düzeyine dokunulmaz, tahtada ses kesilmez. Yalnız düğme açıkken akar (~770 kbit/sn); pencere kapanınca SSH ölür, parec biter.
Yetki: /screen/ws/ ile aynı ("screen", nginx). Biçim tarayıcıyla sabit: 24 kHz, stereo, s16le.
Kapanış kodları: 4001 tahta yok · 4002 SSH · 4003 SSH girişi reddedildi · 4008 tahtada ses sunucusu yok.
"""

from __future__ import annotations

import asyncio
import logging
import os

import tornado.websocket

from ..executor.cast import _FIND_DISPLAY

log = logging.getLogger("ankamon.screen.audio")

_REMOTE = _FIND_DISPLAY + r"""
P=/run/user/$UI/pulse/native
if [ -z "$UI" ] || [ ! -S "$P" ] || ! command -v parec >/dev/null 2>&1; then
  P=$(ls /run/user/*/pulse/native 2>/dev/null | head -n 1)
fi
[ -S "$P" ] && command -v parec >/dev/null 2>&1 || { echo NO_AUDIO >&2; exit 48; }
export PULSE_SERVER="unix:$P"
exec parec -d @DEFAULT_MONITOR@ --format=s16le --rate=24000 --channels=2 --latency-msec=60 --raw
"""


class AudioSocket(tornado.websocket.WebSocketHandler):
    proc: asyncio.subprocess.Process | None = None

    def initialize(self, lookup, ssh_opts):
        self._lookup = lookup
        self._ssh_opts = ssh_opts

    async def open(self, board_id: str):
        self.set_nodelay(True)
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
        log.info("ses aktarımı açıldı: %s", board["name"])
        asyncio.ensure_future(self._pump())

    async def _pump(self):
        proc = self.proc
        try:
            while True:
                data = await proc.stdout.read(8192)
                if not data:
                    break
                await self.write_message(data, binary=True)
        except tornado.websocket.WebSocketClosedError:
            pass
        finally:
            if proc.returncode is None:
                proc.kill()
            rc = await proc.wait()
        if self.ws_connection is None:
            return
        err = (await proc.stderr.read()).decode("utf-8", "replace")
        if rc == 48 or "NO_AUDIO" in err:
            self.close(4008, "audio")
        elif rc == 5:
            self.close(4003, "auth")
        elif rc == 255:
            self.close(4002, "ssh")
        else:
            log.info("ses aktarımı bitti (çıkış %s): %s", rc, err[-200:])
            self.close(4005, f"exit {rc}")

    def on_message(self, message):
        pass  # tek yönlü akış

    def on_close(self):
        if self.proc and self.proc.returncode is None:
            self.proc.kill()
