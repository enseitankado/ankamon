# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

set -eu

if ! command -v nmcli >/dev/null 2>&1; then
    echo "nmcli bulunamadı (NetworkManager yok); Wi-Fi radyosu bu yolla kapatılamıyor." >&2
    exit 1
fi
if ! nmcli -t -f TYPE dev | grep -qx wifi; then
    echo "Bu tahtada kablosuz ağ kartı yok — yapılacak bir şey yok."
    exit 0
fi

# nmcli'nin İngilizce cihaz durumlarını Türkçe açıklamaya çevirir.
durum() {
    case "$1" in
        connected) echo "bir ağa bağlı" ;;
        connecting*) echo "bağlanmaya çalışıyor" ;;
        disconnected) echo "açık ama hiçbir ağa bağlı değil" ;;
        unavailable) echo "kapalı" ;;
        unmanaged) echo "NetworkManager tarafından yönetilmiyor" ;;
        *) echo "$1" ;;
    esac
}

# ETAP giriş ekranı (eta-lightdm: pardus-lightdm-greeter/module/etap.py) her açılışta ve her oturum
# kapanışında "nmcli radio wifi on" çalıştırır; NetworkManager'ın kaydettiği tercih bu yüzden tek
# başına kalıcı değildir. Paket dosyasına dokunmadan, yalnız lightdm kullanıcısının radyoyu
# açıp kapatma yetkisi polkit ile reddedilir (root ve oturum açan kullanıcı etkilenmez).
# "Wi-Fi'yi aç" bu kuralı kaldırır.
KURAL=/etc/polkit-1/rules.d/49-ankamon-wifi-off.rules
kural_kur() {
    mkdir -p "${KURAL%/*}"
    cat > "$KURAL.tmp" <<'RULE'
// Ankamon "Wi-Fi'yi kapat": giriş ekranının (lightdm) Wi-Fi'yi zorla yeniden açmasını engeller.
// "Wi-Fi'yi aç" bu dosyayı siler.
polkit.addRule(function(action, subject) {
    if (action.id == "org.freedesktop.NetworkManager.enable-disable-wifi" && subject.user == "lightdm") {
        return polkit.Result.NO;
    }
});
RULE
    chmod 644 "$KURAL.tmp"
    mv "$KURAL.tmp" "$KURAL"
}

if [ "$(nmcli radio wifi)" = "disabled" ]; then
    kural_kur
    echo "Wi-Fi zaten kapalıydı; giriş ekranının yeniden açmasını engelleyen kural kuruldu/yenilendi."
    exit 0
fi

nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev | awk -F: '$2 == "wifi"' |
while IFS=: read -r dev _ st con; do
    if [ "$st" = "connected" ]; then
        echo "Önceki durum: $dev kartı \"$con\" ağına bağlıydı — bu bağlantı kesilecek."
    else
        echo "Önceki durum: $dev kartı $(durum "$st")."
    fi
done

kural_kur
nmcli radio wifi off
sleep 1
if [ "$(nmcli radio wifi)" = "disabled" ]; then
    echo "Wi-Fi kapatıldı: kablosuz kart artık ağ taramıyor ve tahta yeniden başlasa da kapalı kalır."
    echo "Kablolu bağlantı (ve Ankamon erişimi) etkilenmedi. Geri açmak için \"Wi-Fi'yi aç\"."
else
    echo "Wi-Fi kapatılamadı: radyo hâlâ açık görünüyor." >&2
    exit 1
fi
