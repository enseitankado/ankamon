# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# TiHA'nın "Uzaktan uyandırma (Wake-on-LAN)" adımını (tiha/modules/m15_wake_on_lan.py, apply) uzaktan
# uygular — dosya içerikleri TiHA'nınkiyle BİREBİR aynıdır (TiHA özet sayfası da adımı "uygulanmış" görür):
#   1. ethtool paketi (yoksa) kurulur
#   2. /usr/local/sbin/tiha-wake-on-lan.sh  — her açılışta birincil arayüzde `ethtool -s <arayüz> wol g`
#   3. /etc/systemd/system/tiha-wake-on-lan.service — oneshot, network-online sonrası
#   4. daemon-reload + enable + hemen bir kez çalıştırma (WoL bayrağı şimdi de yazılsın)
#   5. doğrulama: arayüz, MAC, kartın desteklediği ve o anki Wake-on modu
# Kaynak: https://github.com/enseitankado/tiha (8919ee0, 2026-09-30). WoL bayrağı kalıcı değildir; servis onu
# her açılışta yeniden yazar. BIOS'taki "Wake on LAN" seçeneğine TiHA da bu işlem de dokunmaz.
set -eu
export DEBIAN_FRONTEND=noninteractive
SCRIPT=/usr/local/sbin/tiha-wake-on-lan.sh
UNIT=/etc/systemd/system/tiha-wake-on-lan.service

if dpkg-query -W -f='${Status}' ethtool 2>/dev/null | grep -q "install ok installed"; then
    echo "ethtool zaten kurulu."
else
    echo "ethtool kuruluyor…"
    apt-get install -y -q ethtool || { echo "HATA: ethtool kurulamadı (paket deposuna erişim gerekir)."; exit 1; }
fi

echo "Betik yazılıyor: $SCRIPT"
mkdir -p /usr/local/sbin
cat > "$SCRIPT" <<'TIHA_EOF'
#!/bin/bash
# TiHA — Her boot'ta ağ kartını Wake-on-LAN dinlemede tut.
# WoL ayarı kalıcı değildir; her boot'ta yeniden yazılması gerekir.
set -eu

TAG="tiha-wake-on-lan"
log() { logger -t "$TAG" -- "$*"; }

# 1) Birincil arayüzü default route'tan tespit et
iface="$(ip -o -4 route show to default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"

# 2) Yoksa ilk fiziksel arayüzü seç (device symlink'i olan)
if [ -z "${iface:-}" ]; then
    for candidate in /sys/class/net/*; do
        name="$(basename "$candidate")"
        [ "$name" = "lo" ] && continue
        [ -L "$candidate/device" ] || continue
        iface="$name"
        break
    done
fi

if [ -z "${iface:-}" ]; then
    log "Birincil arayüz tespit edilemedi; WoL ayarı atlandı."
    exit 0
fi

# 3) WoL modunu yaz (magic packet dinle)
if /usr/sbin/ethtool -s "$iface" wol g 2>/dev/null; then
    log "Arayüz $iface için WoL (magic packet) etkin."
else
    log "Arayüz $iface için WoL yazılamadı — kart desteklemiyor olabilir."
fi
TIHA_EOF
chmod 755 "$SCRIPT"

echo "Servis yazılıyor: $UNIT"
cat > "$UNIT" <<'TIHA_EOF'
[Unit]
Description=TiHA - Wake-on-LAN dinleme modunu her boot'ta yaz
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/tiha-wake-on-lan.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
TIHA_EOF

systemctl daemon-reload
systemctl enable tiha-wake-on-lan.service >/dev/null 2>&1 || { echo "HATA: servis etkinleştirilemedi."; exit 1; }
echo "Servis etkinleştirildi (her açılışta çalışır)."
# RemainAfterExit=yes: zaten "active" ise start yeniden çalıştırmaz — restart ile şimdi bir kez daha yazılır.
systemctl restart tiha-wake-on-lan.service || echo "Uyarı: servis şimdi çalıştırılamadı."

echo
echo "== Doğrulama"
iface=$(ip -o -4 route show to default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')
if [ -z "$iface" ]; then
    for c in /sys/class/net/*; do n=$(basename "$c"); [ "$n" = lo ] && continue; [ -L "$c/device" ] || continue; iface=$n; break; done
fi
if [ -z "$iface" ]; then
    echo "Birincil ağ arayüzü bulunamadı — WoL denetlenemedi."
    exit 1
fi
mac=$(cat "/sys/class/net/$iface/address" 2>/dev/null || echo "?")
info=$(/usr/sbin/ethtool "$iface" 2>/dev/null || true)
supports=$(echo "$info" | awk -F: 'tolower($1) ~ /supports wake-on/ {gsub(/[ \t]/, "", $2); print $2}')
current=$(echo "$info" | awk -F: 'tolower($1) ~ /^[ \t]*wake-on/ {gsub(/[ \t]/, "", $2); print $2}')
echo "Arayüz: $iface · MAC: $mac"
echo "Kartın desteklediği: ${supports:-bilinmiyor} · şu anki mod: ${current:-bilinmiyor}"
journalctl -u tiha-wake-on-lan.service -n 1 --no-pager -o cat 2>/dev/null | sed 's/^/Servis günlüğü: /' || true
case "$supports" in
    *g*) ;;
    "") echo "UYARI: kart WoL desteği bildirmiyor — bu tahta ağdan uyandırılamayabilir."; exit 1 ;;
    *) echo "UYARI: kart sihirli paketle (g) uyandırmayı desteklemiyor."; exit 1 ;;
esac
if [ "$current" = g ] || echo "$current" | grep -q g; then
    echo "Tamam: tahta sihirli paketle uyandırmaya hazır."
    echo "Not: BIOS'ta \"Wake on LAN\" açık, \"ErP\"/\"Deep Sleep\" kapalı olmalı; tahta düzgün kapatılmalıdır."
else
    echo "UYARI: Wake-on modu \"$current\" — sihirli paket (g) etkinleşmedi."
    exit 1
fi
