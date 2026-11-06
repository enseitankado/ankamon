# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

set -eu
export DEBIAN_FRONTEND=noninteractive
PORT="${PORT:-9100}"

apt-get update -q || echo "Uyarı: paket listesi güncellenemedi, mevcut listeyle deneniyor." >&2
# Önerilen paketler bilinçli olarak alınmaz: tahtaya sunucu donanımı yığını (ipmitool, openipmi) getirir.
apt-get install -y --no-install-recommends prometheus-node-exporter lm-sensors

DEFAULTS=/etc/default/prometheus-node-exporter
if grep -q '^ARGS=' "$DEFAULTS" 2>/dev/null; then
    sed -i "s|^ARGS=.*|ARGS=\"--web.listen-address=:$PORT\"|" "$DEFAULTS"
else
    echo "ARGS=\"--web.listen-address=:$PORT\"" >> "$DEFAULTS"
fi

yes '' | sensors-detect --auto >/dev/null 2>&1 || true
systemctl restart systemd-modules-load.service lm-sensors.service 2>/dev/null || true

# Fan/pil/anakart sensörleri: anakarttaki donanım izleme yongasının (Super I/O: ITE it87, Nuvoton
# nct6775, Fintek f71882fg) çekirdek sürücüsü yüklenir ve açılışta kendiliğinden yüklenmesi sağlanır
# (/etc/modules-load.d/ankamon-sensors.conf). node_exporter yeniden başlamadan ÖNCE yapılır ki fan devri,
# CMOS pil gerilimi ve anakart sıcaklığı ilk okumadan itibaren sunulsun. Yonga desteklenmiyorsa hiçbir
# şey kalıcı yazılmaz; bu adımın başarısızlığı kurulumu bozmaz. Çıktıdaki "[Super I/O]" satırı
# MetricsApi::coverage'ın "bu tahtada denendi" işaretidir — metni değiştirirken orayı da güncelleyin.
SUPERIO_CONF=/etc/modules-load.d/ankamon-sensors.conf
superio_hwmon() {  # $1 = hwmon adı öneki → bulunan ilk hwmon adı
    for h in /sys/class/hwmon/hwmon*; do
        n=$(cat "$h/name" 2>/dev/null) || continue
        case "$n" in "$1"*) echo "$n"; return 0 ;; esac
    done
    return 1
}
superio_found=""
# Sürücü → hwmon "name" öneki. Desteklemeyen sürücü yüklenmez (ENODEV).
for pair in it87:it87 nct6775:nct67 f71882fg:f71; do
    mod=${pair%%:*}; prefix=${pair#*:}
    if chip=$(superio_hwmon "$prefix"); then
        echo "$mod zaten yüklü ($chip)."
        superio_found="$superio_found $mod"
        continue
    fi
    modinfo "$mod" >/dev/null 2>&1 || continue
    if modprobe "$mod" 2>/dev/null && sleep 1 && chip=$(superio_hwmon "$prefix"); then
        echo "$mod yüklendi: $chip yongası bulundu."
        superio_found="$superio_found $mod"
    else
        # Yükleme başarılı olsa bile yonga yoksa modül boşuna kalmasın.
        modprobe -r "$mod" 2>/dev/null || true
    fi
done
if [ -n "$superio_found" ]; then
    {
        echo "# Ankamon \"Metrik izlemeyi kur\": anakart donanım izleme yongası (fan/pil/anakart sensörleri) sürücüsü."
        for mod in $superio_found; do echo "$mod"; done
    } > "$SUPERIO_CONF.tmp"
    chmod 644 "$SUPERIO_CONF.tmp"
    mv "$SUPERIO_CONF.tmp" "$SUPERIO_CONF"
    echo "[Super I/O] fan/pil/anakart sensörleri etkin:$superio_found (açılışta yüklenir: $SUPERIO_CONF)."
else
    echo "[Super I/O] desteklenen anakart sensör yongası bulunamadı; fan devri, CMOS pili ve anakart sıcaklığı bu tahtada okunamaz."
fi

systemctl enable prometheus-node-exporter >/dev/null 2>&1
systemctl restart prometheus-node-exporter
systemctl is-active --quiet prometheus-node-exporter
echo "node_exporter :$PORT portunda çalışıyor."

if [ -n "$superio_found" ] && command -v sensors >/dev/null 2>&1; then
    echo
    sensors 2>/dev/null | grep -E '^(it87|nct|f71)|fan[0-9]|Vbat|temp[0-9]' || true
fi
