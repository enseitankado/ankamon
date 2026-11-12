# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""UYUMLULUK (terim geçişi 2026-11-12): eski modül adı — eklentiler "from ankamon.executor import board_password"
ile almaya devam edebilsin. Yeni kod ankamon.executor.device_password kullanır."""
import sys

from ankamon.executor import device_password

sys.modules[__name__] = device_password
