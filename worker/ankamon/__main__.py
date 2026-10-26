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
