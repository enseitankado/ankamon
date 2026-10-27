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

"""Telegraf için tahta başına okuma hedeflerini üretir.

Dosya yalnız içerik değiştiyse, geçici dosya + yeniden adlandırma ile yazılır (yarım dosya okunmaz);
Telegraf --watch-config ile değişikliği görüp kendini yeniden yükler.
"""

import logging
import os

from .. import config

log = logging.getLogger(__name__)

BLOCK = """
[[inputs.prometheus]]
  urls = ["http://{ip}:{port}/metrics"]
  metric_version = 1
  timeout = "10s"
  [inputs.prometheus.tags]
    board_id = "{id}"
"""


def run(conn) -> None:
    boards = conn.execute(
        """SELECT id, host(ip) AS ip, exporter_port AS port FROM boards
           WHERE monitor_enabled AND exporter_ok AND ip IS NOT NULL ORDER BY id"""
    ).fetchall()
    content = "# ankamon worker tarafından üretilir; elle düzenlemeyin.\n" + "".join(
        BLOCK.format(**board) for board in boards
    )

    path = config.TELEGRAF_TARGETS
    try:
        with open(path, encoding="utf-8") as current:
            if current.read() == content:
                return
    except FileNotFoundError:
        pass

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as out:
        out.write(content)
        out.flush()
        os.fsync(out.fileno())
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)
    log.info("Telegraf hedefleri güncellendi: %d tahta", len(boards))
