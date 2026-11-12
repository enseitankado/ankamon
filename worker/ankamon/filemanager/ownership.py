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

"""Dosya yöneticisinde (FileBrowser) yazılanların cihazdaki sahipliği.

Cihaz sshfs ile root olarak bağlı olduğundan FileBrowser'ın oluşturduğu her şey (kopya, yükleme, yeni
klasör, arşivden çıkarılanlar) cihazda root:root olur; öğretmen kendi klasörüne konan dosyayı
değiştiremez/silemez. Bilgisayarlar arasında kopyalamadaki (files/copy.py) kuralın aynısı uygulanır:
yeni öğe, içine konduğu klasörün sahibine verilir; klasör root'unsa (sistem dizinleri) root kalır.
Aradaki, işlemin kendisinin açtığı (root sahipli) ara klasörler de aynı sahibe geçer. İzinler
(700/600…) FileBrowser'da zaten korunuyor, onlara dokunulmaz.

Düzeltme cihazda tek bir SSH komutuyla yapılır (files/remote.py — ortak ControlMaster bağlantısı);
aynı cihaza kısa aralıkla gelen yollar (parçalı yüklemenin her parçası, çok dosyalı yükleme) DELAY
saniye bekletilip tek komutta toplanır.
"""

from __future__ import annotations

import asyncio
import logging
import os

from ..files.remote import CM_DIR, RemoteError, run

log = logging.getLogger("ankamon.filemanager.ownership")

DELAY = 1.5

# Argümanlar: cihazdaki mutlak yollar. Sahip, yolun en yakın root OLMAYAN (uid≠0) üst klasöründen
# alınır; arada kalan root sahipli ara klasörler (yükleme/kopyanın açtıkları) da ona geçer. "/"a dek
# hepsi root'sa (ör. /etc, /opt, /tmp) hiçbir şey değişmez. Bağlar izlenmez (-h; -R zaten -P).
_FIX = r"""
for p do
  case $p in /?*) ;; *) continue ;; esac
  [ -e "$p" ] || [ -L "$p" ] || continue
  d=${p%/*}; [ -n "$d" ] || d=/
  o=
  while :; do
    s=$(stat -c '%u:%g' -- "$d" 2>/dev/null) || break
    case $s in 0:*) ;; *) o=$s; break ;; esac
    [ "$d" = / ] && break
    d=${d%/*}; [ -n "$d" ] || d=/
  done
  [ -n "$o" ] || continue
  d=${p%/*}
  while [ "$(stat -c %u -- "$d" 2>/dev/null)" = 0 ]; do
    chown -h -- "$o" "$d"
    d=${d%/*}
  done
  chown -R -h -- "$o" "$p"
done
exit 0
"""


class Fixer:
    """Cihaz başına bekleyen yolları toplar, DELAY sonra tek SSH komutuyla düzeltir.
    access(device_id) → {ip, user, password} ya da None (eşzamansız)."""

    def __init__(self, access):
        self._access = access
        self._pending: dict[int, set[str]] = {}
        self._timers: dict[int, asyncio.TimerHandle] = {}
        os.makedirs(CM_DIR, exist_ok=True)

    def add(self, device_id: int, path: str) -> None:
        self._pending.setdefault(device_id, set()).add(path)
        timer = self._timers.pop(device_id, None)
        if timer:
            timer.cancel()
        loop = asyncio.get_event_loop()
        self._timers[device_id] = loop.call_later(DELAY, lambda: loop.create_task(self._flush(device_id)))

    async def fix_now(self, device_id: int, paths: list[str]) -> None:
        """Bekletmeden düzeltir (kopyala/taşı yanıtı dönmeden önce — liste yenilenince sahip doğru görünsün)."""
        if paths:
            await self._run(device_id, sorted(set(paths)))

    async def _flush(self, device_id: int) -> None:
        self._timers.pop(device_id, None)
        paths = sorted(self._pending.pop(device_id, set()))
        if paths:
            await self._run(device_id, paths)

    async def _run(self, device_id: int, paths: list[str]) -> None:
        try:
            access = await self._access(device_id)
            if not access:
                return
            await run(access, _FIX, *paths, timeout=600)
            log.info("cihaz #%s: %d yolun sahipliği düzeltildi", device_id, len(paths))
        except RemoteError as e:
            log.warning("cihaz #%s: sahiplik düzeltilemedi: %s", device_id, e)
        except Exception:
            log.exception("cihaz #%s: sahiplik düzeltilemedi", device_id)
