# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

set -eu

CONF=/etc/modules-load.d/ankamon-sensors.conf
# Sürücü → hwmon "name" öneki. Sıra önemli değil: desteklemeyen sürücü yüklenmez (ENODEV).
MODULES="it87:it87 nct6775:nct67 f71882fg:f71"

hwmon_of() {  # $1 = hwmon adı öneki → bulunan ilk hwmon adı
    for h in /sys/class/hwmon/hwmon*; do
        n=$(cat "$h/name" 2>/dev/null) || continue
        case "$n" in "$1"*) echo "$n"; return 0 ;; esac
    done
    return 1
}

found=""
for pair in $MODULES; do
    mod=${pair%%:*}; prefix=${pair#*:}
    if chip=$(hwmon_of "$prefix"); then
        echo "$mod zaten yüklü ($chip)."
        found="$found $mod"
        continue
    fi
    modinfo "$mod" >/dev/null 2>&1 || continue
    if modprobe "$mod" 2>/dev/null && sleep 1 && chip=$(hwmon_of "$prefix"); then
        echo "$mod yüklendi: $chip yongası bulundu."
        found="$found $mod"
    else
        # Yükleme başarılı olsa bile yonga yoksa modül boşuna kalmasın.
        modprobe -r "$mod" 2>/dev/null || true
    fi
done

if [ -z "$found" ]; then
    echo "Desteklenen bir Super I/O sensör yongası bulunamadı; tahtada değişiklik yapılmadı."
    exit 0
fi

{
    echo "# Ankamon \"Fan/pil/anakart sensörlerini etkinleştir\": donanım izleme yongası sürücüsü."
    for mod in $found; do echo "$mod"; done
} > "$CONF.tmp"
chmod 644 "$CONF.tmp"
mv "$CONF.tmp" "$CONF"
echo "Açılışta yüklenecek: $CONF"

if command -v sensors >/dev/null 2>&1; then
    echo
    sensors 2>/dev/null | grep -E '^(it87|nct|f71)|fan[0-9]|Vbat|temp[0-9]' || true
fi
