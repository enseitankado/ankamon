# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# "Kabuk komut kaydını aç"ın (actions/shell-command-log-on) kurduğu her şeyi kaldırır; /etc/bash.bashrc bayt bayt eski haline döner.
# Açık kabuklarda kanca işlevi kalır ama maske dosyasını bulamayınca hiçbir şey göndermez.
set -eu

DIZIN=/usr/local/lib/ankamon-shell-log
PROFIL=/etc/profile.d/zz-ankamon-shell-log.sh
BASHRC=/etc/bash.bashrc
BASLA='# >>> ankamon-shell-log >>>'
BASLA_SS='# >>> ankamon-shell-log (satir-sonu-eklendi) >>>'
BITIR='# <<< ankamon-shell-log <<<'

VARDI=0
if [ -f "$BASHRC" ]; then
    SAYI_B=$(grep -cxF -e "$BASLA" -e "$BASLA_SS" "$BASHRC" || :)
    SAYI_S=$(grep -cxF -e "$BITIR" "$BASHRC" || :)
    if [ "$SAYI_B" != 0 ] || [ "$SAYI_S" != 0 ]; then
        # Bozuk blokta sed dosyanın sonuna kadar silerdi: dokunma, bildir.
        if [ "$SAYI_B" != 1 ] || [ "$SAYI_S" != 1 ]; then
            echo "$BASHRC içindeki Ankamon bloğu bozuk (başlangıç $SAYI_B, bitiş $SAYI_S satır); dosyaya dokunulmadı, elle düzeltin." >&2
            exit 1
        fi
        YENI=$(mktemp "$BASHRC.ankamon.XXXXXX")
        cp -p "$BASHRC" "$YENI"
        sed -e "\\|^$BASLA\$|,\\|^$BITIR\$|d" -e "\\|^$BASLA_SS\$|,\\|^$BITIR\$|d" "$BASHRC" > "$YENI"
        # Özgün dosya satır sonuyla bitmiyordu: kurulumda eklenen satır sonu geri alınır.
        if grep -qxF -e "$BASLA_SS" "$BASHRC"; then
            truncate -s -1 "$YENI"
        fi
        sync "$YENI" 2>/dev/null || :
        mv -f "$YENI" "$BASHRC"
        VARDI=1
    fi
fi

[ -e "$PROFIL" ] && VARDI=1
[ -e "$DIZIN" ] && VARDI=1
rm -f "$PROFIL"
rm -rf "$DIZIN"

if [ "$VARDI" = 1 ]; then
    echo "Kabuk komut kaydı kapatıldı: kanca dosyaları silindi, /etc/bash.bashrc eski haline döndü. Açık kabuklar da artık komut göndermez."
    echo "Sunucuda daha önce biriken kayıtlar silinmedi (Oturumlar ▸ Hareketler, Loglar)."
else
    echo "Kabuk komut kaydı zaten kapalı."
fi
