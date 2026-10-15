echo "Bilgisayar adı : $(hostname)"
. /etc/os-release 2>/dev/null && echo "İşletim sistemi: ${PRETTY_NAME:-bilinmiyor}"
echo "Çekirdek       : $(uname -r)"
echo "Model          : $(cat /sys/class/dmi/id/sys_vendor 2>/dev/null) $(cat /sys/class/dmi/id/product_name 2>/dev/null)"
echo "BIOS           : $(cat /sys/class/dmi/id/bios_version 2>/dev/null)"
echo "Çalışma süresi : $(uptime -p 2>/dev/null)"
echo
free -h
echo
df -h -x tmpfs -x devtmpfs -x squashfs -x overlay
echo
timedatectl 2>/dev/null | grep -E 'Local time|Time zone|synchronized|NTP service' || true
