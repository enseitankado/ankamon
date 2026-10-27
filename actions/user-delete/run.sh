# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

set -u

# Kullanıcı adları API'de action.json "pattern" ile doğrulandı (küçük harf, rakam, _ . -); yine de burada
# tek tek denetlenir. Sıra: oturumu/süreçleri kapat → (tum ise) ev dizini dışındaki dosyalarını sil →
# hesabı sil (tum ise userdel -r: ev dizini + posta kutusu) → AccountsService/kilit ekranı artıkları.
ADLAR=$(printf '%s' "${KULLANICILAR:-}" | tr ',' ' ')
TUM=0
[ "${DOSYALAR:-tum}" = "tum" ] && TUM=1
[ -n "$(printf '%s' "$ADLAR" | tr -d ' ')" ] || { echo "Silinecek kullanıcı verilmedi." >&2; exit 2; }

silinen=0
atlanan=0
hata=0
for U in $ADLAR; do
    case "$U" in
        [a-z_]*) ;;
        *) echo "✗ $U: geçersiz kullanıcı adı"; hata=$((hata + 1)); continue ;;
    esac
    # Tahtanın yönetici hesabı korunur (API de reddeder — bkz. JobsApi::UNDELETABLE_USERS).
    case "$U" in
        etapadmin|root) echo "✗ $U: korunan hesap, silinmez"; hata=$((hata + 1)); continue ;;
    esac
    if ! uid=$(id -u -- "$U" 2>/dev/null); then
        echo "– $U: bu tahtada yok, atlandı"
        atlanan=$((atlanan + 1))
        continue
    fi
    if [ "$uid" -lt 1000 ] || [ "$uid" -ge 60000 ]; then
        echo "✗ $U: sistem hesabı (UID $uid), silinmez"
        hata=$((hata + 1))
        continue
    fi
    if ! getent passwd "$U" | grep -q "^$U:" || ! grep -q "^$U:" /etc/passwd; then
        echo "✗ $U: yerel hesap değil (/etc/passwd'de yok), silinmez"
        hata=$((hata + 1))
        continue
    fi
    home=$(getent passwd "$U" | cut -d: -f6)
    # Ev dizini yalnız kullanıcıya özgü, en az iki düzey derin bir yolsa silinir: "/" ya da sistem
    # dizini olan, başka bir hesapla paylaşılan ev dizinlerine dokunulmaz (dosyalar korunur).
    ev_guvenli=1
    case "$home" in
        /*/*) ;;
        *) ev_guvenli=0 ;;
    esac
    case "$home" in
        /bin*|/boot*|/dev*|/etc*|/lib*|/opt|/proc*|/root*|/run*|/sbin*|/srv|/sys*|/usr*|/var|/var/lib|/var/lib/*) ev_guvenli=0 ;;
    esac
    [ "$(getent passwd | awk -F: -v h="$home" '$6 == h' | wc -l)" -le 1 ] || ev_guvenli=0
    tum_bu=$TUM
    if [ "$TUM" = 1 ] && [ "$ev_guvenli" = 0 ]; then
        echo "  $U: ev dizini ($home) kullanıcıya özgü değil — dosyalara dokunulmadan yalnız hesap silinecek"
        tum_bu=0
    fi

    # Açık oturum ve süreçler: userdel çalışan süreci olan hesabı silmez.
    if loginctl list-users --no-legend 2>/dev/null | awk '{print $2}' | grep -qx "$U"; then
        echo "  $U: açık oturumu kapatılıyor"
        loginctl terminate-user "$U" 2>/dev/null || true
    fi
    for _ in 1 2 3 4 5; do
        pgrep -u "$uid" >/dev/null 2>&1 || break
        pkill -KILL -u "$uid" 2>/dev/null || true
        sleep 1
    done
    if pgrep -u "$uid" >/dev/null 2>&1; then
        echo "✗ $U: süreçleri sonlandırılamadı, silinmedi"
        hata=$((hata + 1))
        continue
    fi

    disari=0
    if [ "$tum_bu" = 1 ]; then
        # Ev dizini dışında kalan dosyalar (ortak alan, /tmp, /var/tmp …): kök dosya sisteminde ve ev
        # dizininin bulunduğu dosya sisteminde UID'ye ait her şey. Sanal sistemler (-xdev) gezilmez.
        for fs in $(printf '%s\n' / "$(df --output=target "$home" 2>/dev/null | tail -1)" /tmp /var/tmp /dev/shm | sort -u); do
            [ -d "$fs" ] || continue
            n=$(find "$fs" -xdev -depth -uid "$uid" ! -path "$home" ! -path "$home/*" -print -delete 2>/dev/null | wc -l)
            disari=$((disari + n))
        done
        userdel -r -- "$U" >/tmp/userdel.$$ 2>&1
        rc=$?
    else
        userdel -- "$U" >/tmp/userdel.$$ 2>&1
        rc=$?
    fi
    # userdel -r: posta kutusu yoksa 12 döner (hesap yine de silinir).
    if [ "$rc" -ne 0 ] && id -u -- "$U" >/dev/null 2>&1; then
        echo "✗ $U: silinemedi — $(tr '\n' ' ' </tmp/userdel.$$)"
        rm -f /tmp/userdel.$$
        hata=$((hata + 1))
        continue
    fi
    rm -f /tmp/userdel.$$
    rm -f "/var/lib/AccountsService/users/$U" "/var/lib/AccountsService/icons/$U"
    if [ "$tum_bu" = 1 ]; then
        [ -e "$home" ] && rm -rf -- "$home"
        echo "✓ $U silindi (ev dizini $home ve dışındaki $disari dosya/klasör dahil)"
    else
        echo "✓ $U silindi (dosyaları korundu: $home)"
    fi
    silinen=$((silinen + 1))
done

echo
echo "Özet: $silinen silindi, $atlanan bu tahtada yoktu, $hata silinemedi."
[ "$hata" -eq 0 ]
