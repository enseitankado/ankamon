set -u

# Kullanıcı adları API'de action.json "pattern" ile doğrulandı; burada yine tek tek denetlenir. Parola
# yalnız ortam değişkeninde gelir (betik dosyasına gömülü, komut satırında görünmez) ve chpasswd'ye
# standart girdiden verilir; hiçbir yere yazdırılmaz. etapadmin/root için ayrı yetkiyi API denetler.
ADLAR=$(printf '%s' "${KULLANICILAR:-}" | tr ',' ' ')
[ -n "$(printf '%s' "$ADLAR" | tr -d ' ')" ] || { echo "Kullanıcı verilmedi." >&2; exit 2; }
[ -n "${PAROLA:-}" ] || { echo "Parola verilmedi." >&2; exit 2; }

ayarlanan=0
atlanan=0
hata=0
for U in $ADLAR; do
    case "$U" in
        [a-z_]*) ;;
        *) echo "✗ $U: geçersiz kullanıcı adı"; hata=$((hata + 1)); continue ;;
    esac
    if ! uid=$(id -u -- "$U" 2>/dev/null); then
        echo "– $U: bu tahtada yok, atlandı"
        atlanan=$((atlanan + 1))
        continue
    fi
    # Yönetici hesapları dışında sistem hesaplarına (UID < 1000, nobody) dokunulmaz.
    if [ "$U" != root ] && { [ "$uid" -lt 1000 ] || [ "$uid" -ge 60000 ]; }; then
        echo "✗ $U: sistem hesabı (UID $uid), değiştirilmez"
        hata=$((hata + 1))
        continue
    fi
    if ! awk -F: -v u="$U" '$1 == u { f = 1 } END { exit !f }' /etc/passwd; then
        echo "✗ $U: yerel hesap değil (/etc/passwd'de yok), değiştirilmez"
        hata=$((hata + 1))
        continue
    fi
    if out=$(printf '%s:%s\n' "$U" "$PAROLA" | chpasswd 2>&1); then
        echo "✓ $U: parola ayarlandı"
        ayarlanan=$((ayarlanan + 1))
    else
        echo "✗ $U: parola ayarlanamadı — $(printf '%s' "$out" | tr '\n' ' ')"
        hata=$((hata + 1))
    fi
done

echo
echo "Özet: $ayarlanan hesabın parolası ayarlandı, $atlanan bu tahtada yoktu, $hata ayarlanamadı."
[ "$hata" -eq 0 ]
