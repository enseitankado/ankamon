# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Windows (PowerShell, OpenSSH üzerinden — bkz. platforms/README.md): SSH oturumu temiz kapansın diye 5 sn gecikmeyle.
shutdown.exe /r /t 5 /c "Ankamon: yeniden başlatma"
if ($LASTEXITCODE -eq 0) { Write-Output "Yeniden başlatma komutu verildi." }
