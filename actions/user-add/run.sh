# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

set -u

# ETAP'ın hesap açma adımlarının aynısı — kaynak (tahtada): /usr/share/eta/eta-usb-login/user.py create_user,
# /usr/share/eta/eta-qr-login/service.py gen_username ve user_create_login (expire-uid). Fark: parola özeti
# useradd -p ile komut satırına yazılmaz (ps'te görünür), hesap açıldıktan sonra stdin'den "chpasswd -e" ile
# verilir — düz chpasswd ETAP'ın PAM zincirinde reddedilir (bkz. actions/user-password). GECOS'un ",,,,"
# sonrasındaki alanda ETAP EBA kimliğinin özetini tutar (TiHA branş hesapları "tiha-brans"); burada "ankamon".
# Parola yalnız ortam değişkeninde gelir, hiçbir yere yazdırılmaz.
LC_ALL=C.UTF-8
export LC_ALL

AD=${TAM_AD:-}
U=${KULLANICI:-}
ETAP_GRUPLARI="cdrom floppy audio video plugdev bluetooth scanner netdev dip lpadmin"
SIFIRLAMA_SERVISI=tiha-boot-password-wipe.service
SIFIRLAMA_KAPALI=/etc/tiha/boot-wipe.disabled

case "$AD" in
    ''|*:*|*,*) echo "Tam ad boş olamaz; iki nokta ve virgül içeremez." >&2; exit 2 ;;
esac
[ -n "${PAROLA:-}" ] || { echo "Parola verilmedi." >&2; exit 2; }

# Açılışta parola sıfırlama servisi etkinse parola bir sonraki açılışta geçersiz kalır. Servis etkin olsa da
# son açılışta chpasswd hatası vermişse (ETAP'ın PAM zinciri düz chpasswd'yi reddeder) bu da söylenir.
sifirlama_uyarisi() {
    case "$(systemctl is-enabled "$SIFIRLAMA_SERVISI" 2>/dev/null)" in
        enabled|enabled-runtime) ;;
        *) return 0 ;;
    esac
    [ ! -e "$SIFIRLAMA_KAPALI" ] || return 0
    echo
    echo "⚠ UYARI: Bu tahtada açılışta parola sıfırlama servisi ($SIFIRLAMA_SERVISI) etkin."
    echo "  Servis her açılışta etapadmin dışındaki hesapların parolasını rastgele bir değerle ezer: verilen"
    echo "  parola yalnız bir sonraki açılışa kadar geçerlidir, sonrasında giriş EBA-QR, PIN ya da USB ile yapılır."
    hatali=$(journalctl -b -t tiha-boot-wipe --no-pager -q 2>/dev/null | grep -c 'HATA')
    if [ "${hatali:-0}" -gt 0 ]; then
        echo "  Not: son açılışta servis $hatali kayıtta parola yazamadı (chpasswd hatası); sıfırlama şu an"
        echo "  etkisiz görünüyor, ama bu durum düzelirse parola sıfırlanır."
    fi
}

if [ -z "$U" ]; then
    # ETAP gen_username: İ→i, Türkçe harfler sadeleşir, küçük harf, boşluklar atılır, en çok 31 karakter.
    U=$(printf '%s' "$AD" | sed -e 's/İ/i/g; s/I/i/g; s/ı/i/g; s/[Çç]/c/g; s/[Ğğ]/g/g; s/[Öö]/o/g; s/[Şş]/s/g; s/[Üü]/u/g' \
        | tr 'A-Z' 'a-z' | tr -d ' ' | cut -c1-31)
fi
if ! printf '%s' "$U" | grep -Eq '^[a-z_][a-z0-9_-]{0,30}$'; then
    echo "Geçerli bir kullanıcı adı yok ('$U'): küçük harf, rakam, _ ve - içerebilir, rakamla başlayamaz. Kullanıcı adını elle yazın." >&2
    exit 2
fi

if id -u -- "$U" >/dev/null 2>&1; then
    echo "– $U: bu tahtada zaten var, dokunulmadı (parola değiştirilmedi)."
    sifirlama_uyarisi
    exit 0
fi

if command -v openssl >/dev/null 2>&1; then
    OZET=$(printf '%s\n' "$PAROLA" | openssl passwd -6 -stdin 2>/dev/null)
elif command -v mkpasswd >/dev/null 2>&1; then
    OZET=$(printf '%s\n' "$PAROLA" | mkpasswd -m sha-512 --stdin 2>/dev/null)
fi
case "${OZET:-}" in
    '$6$'*) ;;
    *) echo "Parola özetlenemedi (tahtada openssl ya da mkpasswd yok)." >&2; exit 3 ;;
esac

if ! out=$(useradd -s /bin/bash -c "$AD,,,,ankamon" -m -- "$U" 2>&1); then
    echo "✗ $U: hesap açılamadı — $(printf '%s' "$out" | tr '\n' ' ')" >&2
    exit 1
fi
# Yarım hesap kalmasın: parola yazılamazsa hesap ev diziniyle geri alınır.
if ! out=$(printf '%s:%s\n' "$U" "$OZET" | chpasswd -e 2>&1); then
    userdel -r -- "$U" >/dev/null 2>&1
    echo "✗ $U: parola yazılamadı, hesap geri alındı — $(printf '%s' "$out" | tr '\n' ' ')" >&2
    exit 1
fi
# ETAP gibi: gruplar tek tek; tahtada olmayan grup hesabı engellemez.
eksik=""
for G in $ETAP_GRUPLARI; do
    usermod -a -G "$G" -- "$U" >/dev/null 2>&1 || eksik="$eksik $G"
done

ilk_giris=""
if [ "${ILK_GIRIS:-evet}" = evet ]; then
    # ETAP'ın eta-password-changer'ı bu dosya varken oturum açılışında parola değiştirme penceresi açar.
    if [ -d /var/lib/eta/expire-uid ]; then
        printf '%s' "$U" > "/var/lib/eta/expire-uid/$(id -u -- "$U")"
        ilk_giris=" · ilk girişte parola değiştirme penceresi açılır"
    else
        ilk_giris=" · ilk girişte parola değiştirme bu tahtada yok (eta-password-changer)"
    fi
fi

# TiHA'nın /etc/passwd izleyicisi (tiha-auto-teacher-group) hesabı "ogretmenler" grubuna da ekler; kısa bekleyip gerçek durum yazılır.
sleep 2
echo "✓ $U: hesap açıldı — $AD$ilk_giris"
echo "  $(id -- "$U")"
[ -z "$eksik" ] || echo "  Tahtada olmayan gruplar atlandı:$eksik"
sifirlama_uyarisi
exit 0
