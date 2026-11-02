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

"""Sağ menü "Sohbet": Ankamon kullanıcısı ile tahtadaki kişi arasında canlı yazışma (ws /screen/ws/chat/<tahta id>).

Tahta başına TEK sohbet merkezi: birden çok tarayıcı penceresi aynı sohbeti görür, tahtada tek pencere (chat_agent.py, tek
SSH oturumu) açılır. Tahtaya port açılmaz, kurulum yapılmaz: ajan SSH üstünden stdin/stdout ile konuşur. Her ileti gönderilir
gönderilmez `chat_messages`'a yazılır (Oturumlar ▸ Sohbet geçmişi). Son pencere kapanınca tahtadaki pencere de kapanır.
Ajan düşerse (oturum değişti → 75, tahta kapandı) pencere açık kaldıkça birkaç saniyede bir yeniden başlatılır.

Yetki: nginx /screen/ws/chat/ → "boards.chat". Tarayıcı iletileri: {"text": "..."}. Sunucu iletileri:
{"t":"msg", id, direction, author, text, at} / {"t":"status", "state":"online|closed|offline", "detail"}.
Kapanış kodları: 4001 tahta yok · 4029 sınır aşıldı.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os

import tornado.websocket

from .. import activity, db
from ..executor.cast import _FIND_DISPLAY

log = logging.getLogger("ankamon.screen.chat")

MAX_BOARDS = int(os.environ.get("CHAT_MAX_BOARDS", "64"))
HISTORY = 100
RETRY_SECONDS = 5
EXIT_VT_CHANGED = 75
EXIT_NO_GUI = 46

_AGENT = open(os.path.join(os.path.dirname(__file__), "chat_agent.py"), encoding="utf-8").read()
_REMOTE = _FIND_DISPLAY + r"""
python3 -c 'import gi; gi.require_version("Gtk", "3.0"); from gi.repository import Gtk' 2>/dev/null || { echo NO_GUI >&2; exit 46; }
export DISPLAY="$D" HOME=/tmp NO_AT_BRIDGE=1
[ -n "$A" ] && export XAUTHORITY="$A"
echo "U $U"
exec python3 -u -c "import base64,sys;exec(compile(base64.b64decode(sys.argv[1]),'ankamon-chat','exec'))" """ + base64.b64encode(_AGENT.encode()).decode()

_hubs: dict[int, "Hub"] = {}


def _save(board_id: int, name: str, session: str | None, direction: str, author: str, body: str) -> dict:
    with db.connect() as conn:
        row = conn.execute(
            """INSERT INTO chat_messages (board_id, board_name, session_username, direction, author, body)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, extract(epoch FROM sent_at)::bigint AS at""",
            (board_id, name, session, direction, author, body)).fetchone()
    return {"t": "msg", "id": row["id"], "direction": direction, "author": author, "text": body, "at": row["at"]}


def _history(board_id: int) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            """SELECT id, direction, author, body, extract(epoch FROM sent_at)::bigint AS at FROM chat_messages
               WHERE board_id = %s ORDER BY id DESC LIMIT %s""", (board_id, HISTORY)).fetchall()
    return [{"t": "msg", "id": r["id"], "direction": r["direction"], "author": r["author"], "text": r["body"], "at": r["at"]}
            for r in reversed(rows)]


def _opened(name: str, user: str) -> None:
    with db.connect() as conn:
        activity.record(conn, f"Sohbet: {user} → {name}")


class Hub:
    def __init__(self, board_id: int, lookup, ssh_opts):
        self.board_id = board_id
        self._lookup = lookup
        self._ssh_opts = ssh_opts
        self.clients: set = set()
        self.proc = None
        self.name = "?"
        self.session: str | None = None
        self.task = None
        self.status = {"t": "status", "state": "offline", "detail": "Bağlanılıyor…"}
        self.sent_now: list[dict] = []   # bu oturumun iletileri: ajan yeniden başlarsa pencereye yeniden yazılır

    def broadcast(self, msg: dict) -> None:
        text = json.dumps(msg, ensure_ascii=False)
        for client in list(self.clients):
            try:
                client.write_message(text)
            except tornado.websocket.WebSocketClosedError:
                self.clients.discard(client)

    def set_status(self, state: str, detail: str = "") -> None:
        self.status = {"t": "status", "state": state, "detail": detail}
        self.broadcast(self.status)

    def ensure_running(self) -> None:
        if self.task is None or self.task.done():
            self.task = asyncio.ensure_future(self._loop())

    async def _loop(self) -> None:
        while self.clients:
            rc, err = await self._run_agent()
            if not self.clients:
                break
            if rc == EXIT_VT_CHANGED:
                continue            # oturum değişti: hemen yeni ekranda
            if rc == EXIT_NO_GUI or "NO_GUI" in err:
                self.set_status("offline", "Tahtada sohbet penceresi açılamıyor (python3-gi yok).")
            elif rc == 5:
                self.set_status("offline", "SSH girişi reddedildi.")
            else:
                self.set_status("offline", "Tahtaya ulaşılamıyor; yeniden deneniyor…")
            await asyncio.sleep(RETRY_SECONDS)
        _hubs.pop(self.board_id, None)

    async def _run_agent(self) -> tuple[int | None, str]:
        found = await asyncio.to_thread(self._lookup, self.board_id)
        if found is None:
            self.set_status("offline", "Tahta bulunamadı.")
            await asyncio.sleep(RETRY_SECONDS)
            return None, ""
        board, ssh_user, password = found
        self.name = board["name"]
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
        proc = await asyncio.create_subprocess_exec(
            "sshpass", "-e", "ssh", *self._ssh_opts, f"{ssh_user}@{board['ip']}", _REMOTE,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env,
        )
        self.proc = proc
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                await self._from_board(raw.decode("utf-8", "replace").strip())
        finally:
            self.proc = None
            if proc.returncode is None:
                proc.kill()
            rc = await proc.wait()
        return rc, (await proc.stderr.read()).decode("utf-8", "replace")

    async def _from_board(self, line: str) -> None:
        if line.startswith("U "):
            # Giriş ekranının kullanıcısı (lightdm) oturum değildir.
            name = line[2:].strip()
            self.session = name if name and name != "lightdm" else None
            return
        try:
            msg = json.loads(line)
        except ValueError:
            return
        if msg.get("t") == "ready":
            who = f" — oturum: {self.session}" if self.session else " — giriş ekranı"
            self.set_status("online", "Tahtada sohbet penceresi açık" + who)
            for old in self.sent_now[-20:]:
                self._write_agent({"t": "msg", "author": old["author"], "text": old["text"]})
        elif msg.get("t") == "closed":
            self.set_status("closed", "Tahtadaki kişi pencereyi kapattı; yeni iletiyle yeniden açılır.")
        elif msg.get("t") == "msg" and msg.get("text"):
            author = self.session or "Tahta"
            saved = await asyncio.to_thread(_save, self.board_id, self.name, self.session, "in", author, str(msg["text"])[:4000])
            self.sent_now.append(saved)
            self.broadcast(saved)

    def _write_agent(self, msg: dict) -> None:
        proc = self.proc
        if proc and proc.returncode is None and proc.stdin and not proc.stdin.is_closing():
            proc.stdin.write((json.dumps(msg, ensure_ascii=False) + "\n").encode())

    async def from_browser(self, user: str, text: str) -> None:
        saved = await asyncio.to_thread(_save, self.board_id, self.name, self.session, "out", user, text)
        self.sent_now.append(saved)
        self.broadcast(saved)
        self._write_agent({"t": "msg", "author": user, "text": text})

    def client_left(self, client) -> None:
        self.clients.discard(client)
        if not self.clients and self.proc and self.proc.returncode is None:
            self._write_agent({"t": "end"})
            proc = self.proc
            # Pencere bildirimi göstersin, sonra SSH kapanır (ajan kendisi de kapanır).
            asyncio.get_event_loop().call_later(2, lambda: proc.returncode is None and proc.kill())


class ChatSocket(tornado.websocket.WebSocketHandler):
    hub: Hub | None = None

    def initialize(self, lookup, ssh_opts):
        self._lookup = lookup
        self._ssh_opts = ssh_opts

    async def open(self, board_id: str):
        board_id = int(board_id)
        self.user = self.request.headers.get("X-Auth-User", "") or "?"
        found = await asyncio.to_thread(self._lookup, board_id)
        if found is None:
            self.close(4001, "board")
            return
        if board_id not in _hubs and len(_hubs) >= MAX_BOARDS:
            self.close(4029, "limit")
            return
        hub = _hubs.get(board_id)
        if hub is None:
            hub = _hubs[board_id] = Hub(board_id, self._lookup, self._ssh_opts)
        hub.name = found[0]["name"]
        for msg in await asyncio.to_thread(_history, board_id):
            await self.write_message(json.dumps(msg, ensure_ascii=False))
        self.hub = hub
        hub.clients.add(self)
        await self.write_message(json.dumps(hub.status, ensure_ascii=False))
        hub.ensure_running()
        await asyncio.to_thread(_opened, hub.name, self.user)

    async def on_message(self, message):
        if not self.hub:
            return
        try:
            text = str(json.loads(message).get("text") or "").strip()
        except (ValueError, AttributeError):
            return
        if text:
            await self.hub.from_browser(self.user, text[:4000])

    def on_close(self):
        if self.hub:
            self.hub.client_left(self)
