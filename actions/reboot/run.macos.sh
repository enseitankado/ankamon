# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# macOS (bash, SSH üzerinden — bkz. platforms/README.md): SSH oturumu temiz kapansın diye arka planda, kısa gecikmeyle.
nohup sh -c 'sleep 2; shutdown -r now' >/dev/null 2>&1 &
echo "Yeniden başlatma komutu verildi."
