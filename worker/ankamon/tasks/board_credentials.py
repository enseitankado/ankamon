# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Cihaza özel root parolalarını sshpass süzgecinin okuduğu dosyalara yazar (bkz. executor/board_password.py): /run açılışta boş gelir, cihazın adresi değişebilir."""

from ..executor import board_password


def run(conn) -> None:
    board_password.sync(conn)
