#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Bağlantı izleyici (bkz. worker/ankamon/connwatch.py): SSH etkinliği penceresi açıkken Ankamon süreçlerinin açık TCP
# bağlantılarını ve bağlantı başına anlık trafiği ss ile örnekler. Pencere kapalıyken örnek almaz. Başka süreçlerin
# soketlerini (ss -p) görmek için root çalışır.
set -eu
export PYTHONUNBUFFERED=1
cd /opt/ankamon/worker
exec nice -n 10 python3 -m ankamon.connwatch
