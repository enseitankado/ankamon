#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Veritabanı göçleri bitene dek bekler. Servis sarmalayıcıları başta bunu çağırır.
while [ ! -f /run/ankamon/db-ready ]; do
    sleep 1
done
