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

"""Görev döngüsü.

board_status (erişilebilirlik yoklaması), board_sessions (oturum açma/kapama) ve telegraf_targets
(Telegraf'ın tarama listesi) STATUS_TICK_SECONDS'ta bir çalışır — çevrimdışı tespiti, kullanıcı
oturumları VE bir tahtanın sensör kaydına başlaması "anında" yansısın diye (telegraf_targets ucuzdur:
içerik değişmediyse dosyaya dokunmaz, bkz. o dosya). Diğer görevler (tahta keşfi, MAC/kimlik) daha
ağır olduğundan TICK_SECONDS'ta bir araya girer. STATUS_TICK_SECONDS, TICK_SECONDS'ı tam bölmek
zorunda değildir — diğer görevler yalnızca üzerinden TICK_SECONDS kadar zaman geçtiğinde çalışır,
bir sonraki fırsatta değil.
"""

import logging
import time

from . import config, db
from .tasks import TASKS, board_sessions, board_status, session_probe, telegraf_targets

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ankamon")

# session_probe kendi içinde INTERVAL_SECONDS'ta (30 sn) bir çalışır — bkz. tasks/session_probe.py.
_FAST_TASKS = [board_status, board_sessions, session_probe, telegraf_targets]
_OTHER_TASKS = [task for task in TASKS if task not in _FAST_TASKS]


def _run_tasks(conn, tasks) -> None:
    for task in tasks:
        try:
            task.run(conn)
        except Exception:  # bir görevin hatası diğerlerini durdurmasın
            log.exception("görev başarısız: %s", task.__name__)


def main() -> None:
    log.info(
        "worker başladı (hızlı %d görev %d sn, diğer %d görev %d sn aralık)",
        len(_FAST_TASKS), config.STATUS_TICK_SECONDS, len(_OTHER_TASKS), config.TICK_SECONDS,
    )
    next_tick = 0.0
    while True:
        now = time.monotonic()
        try:
            with db.connect() as conn:
                _run_tasks(conn, _FAST_TASKS)
                if now >= next_tick:
                    _run_tasks(conn, _OTHER_TASKS)
                    next_tick = now + config.TICK_SECONDS
        except Exception:
            log.exception("veritabanına bağlanılamadı")
        time.sleep(config.STATUS_TICK_SECONDS)


if __name__ == "__main__":
    main()
