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

"""Salt izleme akışının paylaşımı: tahta başına TEK VNC bağlantısı, Ankamon'da bütün izleyicilere çoğaltılır.

Eskiden her tarayıcı kutucuğu tahtada kendi x11vnc'sini ve kendi SSH tünelini açıyordu: 5 kullanıcı aynı tahtaya
bakınca tahtada 5 x11vnc ekranı ayrı ayrı yakalıyor, ağdan 5 kat görüntü geçiyordu. Şimdi salt izleme
(önizleme kutucukları, tek tahta izleme, sohbet) için (tahta, profil) başına tek bir "yayın" kurulur:

  tahta x11vnc (127.0.0.1, -once)  ←ssh -W→  yerel TCP ucu  ←  x11vnc -reflect (Ankamon'da, 127.0.0.1)
                                                                    ↑ izleyici başına bir TCP bağlantısı
                                                                    ↑ WebSocket köprüsü (bkz. __main__.py)

Çoğaltıcı x11vnc'nin kendi "-reflect" kipidir (tahtadakiyle aynı açık kaynak paket): tahtaya tek istemci
olarak bağlanır, gelen ekranı kendi çerçeve belleğinde tutar ve her izleyiciye ayrı ayrı (her birinin istediği
kodlamayla, yeni katılana tam kare) sunar — RFB'yi elle çoğaltmak yerine. Yalnız 127.0.0.1'i dinler ve
salt izlemedir (-viewonly). Müdahale (fare/klavye) bu yoldan geçmez: kullanıcının kendi özel bağlantısıdır.

Son izleyici ayrılınca yayın LINGER_SECONDS bekler (sekmeler arası hızlı gidip gelme yayını yeniden kurmasın),
sonra kapanır; tahtadaki x11vnc tünel kapanınca kendiliğinden biter. Yayın biterse (tahtada X yeniden başladı,
ağ koptu) izleyicilerin bağlantısı 4010 ile kapanır, tarayıcı hemen yeniden bağlanır ve yeni yayın kurulur.
"Tazele" (fresh — ör. ekran kilidi teyidi, bkz. screen/index.html refreshStream) yeni yayın kurar; hazır olunca
eskisindeki izleyiciler 4010 ile yenisine geçer.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re

log = logging.getLogger("ankamon.screen.shared")

LINGER_SECONDS = int(os.environ.get("SCREEN_SHARED_LINGER", "15"))
REFLECT_START_TIMEOUT = 20      # çoğaltıcının yerel portu açması için en uzun bekleme (sn)
CLOSE_FEED_ENDED = 4010         # tarayıcı hemen yeniden bağlanır (bkz. screen/index.html onClose)

_PORT = re.compile(rb"PORT=(\d+)")


class FeedRefused(Exception):
    """Yayın kurulamadı: WebSocket kapanış kodu ve kısa neden (bkz. __main__.ScreenSocket._close_reason)."""

    def __init__(self, code: int, reason: str):
        super().__init__(f"{code} {reason}")
        self.code = code
        self.reason = reason


class ScreenFeed:
    """(tahta, profil) başına tek yayın. start(): tahtada x11vnc + SSH tüneli + yerel çoğaltıcı."""

    def __init__(self, key: tuple[int, str], name: str):
        self.key = key
        self.name = name
        self.ready: asyncio.Future = asyncio.get_running_loop().create_future()
        self.port: int | None = None           # çoğaltıcının izleyicilere açık yerel portu
        self.viewers = 0
        self.started = 0.0
        self.ended = False
        self._server: asyncio.base_events.Server | None = None
        self._reflector: asyncio.subprocess.Process | None = None
        self._tunnels: set[asyncio.subprocess.Process] = set()
        self._linger: asyncio.TimerHandle | None = None
        self._writers: set[asyncio.StreamWriter] = set()

    async def start(self, upstream, wait_ms: int, dim: str | None, ssh_argv: list[str], env: dict) -> None:
        """upstream: tahtadaki x11vnc'nin portu. ssh_argv: `ssh -W 127.0.0.1:<port> hedef` komutu."""

        async def tunnel(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
            # Yerel uca yalnız çoğaltıcı bağlanır (tek bağlantı; tahtadaki x11vnc -once).
            proc = await asyncio.create_subprocess_exec(
                *ssh_argv, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL, env=env)
            self._tunnels.add(proc)

            async def down():
                while data := await proc.stdout.read(65536):
                    writer.write(data)
                    await writer.drain()

            async def up():
                while data := await reader.read(65536):
                    proc.stdin.write(data)
                    await proc.stdin.drain()

            try:
                await asyncio.wait([asyncio.ensure_future(down()), asyncio.ensure_future(up())],
                                   return_when=asyncio.FIRST_COMPLETED)
            except (ConnectionError, OSError):
                pass
            finally:
                if proc.returncode is None:
                    proc.kill()
                self._tunnels.discard(proc)
                writer.close()
                # Tahta tarafı bitti (X yeniden başladı, ağ koptu, x11vnc çıktı): çoğaltıcı bunu fark edip
                # kendiliğinden çıkmıyor (2026-11-05 denendi), son kareyi sonsuza dek sunardı — yayın burada biter.
                if not self.ended:
                    log.info("%s: tahta bağlantısı bitti, paylaşılan yayın kapanıyor (%s)", self.name, self.key[1])
                    asyncio.ensure_future(self.stop())

        self._server = await asyncio.start_server(tunnel, "127.0.0.1", 0)
        local = self._server.sockets[0].getsockname()[1]
        argv = ["x11vnc", "-reflect", f"127.0.0.1:{local}", "-localhost", "-shared", "-forever", "-viewonly",
                "-nopw", "-norc", "-nosel", "-nobell", "-q", "-wait", str(wait_ms), "-defer", str(wait_ms)]
        if dim:
            # Tarayıcı kutucuğun en-boy oranını ve gerçek çözünürlüğü masaüstü adından okur (bkz. remote.py).
            argv += ["-desktop", f"ankamon-{dim}"]
        self._reflector = await asyncio.create_subprocess_exec(
            *argv, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT, env={"PATH": env["PATH"], "HOME": "/tmp"})
        seen = b""
        try:
            async with asyncio.timeout(REFLECT_START_TIMEOUT):
                while not (m := _PORT.search(seen)):
                    line = await self._reflector.stdout.readline()
                    if not line:
                        break
                    seen += line
        except TimeoutError:
            m = None
        if not m:
            await self.stop()
            hint = seen.decode(errors="replace").strip().splitlines()[-1:] or ["reflect"]
            raise FeedRefused(4005, hint[0].encode("ascii", "replace").decode()[:100])
        self.port = int(m.group(1))
        self.started = asyncio.get_running_loop().time()
        asyncio.ensure_future(self._watch())
        log.info("%s: paylaşılan yayın açıldı (%s, yerel %d)", self.name, self.key[1], self.port)

    async def _watch(self):
        """Çoğaltıcının çıktısını boşaltır (dolup takılmasın); çıkınca yayın biter."""
        proc = self._reflector
        while await proc.stdout.read(65536):
            pass
        await proc.wait()
        if not self.ended:
            log.info("%s: paylaşılan yayın bitti (%s, %d izleyici)", self.name, self.key[1], self.viewers)
        await self.stop()

    def track(self, writer: asyncio.StreamWriter) -> None:
        self._writers.add(writer)

    def untrack(self, writer: asyncio.StreamWriter) -> None:
        self._writers.discard(writer)

    async def stop(self) -> None:
        if self.ended:
            return
        self.ended = True
        if self._linger:
            self._linger.cancel()
        if self._reflector and self._reflector.returncode is None:
            self._reflector.kill()
        for proc in list(self._tunnels):
            if proc.returncode is None:
                proc.kill()
        if self._server:
            self._server.close()
        for w in list(self._writers):   # izleyicilerin çoğaltıcıya bağlantısı: köprü 4010 ile kapatır
            w.close()
        _forget(self)


_feeds: dict[tuple[int, str], ScreenFeed] = {}


def _forget(feed: ScreenFeed) -> None:
    if _feeds.get(feed.key) is feed:
        del _feeds[feed.key]


def active_count() -> int:
    """Tahtaya açık (ya da açılmakta olan) paylaşılan yayın sayısı — eşzamanlı akış sınırına sayılır."""
    return len(_feeds)


async def join(board_id: int, profile: str, fresh: bool, name: str, opener) -> ScreenFeed:
    """Yayına izleyici olarak katılır (yoksa kurar). opener(feed): yayını başlatan eşyordam (bkz. __main__).

    Hata: FeedRefused. Dönen yayından ayrılırken leave() çağrılmalı.
    """
    key = (board_id, profile)
    feed = _feeds.get(key)
    old = None
    if feed is not None and fresh and feed.ready.done():
        old, feed = feed, None
    if feed is None or feed.ended:
        feed = ScreenFeed(key, name)
        _feeds[key] = feed

        async def run(f=feed):
            try:
                await opener(f)
            except FeedRefused as e:
                _forget(f)
                f.ended = True
                f.ready.set_exception(e)
            except Exception as e:  # noqa: BLE001 — beklenmeyen hata da bekleyenleri bırakmasın
                log.exception("%s: paylaşılan yayın kurulamadı", name)
                await f.stop()
                f.ready.set_exception(FeedRefused(4005, type(e).__name__))
            else:
                f.ready.set_result(True)
                if old is not None:
                    await old.stop()   # tazelendi: eskisindeki izleyiciler 4010 ile yenisine geçer

        asyncio.ensure_future(run())
    await asyncio.shield(feed.ready)
    feed.viewers += 1
    if feed._linger:
        feed._linger.cancel()
        feed._linger = None
    return feed


def leave(feed: ScreenFeed) -> None:
    feed.viewers -= 1
    if feed.viewers <= 0 and not feed.ended:
        loop = asyncio.get_running_loop()
        feed._linger = loop.call_later(LINGER_SECONDS, lambda: asyncio.ensure_future(_expire(feed)))


async def _expire(feed: ScreenFeed) -> None:
    if feed.viewers <= 0:
        log.info("%s: paylaşılan yayın kapatıldı (izleyici kalmadı, %s)", feed.name, feed.key[1])
        await feed.stop()
