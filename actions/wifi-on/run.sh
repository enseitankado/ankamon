set -eu

if ! command -v nmcli >/dev/null 2>&1; then
    echo "nmcli bulunamadı (NetworkManager yok); Wi-Fi radyosu bu yolla açılamıyor." >&2
    exit 1
fi
if ! nmcli -t -f TYPE dev | grep -qx wifi; then
    echo "Bu tahtada kablosuz ağ kartı yok — yapılacak bir şey yok."
    exit 0
fi

# Kablosuz kartların durumunu Türkçe yazar; bağlıysa bağlı olduğu ağın adını da.
rapor() {
    nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev | awk -F: '$2 == "wifi"' |
    while IFS=: read -r dev _ st con; do
        case "$st" in
            connected) echo "$dev kartı \"$con\" ağına bağlı." ;;
            connecting*) echo "$dev kartı bir ağa bağlanmaya çalışıyor…" ;;
            disconnected) echo "$dev kartı açık ama hiçbir ağa bağlı değil (kayıtlı bir kablosuz ağ yoksa ya da menzilde değilse bağlanmaz)." ;;
            unavailable) echo "$dev kartı henüz hazır değil." ;;
            *) echo "$dev kartı: $st" ;;
        esac
    done
}

# "Wi-Fi'yi kapat"ın kurduğu, giriş ekranının Wi-Fi'yi açmasını engelleyen polkit kuralı kaldırılır.
KURAL=/etc/polkit-1/rules.d/49-tiha-mon-wifi-off.rules
if [ -e "$KURAL" ]; then
    rm -f "$KURAL"
    echo "Wi-Fi'nin kapalı kalmasını sağlayan kural kaldırıldı."
fi

if [ "$(nmcli radio wifi)" = "enabled" ]; then
    echo "Wi-Fi zaten açıktı — bir değişiklik yapılmadı."
    rapor
    exit 0
fi

nmcli radio wifi on
# Kayıtlı bir ağ varsa NetworkManager birkaç saniye içinde bağlanır; en çok 10 sn beklenir.
for _ in $(seq 1 10); do
    nmcli -t -f TYPE,STATE dev | grep -q '^wifi:connected$' && break
    sleep 1
done
if [ "$(nmcli radio wifi)" = "enabled" ]; then
    echo "Wi-Fi açıldı."
    rapor
else
    echo "Wi-Fi açılamadı: radyo hâlâ kapalı görünüyor (kart donanım anahtarıyla kapatılmış olabilir)." >&2
    exit 1
fi
