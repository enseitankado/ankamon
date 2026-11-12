# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# macOS (bash — bkz. platforms/README.md): Linux run.sh ile aynı başlıklar.
echo "Bilgisayar adı : $(scutil --get ComputerName 2>/dev/null || hostname)"
echo "İşletim sistemi: $(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)"
echo "Çekirdek       : $(uname -r)"
echo "Model          : $(sysctl -n hw.model 2>/dev/null)"
echo "Çalışma süresi : $(uptime | sed -E "s/^.*up ([^,]*(, [^,]*user)?).*/\1/")"
echo
echo "Bellek         : $(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 )) GB"
echo
df -h -l
echo
echo "Saat dilimi    : $(readlink /etc/localtime 2>/dev/null | sed "s#.*/zoneinfo/##")"
echo "Yerel saat     : $(date "+%Y-%m-%d %H:%M:%S")"
