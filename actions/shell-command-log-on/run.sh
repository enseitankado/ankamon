# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Etkileşimli bash'in her komutunu syslog'a (local6.info, program "ankamon-shell") gönderen kancayı kurar.
# Sıradan terminal komutları başka türlü loga gitmez (bkz. db/migrations/028_local_command_log.sql). TiHA'nın log iletimi local0-7'yi
# merkezi sunucuya taşır; Ankamon bunları Oturumlar ▸ Hareketler'de "Komut" türünde gösterir.
# Kaldırma: actions/shell-command-log-off. Bloğun biçimi ikisinde aynı olmalı.
set -eu

DIZIN=/usr/local/lib/ankamon-shell-log
PROFIL=/etc/profile.d/zz-ankamon-shell-log.sh   # vte-2.91.sh'tan SONRA okunsun: eski bash'te vte PROMPT_COMMAND'ı üzerine yazar
BASHRC=/etc/bash.bashrc
BASLA='# >>> ankamon-shell-log >>>'
BASLA_SS='# >>> ankamon-shell-log (satir-sonu-eklendi) >>>'
BITIR='# <<< ankamon-shell-log <<<'

command -v logger >/dev/null 2>&1 || { echo "Tahtada logger yok; kayıt açılamadı." >&2; exit 1; }
command -v sed >/dev/null 2>&1 || { echo "Tahtada sed yok; kayıt açılamadı." >&2; exit 1; }

mkdir -p "$DIZIN"
GECICI=$(mktemp -d)
trap 'rm -rf "$GECICI"' EXIT

# Parola benzeri değerler loga gitmeden burada maskelenir. worker/ankamon/session_activity_rules.py SECRET_PATTERNS ile AYNI
# olmalı (worker/tests/test_session_activity_rules.py denetler).
cat > "$GECICI/mask.sed" <<'ANKAMON_MASK_EOF'
s~\b(echo|printf)[ \t]+[^|]*\|[ \t]*(sudo[ \t]+-S|(sudo([ \t]+-[a-z]+)*[ \t]+)?([^ \t|;&]*/)?(chpasswd|passwd|smbpasswd|sshpass))~\1 *** | \2~gI
s~(<<-?)[^|]*\|[ \t]*((sudo([ \t]+-[a-z]+)*[ \t]+)?([^ \t|;&]*/)?(chpasswd|passwd|smbpasswd)).*$~\1*** | \2~gI
s~\b(chpasswd|passwd|smbpasswd)[ \t]*<<.*$~\1 <<***~gI
s~\b(sudo[ \t]+-S[^<]*)<<<[ \t]*("[^"]*"|'[^']*'|[^ \t;&|,]+)~\1<<< ***~gI
s~\bsshpass(([ \t]+-[a-zA-Z]+)*)[ \t]+-p[ \t]*("[^"]*"|'[^']*'|[^ \t;&|,]+)~sshpass\1 -p ***~gI
s~--([a-z0-9_-]*(password|passwd|passphrase|pwd|pass|secret|token|api-?key))(=|[ \t]+)("[^"]*"|'[^']*'|[^ \t;&|,]+)~--\1\3***~gI
s~\b([a-z0-9_.-]*(password|passwd|passphrase|pass|parola|sifre|şifre|secret|token|api_?key)|[a-z0-9_.-]+pwd)=("[^"]*"|'[^']*'|[^ \t;&|,]+)~\1=***~gI
s~\b(mysql|mariadb|mysqldump|mariadb-dump|mysqladmin|7z|7za|7zr|rar|unrar)\b(.*[ \t])-p[^ \t;&|]+~\1\2-p***~gI
s~\b(zip|unzip)\b(.*[ \t])-p[ \t]*("[^"]*"|'[^']*'|[^ \t;&|,]+)~\1\2-P ***~gI
s~\b(useradd|usermod)\b(.*[ \t])-p[ \t]*("[^"]*"|'[^']*'|[^ \t;&|,]+)~\1\2-p ***~gI
s~\b(ssh-keygen)\b(.*[ \t])-n[ \t]+("[^"]*"|'[^']*'|[^ \t;&|,]+)~\1\2-N ***~gI
s~\b(ssh-keygen)\b(.*[ \t])-p[ \t]+("[^"]*"|'[^']*'|[^ \t;&|,]+)~\1\2-P ***~gI
s~\b(curl|wget)\b(.*[ \t])(-u|--user)(=|[ \t]*)([^ \t:;&|]+):("[^"]*"|'[^']*'|[^ \t;&|,]+)~\1\2\3\4\5:***~gI
s~(-U[ \t]*[^ \t%;&|+]+)%("[^"]*"|'[^']*'|[^ \t;&|,]+)~\1%***~gI
s~([a-z][a-z0-9+.-]*://[^/ \t:@]+):[^/ \t@]+@~\1:***@~gI
s~\bpass:("[^"]*"|'[^']*'|[^ \t;&|,]+)~pass:***~gI
s~\b(mkpasswd|htpasswd)\b.*$~\1 ***~gI
s~\b(openssl[ \t]+passwd)\b.*$~\1 ***~gI
ANKAMON_MASK_EOF

cat > "$GECICI/hook.bash" <<'ANKAMON_HOOK_EOF'
# Ankamon "Kabuk komut kaydını aç": etkileşimli bash'te her komut, parola benzeri değerleri maskelenerek syslog'a gider.
# Kaldırmak için Ankamon'da "Kabuk komut kaydını kapat". Betikler ve otomasyon (etkileşimsiz bash) kaydedilmez.
[ -n "${BASH_VERSION:-}" ] || return 0
case $- in *i*) ;; *) return 0 ;; esac

__ankamon_shell_send() {
    local line no cmd
    # Kanca kaldırıldıysa (ya da maske okunamıyorsa) açık kabuklar sessizce durur: maskesiz satır asla gönderilmez.
    [ -r /usr/local/lib/ankamon-shell-log/mask.sed ] || return 0
    line=$(HISTTIMEFORMAT= builtin history 1) || line=
    if [[ $line =~ ^[[:space:]]*([0-9]+)[*[:space:]]+(.*)$ ]]; then
        no=${BASH_REMATCH[1]} cmd=${BASH_REMATCH[2]}
    else
        no=0 cmd=
    fi
    # İlk istemde geçmişin son satırı önceki oturumundur; boş Enter'da numara değişmez: ikisi de gönderilmez.
    if [ -z "${__ankamon_shell_seen+x}" ]; then
        __ankamon_shell_seen=$no
        return 0
    fi
    [ "$no" != "$__ankamon_shell_seen" ] || return 0
    __ankamon_shell_seen=$no
    [ -n "$cmd" ] || return 0
    # Arka planda: yavaş/bozuk syslog istemi bekletmez, hiçbir çıktı ve iş bildirimi kabuğa düşmez.
    ( (
        PATH=/usr/bin:/bin
        cmd=${cmd//$'\n'/ }
        cmd=$(printf '%s' "$cmd" | LC_ALL=C sed -E -f /usr/local/lib/ankamon-shell-log/mask.sed) || exit 0
        [ -n "$cmd" ] || exit 0
        timeout 5 logger -p local6.info -t ankamon-shell -- \
            "${__ankamon_shell_user:-?} : TTY=${__ankamon_shell_tty:-?} ; PWD=$PWD ; COMMAND=${cmd:0:900}"
    ) </dev/null >/dev/null 2>&1 & )
}

__ankamon_shell_log() {
    local rc=$?
    __ankamon_shell_send 2>/dev/null || :
    return "$rc"
}

__ankamon_shell_user=$(id -un 2>/dev/null)
__ankamon_shell_tty=$(tty 2>/dev/null)
__ankamon_shell_tty=${__ankamon_shell_tty#/dev/}

# Var olan PROMPT_COMMAND korunur, biz başa geçeriz ($? önceki komutunki kalsın). bash >= 5.1: dizi — vte-2.91.sh diziye ekler, dizgeyi
# ezer; ~/.bashrc'nin PROMPT_COMMAND="history -a;$PROMPT_COMMAND" kalıbı da yalnız ilk öğeyi değiştirir, kanca yerinde kalır.
case " ${PROMPT_COMMAND[*]:-} " in
    *__ankamon_shell_log*) ;;
    *)
        {
            if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
                if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
                    PROMPT_COMMAND=(__ankamon_shell_log "${PROMPT_COMMAND[@]}")
                else
                    PROMPT_COMMAND=(__ankamon_shell_log ${PROMPT_COMMAND:+"$PROMPT_COMMAND"})
                fi
            else
                PROMPT_COMMAND="__ankamon_shell_log${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
            fi
        } 2>/dev/null || :
        ;;
esac
ANKAMON_HOOK_EOF

# Bozuk dosya kurulmaz: her kabuk açılışında okunur.
if ! bash -n "$GECICI/hook.bash" || [ "$(printf 'sshpass -p gizli ssh x' | LC_ALL=C sed -E -f "$GECICI/mask.sed")" != 'sshpass -p *** ssh x' ]; then
    echo "Kanca doğrulanamadı; tahtada hiçbir şey değişmedi." >&2
    exit 1
fi
chmod 644 "$GECICI/hook.bash" "$GECICI/mask.sed"
mv -f "$GECICI/mask.sed" "$DIZIN/mask.sed"
mv -f "$GECICI/hook.bash" "$DIZIN/hook.bash"

cat > "$GECICI/profile" <<ANKAMON_PROFILE_EOF
# Ankamon "Kabuk komut kaydını aç" (giriş kabukları). Kaldırmak için Ankamon'da "Kabuk komut kaydını kapat".
[ -n "\${BASH_VERSION:-}" ] && [ -r $DIZIN/hook.bash ] && . $DIZIN/hook.bash || :
ANKAMON_PROFILE_EOF
chmod 644 "$GECICI/profile"
mv -f "$GECICI/profile" "$PROFIL"

# /etc/bash.bashrc (giriş olmayan terminaller): dosya sonuna tek blok. Kapatma bloğu silince dosya bayt bayt eski haline döner;
# özgün dosya satır sonuyla bitmiyorsa işaret bunu saklar, kapatma eklenen satır sonunu da geri alır. Yerinde yazmak yerine
# kopya + rename: ani güç kesintisinde yarım dosya kalmaz.
if [ -f "$BASHRC" ]; then
    if ! grep -qE '^# >>> ankamon-shell-log( \(satir-sonu-eklendi\))? >>>$' "$BASHRC"; then
        YENI=$(mktemp "$BASHRC.ankamon.XXXXXX")
        cp -p "$BASHRC" "$YENI"
        if [ -n "$(tail -c1 "$BASHRC")" ]; then
            printf '\n%s\n' "$BASLA_SS" >> "$YENI"
        else
            printf '%s\n' "$BASLA" >> "$YENI"
        fi
        printf '[ -r %s/hook.bash ] && . %s/hook.bash\n%s\n' "$DIZIN" "$DIZIN" "$BITIR" >> "$YENI"
        if ! bash -n "$YENI"; then
            rm -f "$YENI"
            echo "$BASHRC doğrulanamadı; eklenmedi (giriş kabukları yine kaydedilir)." >&2
            exit 1
        fi
        sync "$YENI" 2>/dev/null || :
        mv -f "$YENI" "$BASHRC"
    fi
fi

echo "Kabuk komut kaydı açıldı. Yeni açılan etkileşimli bash kabuklarının komutları (parola benzeri değerler maskelenerek) Ankamon'a gönderilir;"
echo "şu an açık kabuklar kapsam dışıdır. Kapatmak için \"Kabuk komut kaydını kapat\"."
if ! grep -hsE '^[^#]*local6' /etc/rsyslog.d/*.conf >/dev/null && ! grep -hsE '^[^#]*local[*]' /etc/rsyslog.d/*.conf >/dev/null; then
    echo "UYARI: Bu tahtanın rsyslog ayarında local6 iletimi görünmüyor; komutlar sunucuya ulaşmayabilir (TiHA merkezi log ayarını ya da \"Log sunucusu\" işlemini denetleyin)."
fi
