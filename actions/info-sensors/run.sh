if command -v sensors >/dev/null 2>&1; then
    sensors
else
    echo "lm-sensors kurulu değil (\"Metrik izlemeyi kur\" işlemi kurar)."
fi
if [ -x /usr/sbin/smartctl ]; then
    for disk in $(/usr/sbin/smartctl --scan | cut -d' ' -f1); do
        echo "== $disk"
        /usr/sbin/smartctl -H -A "$disk" | grep -Ei 'overall-health|result|Temperature|Reallocated|Power_On_Hours|Percentage Used|Wear' || true
    done
else
    echo "smartmontools kurulu değil."
fi
