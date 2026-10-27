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

"""Görev yöneticisi: ws://127.0.0.1:8890/screen/ws/taskmgr/<tahta id> (nginx /screen/ws/taskmgr/, yetki "taskmgr").

Tahtalar/Ekranlar sağ menüsündeki "Görev yöneticisi" penceresi (frontend ui/taskmgr/) bu WebSocket'i açar.
Pencere açık kaldıkça tahtaya TEK bir canlı SSH bağlantısı tutulur ve tahtada taskmgr_agent.py (yalnız standart
kitaplık; kurulum yok) çalışır: her `interval` sn bir ölçüm çerçevesi (süreçler, CPU/bellek/disk/ağ/GPU,
pencereler, oturumlar) basar, komutları (sonlandır, öncelik, hizmet, başlangıç…) stdin'den alır. Pencere
kapanınca / sayfa yenilenince WebSocket kapanır → SSH süreci öldürülür → ajanın stdin'i kapanır, ajan çıkar.

Komutlar burada süzülür (izinli işlemler) ve değişiklik yapanlar audit_log'a yazılır (kim, hangi tahtada, ne).
Kapanış kodları: 4001 tahta yok · 4002 SSH ile ulaşılamadı · 4003 SSH girişi reddedildi · 4004 tahtada python3 yok
· 4029 eşzamanlı görev yöneticisi sınırı.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os

import tornado.websocket

from .. import db

log = logging.getLogger("ankamon.screen.taskmgr")

MAX_SESSIONS = int(os.environ.get("TASKMGR_MAX_SESSIONS", "16"))
_AGENT = open(os.path.join(os.path.dirname(__file__), "taskmgr_agent.py"), encoding="utf-8").read()
_REMOTE = ("command -v python3 >/dev/null 2>&1 || { echo NO_PYTHON >&2; exit 44; }; "
           "exec python3 -u -c \"import base64,sys;exec(compile(base64.b64decode(sys.argv[1]),'ankamon-taskmgr','exec'))\" "
           + base64.b64encode(_AGENT.encode()).decode())

# Okuma/görünüm komutları (audit'e yazılmaz) ve değişiklik yapan komutlar (audit'e yazılır).
_READ_OPS = {"interval", "want", "props", "getaffinity"}
_WRITE_OPS = {"kill", "killtree", "renice", "affinity", "efficiency", "svc", "startup", "logout", "lock", "run"}
_ACTION_TITLE = {
    "kill": "Görevi sonlandır", "killtree": "İşlem ağacını sonlandır", "renice": "Öncelik ayarla",
    "affinity": "Benzeşim ayarla", "efficiency": "Verimlilik modu", "svc": "Hizmet", "startup": "Başlangıç uygulaması",
    "logout": "Oturumu kapat", "lock": "Oturumu kilitle", "run": "Yeni görev çalıştır",
}

_sessions = 0


def _audit(username: str, ip: str, board: dict, cmd: dict, res: dict) -> None:
    detail = {k: v for k, v in cmd.items() if k not in ("id", "op")}
    detail.update({"board_id": board["id"], "ok": bool(res.get("ok")), "msg": res.get("msg")})
    try:
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO audit_log (user_id, username, action, target, detail, ip)"
                " VALUES ((SELECT id FROM users WHERE username = %s), %s, %s, %s, %s::jsonb, %s)",
                (username, username, "taskmgr." + cmd["op"], f"{board['name']}: {_ACTION_TITLE.get(cmd['op'], cmd['op'])}",
                 json.dumps(detail, ensure_ascii=False), ip),
            )
    except Exception:  # noqa: BLE001 — kayıt hatası işlemi bozmasın
        log.exception("görev yöneticisi audit kaydı yazılamadı")


class TaskMgrSocket(tornado.websocket.WebSocketHandler):
    proc: asyncio.subprocess.Process | None = None
    counted = False
    board: dict | None = None
    pending: dict

    def initialize(self, lookup, ssh_opts):
        self._lookup = lookup
        self._ssh_opts = ssh_opts
        self.pending = {}

    def get_compression_options(self):
        return {}  # permessage-deflate: çerçeveler (JSON, ~25 KB/sn) iyi sıkışır

    async def open(self, board_id: str):
        global _sessions
        if _sessions >= MAX_SESSIONS:
            self.close(4029, "limit")
            return
        _sessions += 1
        self.counted = True
        self.user = self.request.headers.get("X-Auth-User", "") or "?"
        self.client_ip = self.request.remote_ip
        found = await asyncio.to_thread(self._lookup, int(board_id))
        if found is None:
            self.close(4001, "board")
            return
        board, ssh_user, password = found
        self.board = {"id": int(board_id), "name": board["name"], "ip": board["ip"]}
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
        self.proc = await asyncio.create_subprocess_exec(
            "sshpass", "-e", "ssh", *self._ssh_opts, f"{ssh_user}@{board['ip']}", _REMOTE,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env=env, limit=8 * 1024 * 1024,
        )
        log.info("görev yöneticisi açıldı: %s → %s", self.user, board["name"])
        asyncio.ensure_future(self._pump())

    async def _pump(self):
        proc = self.proc
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                if '"t":"res"' in line[:40]:
                    try:
                        res = json.loads(line)
                    except ValueError:
                        res = {}
                    cmd = self.pending.pop(res.get("id"), None)
                    if cmd and cmd.get("op") in _WRITE_OPS:
                        await asyncio.to_thread(_audit, self.user, self.client_ip, self.board, cmd, res)
                await self.write_message(line)
        except tornado.websocket.WebSocketClosedError:
            pass
        finally:
            if proc.returncode is None:
                proc.kill()
            rc = await proc.wait()
        err = (await proc.stderr.read()).decode("utf-8", "replace")
        if self.ws_connection is not None:
            if rc == 44 or "NO_PYTHON" in err:
                self.close(4004, "python")
            elif rc == 5:
                self.close(4003, "auth")
            elif rc == 255:
                self.close(4002, "ssh")
            else:
                self.close(4005, f"exit {rc}")

    def on_message(self, message):
        proc = self.proc
        if not proc or proc.returncode is not None or not proc.stdin or proc.stdin.is_closing():
            return
        try:
            cmd = json.loads(message)
        except ValueError:
            return
        if not isinstance(cmd, dict) or cmd.get("op") not in _READ_OPS | _WRITE_OPS:
            return
        if cmd["op"] in _WRITE_OPS:
            self.pending[cmd.get("id")] = cmd
        proc.stdin.write((json.dumps(cmd, ensure_ascii=False) + "\n").encode())

    def on_close(self):
        global _sessions
        if self.counted:
            self.counted = False
            _sessions -= 1
        proc = self.proc
        if proc and proc.returncode is None:
            proc.kill()  # SSH kapanınca tahtadaki ajanın stdin'i kapanır, ajan çıkar
        if self.board:
            log.info("görev yöneticisi kapandı: %s → %s", self.user, self.board["name"])
