#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Tahtaya özel SSH parolası: konteynerdeki bütün "sshpass -e ssh|sftp … kullanıcı@ip" çağrıları PATH'te önce buraya
# gelir. O adres için kayıt varsa (/run/ankamon/board-ssh/<ip>, worker executor/board_password.py yazar) parola onunla
# değişir; yoksa çağıranın verdiği genel parola (Ayarlar ▸ SSH erişimi) kalır. ANKAMON_SSHPASS_DIRECT=1: tam verilen
# parolayla bağlanılır (executor/board_password.py — parola doğrulama/değiştirme).
[ "${ANKAMON_SSHPASS_DIRECT:-0}" = 1 ] || for a in "$@"; do
    case "$a" in
        *[!a-zA-Z0-9_.@-]*) continue ;;
        *@*.*.*.*)
            f="/run/ankamon/board-ssh/${a#*@}"
            if [ -r "$f" ]; then
                SSHPASS=$(cat "$f")
                export SSHPASS
            fi
            break ;;
    esac
done

# SSH etkinlik kaydı (kullanıcı isteği 2026-11-10: alt çubuk ▸ SSH paneli — Ankamon'un dışarıya açtığı bütün SSH
# bağlantıları ve gönderdiği komutlar canlı). Her çağrı /run/ankamon/ssh-activity/log'a bir "start" JSON satırı yazar;
# exec'ten sonra PID aynı kaldığından ayrıntısız bir izleyici süreç bitince "end" satırını yazar (süre). Parola
# argv'de değil (sshpass -e → ortam); "-p parola" verilirse maskelenir. Okuyan: backend SshActivityApi.
# Kayıt hatası bağlantıyı asla engellemez (bütün hatalar yutulur). ANKAMON_SSHLOG=0 kaydı kapatır.
ankamon_sshlog() {
    D=/run/ankamon/ssh-activity
    L="$D/log"
    mkdir -p "$D" 2>/dev/null || return 0
    # ~3 MB'ı geçince bir kuşak saklanır (okuyan .1'i de izler).
    if [ -f "$L" ] && [ "$(wc -c < "$L" 2>/dev/null || echo 0)" -gt 3000000 ]; then
        mv -f "$L" "$L.1" 2>/dev/null
    fi
    tool="" target="" port="" tunnel="" opt="" cmd=""
    for a in "$@"; do
        # Değer bekleyen seçenek: sshpass'ın -p'si PAROLA (yazılmaz); ssh -p/-P port, -W tünel hedefi.
        if [ -n "$opt" ]; then
            case "$opt" in
                ssh-p|ssh-P) case "$a" in *[!0-9]*) ;; *) port=$a ;; esac ;;
                ssh-W) tunnel=$a ;;
            esac
            opt=""
            continue
        fi
        if [ -z "$tool" ]; then
            case "$a" in
                -p|-f|-d|-P) opt="pass$a" ;;
                -*) ;;
                *) tool=${a##*/} ;;
            esac
            continue
        fi
        if [ -z "$target" ]; then
            case "$a" in
                -W|-p|-P|-o|-i|-l|-F|-b|-c|-m|-J|-L|-R|-D|-E|-S|-O|-Q|-B|-e|-I) opt="ssh$a" ;;
                -*) ;;
                *) target=$a ;;
            esac
            continue
        fi
        cmd="$cmd${cmd:+ }$a"
    done
    [ -n "$target" ] || return 0
    # Çağıran servis: üst sürecin komut satırı ("python3 -m ankamon.screen" → screen, ansible …).
    src=$(tr '\0' ' ' < "/proc/$PPID/cmdline" 2>/dev/null | head -c 300)
    case "$src" in
        *"-m ankamon."*) src=${src#*-m ankamon.}; src=${src%% *} ;;
        *"-m ankamon"*) src=worker ;;
        *ansible*) src=ansible ;;
        *) src=${src%% *}; src=${src##*/} ;;
    esac
    now=$(date +%s)
    pid=$$
    # ANKAMON_SSHLOG_MASK: satır satır gizli değerler (runner — "password" türü eylem parametreleri) *** olur.
    j=$(printf '%s' "$cmd" | awk 'BEGIN { n = split(ENVIRON["ANKAMON_SSHLOG_MASK"], S, "\n") }
        { for (k = 1; k <= n; k++) { s = S[k]; if (s == "") continue
              while ((i = index($0, s)) > 0) $0 = substr($0, 1, i - 1) "***" substr($0, i + length(s)) }
          print }' | head -c 3000 | tr -d '\000-\010\013\014\016-\037' | sed 's/\\/\\\\/g' | awk 'BEGIN{ORS=""}
        { gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, ""); if (NR > 1) printf "\\n"; printf "%s", $0 }')
    esc() { printf '%s' "$1" | tr -d '"\\\000-\037' | head -c 200; }
    printf '{"ev":"start","ts":%s,"pid":%s,"src":"%s","tool":"%s","target":"%s","port":"%s","tunnel":"%s","cmd":"%s"}\n' \
        "$now" "$pid" "$(esc "$src")" "$(esc "$tool")" "$(esc "$target")" "$(esc "$port")" "$(esc "$tunnel")" "$j" \
        >> "$L" 2>/dev/null
    chmod 644 "$L" 2>/dev/null
    # Komut ÇIKTISI (kullanıcı isteği 2026-11-11: SSH etkinliği ▸ komut penceresinde sonuç): komutlu, tünelsiz ssh
    # çağrılarında stdout/stderr FIFO + tee ile çağırana AYNEN geçer, ilk 128 KB'ı out/<pid>-<ts>.out/.err'e yazılır.
    # Uzun/ikili akışlar yakalanmaz: ekran (VNC/ses/sohbet akışları), dosya işlemleri, dosya yöneticisi, web terminal.
    ANKAMON_CAP=""
    case "$src" in
        screen|files|filemanager|webssh) ;;
        *)
            if [ "$tool" = ssh ] && [ -z "$tunnel" ] && [ -n "$cmd" ] && mkdir -p "$D/out" 2>/dev/null; then
                b="$D/out/$pid-$now"
                rm -f "$b.o1" "$b.o2" "$b.e1" "$b.e2"
                mkfifo "$b.o1" "$b.o2" "$b.e1" "$b.e2" 2>/dev/null && ANKAMON_CAP=$b
            fi ;;
    esac
    b=$ANKAMON_CAP
    # İzleyici: çift fork (sshpass'ın çocuğu olmasın), standart akışlar kapalı (çağıran stdout'un EOF'unu beklerken
    # takılmasın). Süreç zombi kalırsa (çağıran henüz toplamadı) da bitmiş sayılır.
    (
        (
            while [ -d "/proc/$pid" ]; do
                st=$(cut -d' ' -f3 "/proc/$pid/stat" 2>/dev/null)
                [ "$st" = "Z" ] && break
                sleep 1
            done
            printf '{"ev":"end","ts":%s,"pid":%s,"start":%s}\n' "$(date +%s)" "$pid" "$now" >> "$L" 2>/dev/null
            if [ -n "$b" ]; then
                rm -f "$b.o1" "$b.o2" "$b.e1" "$b.e2"
                chmod 644 "$b.out" "$b.err" 2>/dev/null
                # Arada bir eski çıktılar budanır (en yeni 3000 çağrı kalır).
                if [ $((pid % 25)) = 0 ]; then
                    ls -1t "$D/out" 2>/dev/null | grep '\.out$' | tail -n +3001 | while read -r f; do
                        rm -f "$D/out/$f" "$D/out/${f%.out}.err"
                    done
                fi
            fi
        ) </dev/null >/dev/null 2>&1 &
    ) </dev/null >/dev/null 2>&1
}
ANKAMON_CAP=""
[ "${ANKAMON_SSHLOG:-1}" = 0 ] || ankamon_sshlog "$@" 2>/dev/null

if [ -n "$ANKAMON_CAP" ]; then
    b=$ANKAMON_CAP
    # Önce okuyucular (çift fork — sshpass'ın çocuğu olmasınlar): yakalayıcı ilk 128 KB'ı yazar, kalanı boşaltır
    # (akış hiç tıkanmaz); tee çağıranın stdout/stderr'ine aynen iletir. sshpass öldürülse de yazma ucu kapanınca
    # tee'ler EOF alıp çıkar (çağıran EOF'u eskisi gibi alır). PID ve diğer tanımlayıcılar (ansible -d fd) korunur.
    ( { head -c 131072 > "$b.out"; cat; } < "$b.o2" >/dev/null 2>&1 & )
    ( { head -c 131072 > "$b.err"; cat; } < "$b.e2" >/dev/null 2>&1 & )
    ( tee "$b.o2" < "$b.o1" 2>/dev/null & )
    ( tee "$b.e2" < "$b.e1" >&2 2>/dev/null & )
    exec /usr/bin/sshpass "$@" > "$b.o1" 2> "$b.e1"
fi
exec /usr/bin/sshpass "$@"
