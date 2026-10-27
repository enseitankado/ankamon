# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# SSH oturumu temiz kapansın diye yeniden başlatma arka planda, kısa gecikmeyle tetiklenir.
nohup sh -c 'sleep 2; systemctl reboot' >/dev/null 2>&1 &
echo "Yeniden başlatma komutu verildi."
