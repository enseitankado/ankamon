# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

logger -p auth.notice -t ankamon "Deneme kaydı: $(hostname) $(date '+%F %T')"
echo "Deneme kaydı üretildi (auth.notice, etiket: ankamon)."
