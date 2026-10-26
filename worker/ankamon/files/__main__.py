"""Dosya gezgini servisi: http://127.0.0.1:8895 (nginx /files-api/ → yetki: oturum + "filemanager").

GET  /list?board=<id>&path=/home                  → {path, real, owner, group, mode, items:[…]}
POST /delete  {board, paths:[…]}                 → {ok}
POST /rename  {board, path, name}                → {ok, path}
POST /mkdir   {board, path, name}                → {ok, path}
POST /copy    {src_board, src_dir, names:[…], dst_board, dst_dir} → {id}
GET  /copy/<id>                                  → {state: running|done|failed|cancelled, bytes, total, message, …}
POST /copy/<id>/cancel                           → {ok}

Toplu dağıtma/toplama (bkz. bulk.py; işler yalnız başlatan kullanıcıya görünür):
POST /bulk/users      {boards:[…]}                → {boards:[{id, name, users:[…]|error}], limit}
POST /bulk/upload                                 → {token}   (dağıtılacak dosyalar için yükleme alanı)
PUT  /bulk/upload/<jeton>?path=<göreli yol>       ← dosya gövdesi (akış)
POST /bulk/distribute {token, boards, users:{logged, names}, location:{kind, path}, conflict, relay} → {id}
POST /bulk/collect    {boards, users, location, patterns:[…], excludes:[…], deep, skip_hidden, move, dry} → {id}
GET  /bulk/<id>                                   → iş durumu (tahta/hedef satırları, olaylar)
POST /bulk/<id>/cancel | /bulk/<id>/discard | /bulk/<id>/resume | /bulk/<id>/revert
GET  /bulk/<id>/archive?fmt=zip|tgz | /bulk/<id>/manifest | /bulk/<id>/file?path=…   (toplananlar)

Kim yaptı: nginx'in oturumdan doldurduğu X-Auth-User. Değiştiren her işlem (silme, ad değiştirme, klasör,
kopyalama) komut loglarına (source=files) ve etkinlik günlüğüne yazılır; listeleme yazılmaz.
POST'larda X-Requested-With: ankamon şartı (ana API ile aynı CSRF önlemi).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import queue
import threading
import urllib.parse

import tornado.ioloop
import tornado.iostream
import tornado.web

from .. import activity, db
from ..executor.jobs import _board_access
from . import bulk, copy, remote
from .remote import RemoteError

log = logging.getLogger("ankamon.files")

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
        if self.request.method in ("POST", "PUT") and self.request.headers.get("X-Requested-With") != "ankamon":
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


def _board_ids(data: dict) -> list[int]:
    ids = data.get("boards") or []
    if not isinstance(ids, list) or not ids or len(ids) > 2000:
        raise RemoteError("Tahta seçilmedi.")
    try:
        return list(dict.fromkeys(int(i) for i in ids))
    except (TypeError, ValueError):
        raise RemoteError("Geçersiz tahta.")


async def _accesses(ids: list[int]) -> list[dict]:
    return [await asyncio.to_thread(_access, i) for i in ids]


class BulkUsersHandler(Base):
    async def post(self):
        async def work():
            boards = await _accesses(_board_ids(self.body()))
            sem = asyncio.Semaphore(bulk.parallel_limit())

            async def one(b):
                async with sem:
                    try:
                        return {"id": b["id"], "name": b["name"], "users": await asyncio.to_thread(bulk.board_users, b)}
                    except RemoteError as exc:
                        return {"id": b["id"], "name": b["name"], "error": str(exc)}
            return {"boards": await asyncio.gather(*(one(b) for b in boards)), "limit": bulk.parallel_limit()}
        await self.guard(work())


class BulkUploadHandler(Base):
    async def post(self):
        async def work():
            try:
                total = int(self.body().get("total") or 0)
            except (TypeError, ValueError):
                total = 0
            return {"token": bulk.new_upload(self.user, total)}
        await self.guard(work())


@tornado.web.stream_request_body
class BulkUploadFileHandler(Base):
    def prepare(self):
        super().prepare()
        self.request.connection.set_max_body_size(1 << 40)
        self.fh = None
        self.error = None
        try:
            self.fh = open(bulk.upload_file(self.path_args[0], self.user, self.get_argument("path", "")), "wb")
        except (RemoteError, OSError) as exc:
            self.error = str(exc)

    def data_received(self, chunk):
        if self.fh:
            self.fh.write(chunk)

    def put(self, token):
        if self.fh:
            self.fh.close()
        if self.error:
            self.set_status(400)
            self.write({"error": self.error})
        else:
            self.write({"ok": True})

    def on_connection_close(self):
        if self.fh and not self.fh.closed:
            self.fh.close()


def _bulk_record(owner: str):
    def done(job: dict) -> None:
        opts = job["options"]
        if opts.get("dry"):
            return   # önizleme: tahtada hiçbir şey değişmedi, kayda gerek yok
        for row in job["boards"]:
            if row["state"] in ("skipped", "cancelled") and not row["targets"]:
                continue
            who = ", ".join(t["user"] or t["dir"] for t in row["targets"][:6])
            if job["kind"] == "distribute":
                what = ", ".join(opts["names"][:5]) + (f" … (+{len(opts['names']) - 5})" if len(opts["names"]) > 5 else "")
                text = f"dağıtıldı: {{{what}}} → {opts['location_text']} ({who})"
            else:
                verb = "taşındı" if opts["move"] else "toplandı"
                text = f"{verb}: {opts['location_text']} — {opts['what_text']} ({who})"
            text += f" — {row['message']}"
            _record({"id": row["id"], "name": row["name"]}, owner, text, row["state"] == "done")
    return done


class BulkDistributeHandler(Base):
    async def post(self):
        async def work():
            data = self.body()
            boards = await _accesses(_board_ids(data))
            users = bulk.check_selection(data.get("users"))
            location = bulk.check_location(data.get("location"))
            prepared = await asyncio.to_thread(bulk.prepare_distribute, self.user, str(data.get("token") or ""))
            return {"id": bulk.start_distribute(self.user, prepared, boards, users, location,
                                                data.get("conflict", "overwrite"), _bulk_record(self.user),
                                                relay=bool(data.get("relay", True)))}
        await self.guard(work())


class BulkCollectHandler(Base):
    async def post(self):
        async def work():
            data = self.body()
            boards = await _accesses(_board_ids(data))
            users = bulk.check_selection(data.get("users"))
            location = bulk.check_location(data.get("location"))
            patterns = data.get("patterns") or []
            if not isinstance(patterns, list):
                raise RemoteError("Geçersiz desen.")
            excludes = data.get("excludes") or []
            if not isinstance(excludes, list):
                raise RemoteError("Geçersiz hariç tutma.")
            return {"id": bulk.start_collect(self.user, boards, users, location, patterns,
                                             bool(data.get("move")), _bulk_record(self.user), excludes=excludes,
                                             deep=bool(data.get("deep")), skip_hidden=bool(data.get("skip_hidden")),
                                             dry=bool(data.get("dry")))}
        await self.guard(work())


class BulkJobHandler(Base):
    def job(self, job_id: str) -> dict:
        job = bulk.get(int(job_id), self.user)
        if not job:
            raise tornado.web.HTTPError(404)
        return job

    def write_error(self, status_code, **kwargs):
        self.write({"error": "İş bulunamadı (süresi dolmuş olabilir)." if status_code == 404 else "Sunucu hatası."})


class BulkStatusHandler(BulkJobHandler):
    def get(self, job_id):
        self.write(bulk.public(self.job(job_id)))


class BulkCancelHandler(BulkJobHandler):
    def post(self, job_id):
        self.job(job_id)
        self.write({"ok": bulk.cancel(int(job_id), self.user)})


class BulkResumeHandler(BulkJobHandler):
    """İptal edilmiş dağıtmayı sürdürür (bitmemiş tahtalar; arşiv sunucuda)."""
    async def post(self, job_id):
        self.job(job_id)
        try:
            self.write({"ok": bulk.resume(int(job_id), self.user)})
        except RemoteError as exc:
            self.set_status(400)
            self.write({"error": str(exc)})


class BulkRevertHandler(BulkJobHandler):
    """Dağıtmanın hedeflerde yeni oluşturduğu öğeleri siler (iptal sonrası "kopyalananları sil")."""
    async def post(self, job_id):
        job = self.job(job_id)
        try:
            res = await asyncio.to_thread(bulk.revert, int(job_id), self.user)
        except RemoteError as exc:
            self.set_status(400)
            self.write({"error": str(exc)})
            return
        await asyncio.to_thread(_record_revert, job, self.user, res)
        self.write(res)


def _record_revert(job: dict, user: str, res: dict) -> None:
    for b in job["boards"]:
        if any(t.get("message", "").startswith("Geri alındı") for t in b["targets"]):
            _record({"id": b["id"], "name": b["name"]}, user,
                    f"dağıtma geri alındı (iptal sonrası): kopyalanan öğeler {job['options']['location_text']} konumundan silindi")


class BulkDiscardHandler(BulkJobHandler):
    def post(self, job_id):
        bulk.discard(self.job(job_id))
        self.write({"ok": True})


class BulkManifestHandler(BulkJobHandler):
    async def get(self, job_id):
        job = self.job(job_id)
        # name: "klasöre kaydet" kipinde dosyaların konacağı alt klasörün adı (arşiv adıyla aynı).
        self.write({"files": await asyncio.to_thread(bulk.manifest, job),
                    "name": await asyncio.to_thread(bulk.archive_name, job)})


class BulkFileHandler(BulkJobHandler):
    async def get(self, job_id):
        job = self.job(job_id)
        try:
            path = bulk.local_file(job, self.get_argument("path", ""))
        except RemoteError as exc:
            self.set_status(404)
            self.write({"error": str(exc)})
            return
        self.set_header("Content-Type", "application/octet-stream")
        self.set_header("Content-Length", str(os.path.getsize(path)))
        with open(path, "rb") as fh:
            while True:
                chunk = await asyncio.to_thread(fh.read, bulk.CHUNK)
                if not chunk:
                    break
                self.write(chunk)
                await self.flush()


class BulkArchiveHandler(BulkJobHandler):
    async def get(self, job_id):
        job = self.job(job_id)
        if job["state"] == "running" or job.get("discarded"):
            raise tornado.web.HTTPError(404)
        fmt = "zip" if self.get_argument("fmt", "zip") == "zip" else "tgz"
        name = await asyncio.to_thread(bulk.archive_name, job)
        name += ".zip" if fmt == "zip" else ".tar.gz"
        self.set_header("Content-Type", "application/zip" if fmt == "zip" else "application/gzip")
        self.set_header("Content-Disposition", f"attachment; filename*=UTF-8''{urllib.parse.quote(name)}")
        q: queue.Queue = queue.Queue(maxsize=8)
        stop = threading.Event()
        threading.Thread(target=bulk.archive_producer, args=(job, fmt, q, stop), daemon=True).start()
        try:
            while True:
                item = await asyncio.to_thread(q.get)
                if item is None:
                    break
                if isinstance(item, Exception):
                    raise item
                self.write(item)
                await self.flush()
            job["delivered"] = fmt
        except tornado.iostream.StreamClosedError:
            pass
        finally:
            stop.set()


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
        (r"/bulk/users", BulkUsersHandler),
        (r"/bulk/upload", BulkUploadHandler),
        (r"/bulk/upload/([0-9a-f]+)", BulkUploadFileHandler),
        (r"/bulk/distribute", BulkDistributeHandler),
        (r"/bulk/collect", BulkCollectHandler),
        (r"/bulk/(\d+)", BulkStatusHandler),
        (r"/bulk/(\d+)/cancel", BulkCancelHandler),
        (r"/bulk/(\d+)/discard", BulkDiscardHandler),
        (r"/bulk/(\d+)/resume", BulkResumeHandler),
        (r"/bulk/(\d+)/revert", BulkRevertHandler),
        (r"/bulk/(\d+)/manifest", BulkManifestHandler),
        (r"/bulk/(\d+)/file", BulkFileHandler),
        (r"/bulk/(\d+)/archive", BulkArchiveHandler),
    ])
    os.makedirs(bulk.STAGE, mode=0o700, exist_ok=True)
    bulk.cleanup(startup=True)
    tornado.ioloop.PeriodicCallback(bulk.cleanup, 600_000).start()
    app.listen(PORT, address="127.0.0.1")
    log.info("dosya gezgini servisi 127.0.0.1:%d", PORT)
    asyncio.get_event_loop().run_forever()


if __name__ == "__main__":
    main()
