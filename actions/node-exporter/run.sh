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

systemctl enable prometheus-node-exporter >/dev/null 2>&1
systemctl restart prometheus-node-exporter
systemctl is-active --quiet prometheus-node-exporter
echo "node_exporter :$PORT portunda çalışıyor."
