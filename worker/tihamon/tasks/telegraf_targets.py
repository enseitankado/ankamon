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
    content = "# tiha-mon worker tarafından üretilir; elle düzenlemeyin.\n" + "".join(
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
