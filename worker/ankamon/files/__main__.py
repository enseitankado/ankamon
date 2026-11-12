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

"""Dosya gezgini servisi: http://127.0.0.1:8895 (nginx /files-api/ → yetki: oturum + "filemanager").

GET  /list?device=<id>&path=/home                  → {path, real, owner, group, mode, items:[…]}
POST /delete  {device, paths:[…]}                 → {ok}
POST /rename  {device, path, name}                → {ok, path}
POST /mkdir   {device, path, name}                → {ok, path}
POST /copy    {src_device, src_dir, names:[…], dst_device, dst_dir} → {id}
GET  /copy/<id>                                  → {state: running|done|failed|cancelled, bytes, total, message, …}
POST /copy/<id>/cancel                           → {ok}

Toplu dağıtma/toplama (bkz. bulk.py; işler yalnız başlatan kullanıcıya görünür):
POST /bulk/users      {devices:[…]}                → {devices:[{id, name, users:[…]|error}], limit}
POST /bulk/upload                                 → {token}   (dağıtılacak dosyalar için yükleme alanı)
PUT  /bulk/upload/<jeton>?path=<göreli yol>       ← dosya gövdesi (akış)
POST /bulk/distribute {token, devices, users:{logged, names}, location:{kind, path}, conflict, relay} → {id}
POST /bulk/collect    {devices, users, location, patterns:[…], excludes:[…], deep, skip_hidden, move, dry} → {id}
GET  /bulk/<id>                                   → iş durumu (cihaz/hedef satırları, olaylar)
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
from ..executor import home_restore
from ..executor.jobs import _device_access
from . import bulk, copy, remote
from .remote import RemoteError

log = logging.getLogger("ankamon.files")

PORT = int(os.environ.get("FILES_PORT", "8895"))


def _access(device_id: int) -> dict:
    with db.connect() as conn:
        device = conn.execute(
            "SELECT id, host(ip) AS ip, coalesce(nullif(label, ''), hostname, host(ip)) AS name"
            " FROM devices WHERE id = %s", (device_id,),
        ).fetchone()
        if not device or not device["ip"]:
            raise RemoteError("Cihaz bulunamadı ya da IP adresi yok.")
        user, password = _device_access(conn)
    if not password:
        raise RemoteError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
    return {"id": device["id"], "ip": device["ip"], "name": device["name"], "user": user, "password": password}


def _record(device: dict, username: str, text: str, ok: bool = True) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO command_log (device_id, device_name, username, source, command, status)"
            " VALUES (%s, %s, %s, 'files', %s, %s)",
            (device["id"], device["name"], username or "—", text[:1000], "ok" if ok else "failed"),
        )
        activity.record(conn, f"Dosyalar: {username or '—'} → {device['name']}: {text}"[:300],
                        "warn" if ok else "error")


def _size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return str(n)


class DeviceFilesRequestHandler(tornado.web.RequestHandler):
    def prepare(self):
        if self.request.method in ("POST", "PUT") and self.request.headers.get("X-Requested-With") != "ankamon":
            raise tornado.web.HTTPError(403)
        self.user = self.request.headers.get("X-Auth-User", "")

    def device_request_json(self) -> dict:
        try:
            data = json.loads(self.request.body or b"{}")
        except ValueError:
            raise RemoteError("Geçersiz istek.")
        if not isinstance(data, dict):
            raise RemoteError("Geçersiz istek.")
        return data

    async def resolve_device_access(self, value) -> dict:
        try:
            device_id = int(value)
        except (TypeError, ValueError):
            raise RemoteError("Geçersiz cihaz.")
        return await asyncio.to_thread(_access, device_id)

    def write_error(self, status_code, **kwargs):
        self.write({"error": "İzin verilmedi." if status_code == 403 else "Sunucu hatası."})

    async def respond_device_file_op(self, coro):
        """RemoteError → 400 + Türkçe ileti; diğer hatalar 500 (günlüğe)."""
        try:
            self.write(await coro)
        except RemoteError as exc:
            self.set_status(400)
            self.write({"error": str(exc)})


class DeviceDirListHandler(DeviceFilesRequestHandler):
    async def get(self):
        async def work():
            device = await self.resolve_device_access(self.get_argument("device", ""))
            return await remote.listdir(device, self.get_argument("path", "/home"))
        await self.respond_device_file_op(work())


class DeviceFileDeleteHandler(DeviceFilesRequestHandler):
    async def post(self):
        async def work():
            data = self.device_request_json()
            device = await self.resolve_device_access(data.get("device"))
            paths = [remote.check_path(p) for p in (data.get("paths") or [])][:500]
            await remote.delete(device, paths)
            shown = ", ".join(paths[:5]) + (f" … (+{len(paths) - 5})" if len(paths) > 5 else "")
            await asyncio.to_thread(_record, device, self.user, f"silindi: {shown}")
            return {"ok": True}
        await self.respond_device_file_op(work())


class DeviceFileRenameHandler(DeviceFilesRequestHandler):
    async def post(self):
        async def work():
            data = self.device_request_json()
            device = await self.resolve_device_access(data.get("device"))
            path = remote.check_path(data.get("path", ""))
            target = await remote.rename(device, path, data.get("name", ""))
            await asyncio.to_thread(_record, device, self.user, f"ad değiştirildi: {path} → {target}")
            return {"ok": True, "path": target}
        await self.respond_device_file_op(work())


class DeviceDirCreateHandler(DeviceFilesRequestHandler):
    async def post(self):
        async def work():
            data = self.device_request_json()
            device = await self.resolve_device_access(data.get("device"))
            target = await remote.mkdir(device, data.get("path", ""), data.get("name", ""))
            await asyncio.to_thread(_record, device, self.user, f"klasör oluşturuldu: {target}")
            return {"ok": True, "path": target}
        await self.respond_device_file_op(work())


class DeviceFileCopyHandler(DeviceFilesRequestHandler):
    async def post(self):
        async def work():
            data = self.device_request_json()
            src = await self.resolve_device_access(data.get("src_device"))
            dst = await self.resolve_device_access(data.get("dst_device"))
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
        await self.respond_device_file_op(work())


class CopyStatusHandler(DeviceFilesRequestHandler):
    def get(self, job_id: str):
        job = copy.jobs.get(int(job_id))
        if not job:
            self.set_status(404)
            self.write({"error": "Kopyalama bulunamadı."})
            return
        self.write(copy.public(job))


class CopyCancelHandler(DeviceFilesRequestHandler):
    def post(self, job_id: str):
        self.write({"ok": copy.cancel(int(job_id))})


def _device_ids(data: dict) -> list[int]:
    ids = data.get("devices") or []
    if not isinstance(ids, list) or not ids or len(ids) > 2000:
        raise RemoteError("Cihaz seçilmedi.")
    try:
        return list(dict.fromkeys(int(i) for i in ids))
    except (TypeError, ValueError):
        raise RemoteError("Geçersiz cihaz.")


async def _accesses(ids: list[int]) -> list[dict]:
    return [await asyncio.to_thread(_access, i) for i in ids]


class BulkUsersHandler(DeviceFilesRequestHandler):
    async def post(self):
        async def work():
            devices = await _accesses(_device_ids(self.device_request_json()))
            sem = asyncio.Semaphore(bulk.parallel_limit())

            async def one(b):
                async with sem:
                    try:
                        return {"id": b["id"], "name": b["name"], "users": await asyncio.to_thread(bulk.device_users, b)}
                    except RemoteError as exc:
                        return {"id": b["id"], "name": b["name"], "error": str(exc)}
            return {"devices": await asyncio.gather(*(one(b) for b in devices)), "limit": bulk.parallel_limit()}
        await self.respond_device_file_op(work())


class BulkUploadHandler(DeviceFilesRequestHandler):
    async def post(self):
        async def work():
            try:
                total = int(self.device_request_json().get("total") or 0)
            except (TypeError, ValueError):
                total = 0
            return {"token": bulk.new_upload(self.user, total)}
        await self.respond_device_file_op(work())


@tornado.web.stream_request_body
class BulkUploadFileHandler(DeviceFilesRequestHandler):
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


@tornado.web.stream_request_body
class HomeRestoreUploadHandler(DeviceFilesRequestHandler):
    """ "Yedekle/Geri al" ▸ Geri al: yedek dosyası akışla diske iner, hesap bilgisi okunup özeti döner (gizli
    alanlar dönmez). Yetki nginx'te ("devices.restore", /home-restore-api/); iş sonra "restore_home" görevidir."""

    def prepare(self):
        super().prepare()
        self.request.connection.set_max_body_size(1 << 40)
        self.fh = None
        self.finished_upload = False
        self.error = None
        self.token = ""
        try:
            self.token, path = home_restore.new_upload(self.user, int(self.request.headers.get("Content-Length") or 0))
            self.fh = open(path, "wb", opener=lambda p, flags: os.open(p, flags, 0o600))
        except (home_restore.HomeRestoreRefused, OSError) as exc:
            self.error = str(exc)

    def data_received(self, chunk):
        if self.fh:
            self.fh.write(chunk)

    async def put(self):
        self.finished_upload = True
        if self.fh:
            self.fh.close()
        try:
            if self.error:
                raise home_restore.HomeRestoreRefused(self.error)
            self.write(await asyncio.to_thread(home_restore.upload_summary, self.token))
        except home_restore.HomeRestoreRefused as exc:
            home_restore.discard_upload(self.token)
            self.set_status(400)
            self.write({"error": str(exc)})

    def on_connection_close(self):
        if self.fh and not self.fh.closed:
            self.fh.close()
        if not self.finished_upload:
            home_restore.discard_upload(self.token)


def _bulk_record(owner: str):
    def done(job: dict) -> None:
        opts = job["options"]
        if opts.get("dry"):
            return   # önizleme: cihazda hiçbir şey değişmedi, kayda gerek yok
        for row in job["devices"]:
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


class BulkDistributeHandler(DeviceFilesRequestHandler):
    async def post(self):
        async def work():
            data = self.device_request_json()
            devices = await _accesses(_device_ids(data))
            users = bulk.check_selection(data.get("users"))
            location = bulk.check_location(data.get("location"))
            prepared = await asyncio.to_thread(bulk.prepare_distribute, self.user, str(data.get("token") or ""))
            return {"id": bulk.start_distribute(self.user, prepared, devices, users, location,
                                                data.get("conflict", "overwrite"), _bulk_record(self.user),
                                                relay=bool(data.get("relay", True)))}
        await self.respond_device_file_op(work())


class BulkCollectHandler(DeviceFilesRequestHandler):
    async def post(self):
        async def work():
            data = self.device_request_json()
            devices = await _accesses(_device_ids(data))
            users = bulk.check_selection(data.get("users"))
            location = bulk.check_location(data.get("location"))
            patterns = data.get("patterns") or []
            if not isinstance(patterns, list):
                raise RemoteError("Geçersiz desen.")
            excludes = data.get("excludes") or []
            if not isinstance(excludes, list):
                raise RemoteError("Geçersiz hariç tutma.")
            return {"id": bulk.start_collect(self.user, devices, users, location, patterns,
                                             bool(data.get("move")), _bulk_record(self.user), excludes=excludes,
                                             deep=bool(data.get("deep")), skip_hidden=bool(data.get("skip_hidden")),
                                             dry=bool(data.get("dry")))}
        await self.respond_device_file_op(work())


class BulkJobHandler(DeviceFilesRequestHandler):
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
    """İptal edilmiş dağıtmayı sürdürür (bitmemiş cihazlar; arşiv sunucuda)."""
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
    for b in job["devices"]:
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
        (r"/list", DeviceDirListHandler),
        (r"/delete", DeviceFileDeleteHandler),
        (r"/rename", DeviceFileRenameHandler),
        (r"/mkdir", DeviceDirCreateHandler),
        (r"/copy", DeviceFileCopyHandler),
        (r"/copy/(\d+)", CopyStatusHandler),
        (r"/copy/(\d+)/cancel", CopyCancelHandler),
        (r"/home-restore/upload", HomeRestoreUploadHandler),
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
