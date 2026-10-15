"""Dosya gezgini servisi: http://127.0.0.1:8895 (nginx /files-api/ → yetki: oturum + "filemanager").

GET  /list?board=<id>&path=/home                  → {path, real, owner, group, mode, items:[…]}
POST /delete  {board, paths:[…]}                 → {ok}
POST /rename  {board, path, name}                → {ok, path}
POST /mkdir   {board, path, name}                → {ok, path}
POST /copy    {src_board, src_dir, names:[…], dst_board, dst_dir} → {id}
GET  /copy/<id>                                  → {state: running|done|failed|cancelled, bytes, total, message, …}
POST /copy/<id>/cancel                           → {ok}

Kim yaptı: nginx'in oturumdan doldurduğu X-Auth-User. Değiştiren her işlem (silme, ad değiştirme, klasör,
kopyalama) komut loglarına (source=files) ve etkinlik günlüğüne yazılır; listeleme yazılmaz.
POST'larda X-Requested-With: tihamon şartı (ana API ile aynı CSRF önlemi).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

import tornado.web

from .. import activity, db
from ..executor.jobs import _board_access
from . import copy, remote
from .remote import RemoteError

log = logging.getLogger("tihamon.files")

PORT = int(os.environ.get("FILES_PORT", "8895"))


def _access(board_id: int) -> dict:
    with db.connect() as conn:
        board = conn.execute(
            "SELECT id, host(ip) AS ip, coalesce(nullif(label, ''), hostname, host(ip)) AS name"
            " FROM boards WHERE id = %s", (board_id,),
        ).fetchone()
        if not board or not board["ip"]:
            raise RemoteError("Tahta bulunamadı ya da IP adresi yok.")
        user, password = _board_access(conn)
    if not password:
        raise RemoteError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
    return {"id": board["id"], "ip": board["ip"], "name": board["name"], "user": user, "password": password}


def _record(board: dict, username: str, text: str, ok: bool = True) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO command_log (board_id, board_name, username, source, command, status)"
            " VALUES (%s, %s, %s, 'files', %s, %s)",
            (board["id"], board["name"], username or "—", text[:1000], "ok" if ok else "failed"),
        )
        activity.record(conn, f"Dosyalar: {username or '—'} → {board['name']}: {text}"[:300],
                        "warn" if ok else "error")


def _size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return str(n)


class Base(tornado.web.RequestHandler):
    def prepare(self):
        if self.request.method == "POST" and self.request.headers.get("X-Requested-With") != "tihamon":
            raise tornado.web.HTTPError(403)
        self.user = self.request.headers.get("X-Auth-User", "")

    def body(self) -> dict:
        try:
            data = json.loads(self.request.body or b"{}")
        except ValueError:
            raise RemoteError("Geçersiz istek.")
        if not isinstance(data, dict):
            raise RemoteError("Geçersiz istek.")
        return data

    async def board(self, value) -> dict:
        try:
            board_id = int(value)
        except (TypeError, ValueError):
            raise RemoteError("Geçersiz tahta.")
        return await asyncio.to_thread(_access, board_id)

    def write_error(self, status_code, **kwargs):
        self.write({"error": "İzin verilmedi." if status_code == 403 else "Sunucu hatası."})

    async def guard(self, coro):
        """RemoteError → 400 + Türkçe ileti; diğer hatalar 500 (günlüğe)."""
        try:
            self.write(await coro)
        except RemoteError as exc:
            self.set_status(400)
            self.write({"error": str(exc)})


class ListHandler(Base):
    async def get(self):
        async def work():
            board = await self.board(self.get_argument("board", ""))
            return await remote.listdir(board, self.get_argument("path", "/home"))
        await self.guard(work())


class DeleteHandler(Base):
    async def post(self):
        async def work():
            data = self.body()
            board = await self.board(data.get("board"))
            paths = [remote.check_path(p) for p in (data.get("paths") or [])][:500]
            await remote.delete(board, paths)
            shown = ", ".join(paths[:5]) + (f" … (+{len(paths) - 5})" if len(paths) > 5 else "")
            await asyncio.to_thread(_record, board, self.user, f"silindi: {shown}")
            return {"ok": True}
        await self.guard(work())


class RenameHandler(Base):
    async def post(self):
        async def work():
            data = self.body()
            board = await self.board(data.get("board"))
            path = remote.check_path(data.get("path", ""))
            target = await remote.rename(board, path, data.get("name", ""))
            await asyncio.to_thread(_record, board, self.user, f"ad değiştirildi: {path} → {target}")
            return {"ok": True, "path": target}
        await self.guard(work())


class MkdirHandler(Base):
    async def post(self):
        async def work():
            data = self.body()
            board = await self.board(data.get("board"))
            target = await remote.mkdir(board, data.get("path", ""), data.get("name", ""))
            await asyncio.to_thread(_record, board, self.user, f"klasör oluşturuldu: {target}")
            return {"ok": True, "path": target}
        await self.guard(work())


class CopyHandler(Base):
    async def post(self):
        async def work():
            data = self.body()
            src = await self.board(data.get("src_board"))
            dst = await self.board(data.get("dst_board"))
            names = data.get("names") or []
            if not isinstance(names, list) or len(names) > 500:
                raise RemoteError("Geçersiz seçim.")
            user = self.user

            def done(job: dict) -> None:
                what = ", ".join(job["names"][:5]) + (f" … (+{len(job['names']) - 5})" if len(job["names"]) > 5 else "")
                text = (f"kopyalandı ({_size(job['total'])}): {src['name']}:{job['src']['dir']}/{{{what}}}"
                        f" → {job['dst']['dir']}")
                if job["state"] != "done":
                    text = f"kopyalama {'iptal edildi' if job['state'] == 'cancelled' else 'başarısız'}: " \
                           f"{src['name']}:{job['src']['dir']}/{{{what}}} → {job['dst']['dir']} — {job['message']}"
                _record(dst, user, text, job["state"] == "done")

            job_id = copy.start(src, data.get("src_dir", ""), names, dst, data.get("dst_dir", ""), done)
            return {"id": job_id}
        await self.guard(work())


class CopyStatusHandler(Base):
    def get(self, job_id: str):
        job = copy.jobs.get(int(job_id))
        if not job:
            self.set_status(404)
            self.write({"error": "Kopyalama bulunamadı."})
            return
        self.write(copy.public(job))


class CopyCancelHandler(Base):
    def post(self, job_id: str):
        self.write({"ok": copy.cancel(int(job_id))})


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    os.makedirs(remote.CM_DIR, mode=0o700, exist_ok=True)
    app = tornado.web.Application([
        (r"/list", ListHandler),
        (r"/delete", DeleteHandler),
        (r"/rename", RenameHandler),
        (r"/mkdir", MkdirHandler),
        (r"/copy", CopyHandler),
        (r"/copy/(\d+)", CopyStatusHandler),
        (r"/copy/(\d+)/cancel", CopyCancelHandler),
    ])
    app.listen(PORT, address="127.0.0.1")
    log.info("dosya gezgini servisi 127.0.0.1:%d", PORT)
    asyncio.get_event_loop().run_forever()


if __name__ == "__main__":
    main()
