# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Windows (PowerShell — bkz. platforms/README.md): Linux run.sh ile aynı başlıklar.
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$up = (Get-Date) - $os.LastBootUpTime
"Bilgisayar adı : $env:COMPUTERNAME"
"İşletim sistemi: $($os.Caption) $($os.Version)"
"Çekirdek       : $($os.BuildNumber)"
"Model          : $($cs.Manufacturer) $($cs.Model)"
"BIOS           : $($bios.SMBIOSBIOSVersion)"
"Çalışma süresi : {0} gün {1} saat {2} dk" -f $up.Days, $up.Hours, $up.Minutes
""
"Bellek         : toplam {0:N1} GB, boş {1:N1} GB" -f ($os.TotalVisibleMemorySize / 1MB), ($os.FreePhysicalMemory / 1MB)
""
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  "Disk {0}  toplam {1:N1} GB, boş {2:N1} GB" -f $_.DeviceID, ($_.Size / 1GB), ($_.FreeSpace / 1GB)
}
""
"Saat dilimi    : $((Get-TimeZone).DisplayName)"
"Yerel saat     : $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")"
