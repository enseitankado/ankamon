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

"""FileBrowser yazma işlemlerinden sonra tahtadaki sahipliğin düzeltilmesi (bkz. ownership.py).

İki yol:
- Küçük gövdeli istekler (PATCH /api/resources: kopyala/taşı; PUT: düzenleyiciyle kaydet;
  POST /api/resources/archive|unarchive) nginx'ten bu köprüye gelir; köprü isteği olduğu gibi
  FileBrowser'a iletir, yanıtı dönmeden önce etkilenen yolları düzeltir.
- Yüklemeler (POST /api/resources — gövde GB'larca olabilir) köprüden GEÇMEZ, nginx'ten doğrudan akar;
  nginx biten her yüklemeyi bir satırla (durum, kaynak, yol) yerel bir syslog soketine (SOCKET) bildirir.

locate(fb_yolu) → (tahta id, tahtadaki yol, bu makinedeki bağlama yolu) ya da None.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import posixpath
import socket
import urllib.parse

import tornado.httpclient
import tornado.web

log = logging.getLogger("ankamon.filemanager.writes")

UPSTREAM = "http://127.0.0.1:8893"
SOURCE = "tahtalar"  # filemanager.sh'deki tek kaynak
SOCKET = "/run/ankamon/filemanager-writes.sock"

# İletilmeyen (köprünün/tornado'nun kendisinin yeniden yazdığı) başlıklar.
_HOP = {"content-length", "transfer-encoding", "connection", "keep-alive"}


class ResourcesProxy(tornado.web.RequestHandler):
    def initialize(self, locate, fixer):
        self._locate = locate
        self._fixer = fixer

    def check_xsrf_cookie(self):
        pass

    async def patch(self, *_):
        # Kopyala/taşı/ad değiştir: {items:[{fromSource, fromPath, toSource, toPath}], action, …}
        try:
            body = json.loads(self.request.body or b"{}")
        except ValueError:
            body = {}
        resp = await self._forward()
        action = body.get("action") if isinstance(body, dict) else None
        if action not in ("copy", "move") or resp.code >= 300:
            return self._reply(resp)
        try:
            done = (json.loads(resp.body or b"{}") or {}).get("succeeded") or []
        except ValueError:
            done = []
        targets: dict[int, list[str]] = {}
        for item in done if isinstance(done, list) else []:
            to = self._where(item.get("toSource") or item.get("fromSource"), item.get("toPath"))
            if not to:
                continue
            if action == "move":
                # Aynı tahtada taşıma yeniden adlandırmadır, sahiplik korunur; tahtalar arası taşıma
                # ise kopyala+sil (yeni dosyalar root olur).
                src = self._where(item.get("fromSource"), item.get("fromPath"))
                if src and src[0] == to[0]:
                    continue
            targets.setdefault(to[0], []).append(to[1])
        for board_id, paths in targets.items():
            await self._fixer.fix_now(board_id, paths)
        self._reply(resp)

    async def put(self, *_):
        # Düzenleyiciyle kaydet: dosya yeniden yazılınca root'a geçiyor — önceki sahibi geri verilir.
        where = self._where(self.get_query_argument("source", ""), self.get_query_argument("path", ""))
        before = None
        if where:
            try:
                before = await asyncio.to_thread(os.lstat, where[2])
            except OSError:
                pass
        resp = await self._forward()
        if where and resp.code < 300:
            if before is None:
                self._fixer.add(where[0], where[1])
            else:
                try:
                    await asyncio.to_thread(os.lchown, where[2], before.st_uid, before.st_gid)
                except OSError as e:
                    log.warning("sahip geri verilemedi (%s): %s", where[1], e)
        self._reply(resp)

    async def post(self, op=None):
        if op is None:  # yüklemeler köprüden geçmez (nginx); gelirse yalnız iletilir
            return self._reply(await self._forward())
        try:
            body = json.loads(self.request.body or b"{}")
        except ValueError:
            body = {}
        body = body if isinstance(body, dict) else {}
        to_source = body.get("toSource") or body.get("fromSource")
        dest = self._where(to_source, body.get("destination"))
        before = None
        if op == "unarchive" and dest:
            # Arşiv var olan bir klasöre açılabilir: yalnız yeni gelen girdiler düzeltilir.
            try:
                before = set(await asyncio.to_thread(os.listdir, dest[2]))
            except OSError:
                before = None
        resp = await self._forward()
        if dest and resp.code < 300:
            if op == "unarchive" and before is not None:
                try:
                    after = set(await asyncio.to_thread(os.listdir, dest[2]))
                except OSError:
                    after = set()
                paths = [posixpath.join(dest[1], n) for n in sorted(after - before)]
            else:
                paths = [dest[1]]
            await self._fixer.fix_now(dest[0], paths)
        self._reply(resp)

    def _where(self, source, fb_path):
        if source != SOURCE or not isinstance(fb_path, str) or not fb_path:
            return None
        return self._locate(fb_path)

    async def _forward(self) -> tornado.httpclient.HTTPResponse:
        headers = {k: v for k, v in self.request.headers.get_all() if k.lower() not in _HOP}
        req = tornado.httpclient.HTTPRequest(
            UPSTREAM + self.request.uri, method=self.request.method, headers=headers,
            body=self.request.body, allow_nonstandard_methods=True, follow_redirects=False,
            decompress_response=False, connect_timeout=10, request_timeout=86400,
        )
        try:
            return await tornado.httpclient.AsyncHTTPClient().fetch(req, raise_error=False)
        except Exception as e:  # bağlantı kurulamadı vb.
            return tornado.httpclient.HTTPResponse(req, 502, error=e, buffer=None)

    def _reply(self, resp) -> None:
        if resp.code == 599 or resp.error and not resp.headers:
            self.set_status(502)
            self.write({"message": "Dosya yöneticisine ulaşılamadı."})
            return
        self.set_status(resp.code, resp.reason)
        self.clear_header("Content-Type")
        for k, v in resp.headers.get_all():
            if k.lower() not in _HOP:
                self.add_header(k, v)
        if resp.body:
            self.write(resp.body)


class _UploadLog(asyncio.DatagramProtocol):
    """nginx access_log syslog satırı: '<pri>… fbwrite: <durum>\t<kaynak>\t<yol (URL kodlu)>'."""

    def __init__(self, locate, fixer):
        self._locate = locate
        self._fixer = fixer

    def datagram_received(self, data, addr):
        line = data.decode("utf-8", "replace")
        _, sep, rest = line.partition("fbwrite: ")
        fields = rest.strip().split("\t")
        if not sep or len(fields) != 3 or not fields[0].startswith("2") or fields[1] != SOURCE:
            return
        where = self._locate(urllib.parse.unquote(fields[2]))
        if where:
            self._fixer.add(where[0], where[1])


async def listen_uploads(locate, fixer) -> None:
    try:
        os.unlink(SOCKET)
    except FileNotFoundError:
        pass
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    sock.bind(SOCKET)
    os.chmod(SOCKET, 0o666)  # nginx işçileri "nginx" kullanıcısıyla yazar; soket yalnız konteyner içinde
    await asyncio.get_event_loop().create_datagram_endpoint(lambda: _UploadLog(locate, fixer), sock=sock)
