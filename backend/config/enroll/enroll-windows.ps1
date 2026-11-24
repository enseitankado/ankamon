# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Ankamon'a katılım betiği (Windows) — Ankamon sunucusu üretir (backend Api/EnrollApi.php), süreli kodla verilir.
# Yaptıkları: OpenSSH sunucusunu (Windows özelliği) kurar ve açılışta başlar yapar; yerel __ANKAMON_SSH_USER__ hesabını
# (yoksa açar) Ankamon'un Cihaz erişimi parolasıyla Yöneticiler grubuna alır; güvenlik duvarında 22/tcp'yi açar; sonunda
# cihazı Ankamon'a bildirir. Kod geçerlilik sonu: __ANKAMON_EXPIRES__
$AnkamonUrl = '__ANKAMON_URL__'
$SshUser = '__ANKAMON_SSH_USER__'
$ErrorActionPreference = 'Stop'

function Step($t) { Write-Host "`n> $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  + $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  ! $t" -ForegroundColor Yellow }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host "Yonetici yetkisi gerekiyor; yonetici PowerShell penceresi aciliyor (onaylayin)..."
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -NoExit -Command `"irm $AnkamonUrl.ps1 | iex`""
  return
}

Write-Host "Ankamon'a katilim - $env:COMPUTERNAME"
try {
  Step "1/4 OpenSSH sunucusu"
  $cap = Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*' | Select-Object -First 1
  if ($cap -and $cap.State -ne 'Installed') { Add-WindowsCapability -Online -Name $cap.Name | Out-Null; Ok "kuruldu" } else { Ok "zaten kurulu" }
  Set-Service -Name sshd -StartupType Automatic
  Start-Service sshd
  Ok "sshd calisiyor, acilista baslar"

  Step "2/4 $SshUser hesabi"
  $pw = ConvertTo-SecureString ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__ANKAMON_PASSWORD_B64__'))) -AsPlainText -Force
  $u = Get-LocalUser -Name $SshUser -ErrorAction SilentlyContinue
  if ($u) { $u | Set-LocalUser -Password $pw -PasswordNeverExpires $true; Enable-LocalUser -Name $SshUser; Ok "parola ayarlandi" }
  else { New-LocalUser -Name $SshUser -Password $pw -PasswordNeverExpires -Description 'Ankamon yonetim hesabi' | Out-Null; Ok "hesap acildi" }
  $grp = (Get-LocalGroup -SID 'S-1-5-32-544').Name
  if (-not (Get-LocalGroupMember -Group $grp -Member $SshUser -ErrorAction SilentlyContinue)) { Add-LocalGroupMember -Group $grp -Member $SshUser }
  Ok "$grp grubunda"

  Step "3/4 Guvenlik duvari"
  if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
  } else { Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' }
  Ok "22/tcp acik"

  Step "4/4 Ankamon'a bildirim"
  $macs = (Get-NetAdapter -Physical | ForEach-Object {
    $k = if ($_.PhysicalMediaType -match '802\.11' -or $_.InterfaceDescription -match 'Wireless|Wi-?Fi|WLAN') { 'w' } else { 'e' }
    "$($_.Name -replace '[=,]', '_')=$($_.MacAddress -replace '-', ':')=$k"
  }) -join ','
  $os = (Get-CimInstance Win32_OperatingSystem).Caption
  $res = Invoke-RestMethod -Method Post -Uri "$AnkamonUrl/done" -Body @{ hostname = $env:COMPUTERNAME; os = $os; family = 'windows'; macs = $macs }
  Ok $res
  Write-Host "`nBitti. Ankamon bu bilgisayara artik SSH ile erisebilir." -ForegroundColor Green
} catch {
  Write-Host "`nHata: $($_.Exception.Message)" -ForegroundColor Red
}
