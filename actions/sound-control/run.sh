# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Ses kontrolü (kullanıcı isteği 2026-11-24; eski sound-mute / sound-unmute / sound-volume-down tek işlemde birleşti).
# ISLEM: mute | unmute | set | down | limit | unlimit; DUZEY: yüzde (set/limit) ya da puan (down), 0-100.
#
# Oturum açık kullanıcıların ses sunucuları (ETAP/Pardus: PipeWire'ın pulse soketi /run/user/<uid>/pulse/native). Root
# bunlara PULSE_SERVER ile bağlanır (bkz. worker executor/cast.py). Sistem kullanıcıları (uid < 1000, ör. giriş ekranının
# lightdm'i) atlanır. Kullanıcı oturumu yoksa ALSA ana kanalı (amixer, ses kartı başına Master) değiştirilir.
# Ekran güç tasarrufundayken (DPMS) HDMI çıkışı kaybolur, varsayılan sahte "auto_null" kalır: o oturum atlanır.
#
# Sınır (limit): /var/lib/ankamon-sound-limit/{limit,guard.sh,log} + /etc/systemd/system/ankamon-sound-limit.service.
# Bekçi her ses sunucusunu "pactl subscribe" ile dinler; bir çıkışın düzeyi sınırı aşınca o an sınıra çeker (kullanıcı
# ses simgesinden yükseltse de geri iner). Yeni oturumun soketi 3 sn içinde fark edilir. Oturum yoklaması
# (worker executor/soundstate.py) "limit" dosyasını okuyup Cihazlar ▸ Ses sütununda gösterir. unlimit hepsini siler.

set -u

SINIR_DIR=/var/lib/ankamon-sound-limit
SINIR_UNIT=ankamon-sound-limit.service

ses_pulse() {   # $1 pactl alt komutu (set-sink-mute / set-sink-volume), $2 değer
    tamam=0
    for p in /run/user/*/pulse/native; do
        [ -S "$p" ] || continue
        uid=${p#/run/user/}; uid=${uid%%/*}
        [ "$uid" -ge 1000 ] 2>/dev/null || continue
        command -v pactl >/dev/null 2>&1 || break
        ad=$(id -nu "$uid" 2>/dev/null || echo "$uid")
        s=$(PULSE_SERVER="unix:$p" timeout 5 pactl get-default-sink 2>/dev/null)
        case "$s" in ''|auto_null) echo "$ad: ses çıkışı yok (ekran kapalı olabilir) — atlandı."; continue ;; esac
        if PULSE_SERVER="unix:$p" timeout 5 pactl "$1" "$s" "$2" 2>/dev/null; then
            m=$(PULSE_SERVER="unix:$p" timeout 5 pactl get-sink-mute "$s" 2>/dev/null | awk '{print $2}')
            v=$(PULSE_SERVER="unix:$p" timeout 5 pactl get-sink-volume "$s" 2>/dev/null | grep -o '[0-9]*%' | head -n 1 | tr -d %)
            echo "$ad oturumu: ses düzeyi %${v:-?}$([ "$m" = yes ] && echo ' — sessiz (kapalı)')"
            tamam=1
        else
            echo "$ad oturumu: ses sunucusuna komut verilemedi." >&2
        fi
    done
    [ "$tamam" = 1 ]
}

ses_alsa() {    # amixer sset Master değerleri ($@), oturum yokken
    tamam=0
    command -v amixer >/dev/null 2>&1 || return 1
    for c in /proc/asound/card[0-9]*; do
        [ -d "$c" ] || continue
        n=${c##*card}
        if amixer -q -c "$n" sset Master "$@" 2>/dev/null; then
            echo "Ses kartı $n ($(cat "$c/id" 2>/dev/null)): ana kanal $(amixer -c "$n" sget Master 2>/dev/null | grep -o '\[[0-9]*%\]\|\[on\]\|\[off\]' | head -n 2 | tr -d '[]' | sed 's/^off$/kapalı/; s/^on$/açık/' | xargs)"
            tamam=1
        fi
    done
    [ "$tamam" = 1 ]
}

ses_degistir() { # $1 pactl alt komutu, $2 pactl değeri, $3… amixer değerleri
    pa_cmd=$1; pa_val=$2; shift 2
    ses_pulse "$pa_cmd" "$pa_val" || ses_alsa "$@" || { echo "Bu cihazda değiştirilebilecek ses çıkışı bulunamadı." >&2; exit 1; }
}

# Etkin sınır (yüzde) ya da boş.
sinir_oku() {
    systemctl is-enabled -q "$SINIR_UNIT" 2>/dev/null || return 0
    l=$(cat "$SINIR_DIR/limit" 2>/dev/null)
    case "$l" in ''|*[!0-9]*) ;; *) echo "$l" ;; esac
}

duzey_al() {    # DUZEY'i 0-100 arası tamsayı olarak verir; değilse çıkar
    d=${DUZEY:-}
    case "$d" in ''|*[!0-9]*) echo "Geçersiz düzey: '${d}' (0-100 arası sayı olmalı)." >&2; exit 2 ;; esac
    d=$((10#$d))
    [ "$d" -le 100 ] || { echo "Geçersiz düzey: $d (en çok 100)." >&2; exit 2; }
    echo "$d"
}

sinir_kur() {   # $1 yüzde
    command -v pactl >/dev/null 2>&1 || { echo "Cihazda pactl yok: ses sınırı uygulanamaz." >&2; exit 3; }
    command -v systemctl >/dev/null 2>&1 || { echo "Cihazda systemd yok: ses sınırı kalıcı kurulamaz." >&2; exit 3; }
    mkdir -p "$SINIR_DIR"
    chmod 755 "$SINIR_DIR"
    echo "$1" > "$SINIR_DIR/limit"
    cat > "$SINIR_DIR/guard.sh" <<'ANKAMON_EOF'
#!/bin/sh
# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later
# Ankamon ses sınırı bekçisi (actions/sound-control): ses sunucusu başına "pactl subscribe"; çıkış düzeyi sınırı aşınca
# sınıra çekilir. Sınır $D/limit'ten her seferinde okunur.
D=/var/lib/ankamon-sound-limit
mkdir -p "$D/run"
rm -f "$D/run/"*

sinir() {
    l=$(cat "$D/limit" 2>/dev/null)
    case "$l" in ''|*[!0-9]*) echo 100 ;; *) echo "$l" ;; esac
}

kirp() {    # $1 soket: bütün çıkışlarda (en yüksek kanal) düzey > sınır ise sınıra
    L=$(sinir)
    PULSE_SERVER="unix:$1" timeout 5 pactl list short sinks 2>/dev/null | while read -r _ ad _; do
        [ -n "$ad" ] || continue
        v=$(PULSE_SERVER="unix:$1" timeout 5 pactl get-sink-volume "$ad" 2>/dev/null | grep -o '[0-9]*%' | tr -d % | sort -n | tail -n 1)
        [ -n "$v" ] && [ "$v" -gt "$L" ] || continue
        PULSE_SERVER="unix:$1" timeout 5 pactl set-sink-volume "$ad" "$L%" 2>/dev/null \
            && echo "$(date '+%F %T') $1 $ad: %$v -> %$L"
    done
}

dinle() {   # $1 soket: önce kırp, sonra her çıkış/sunucu değişiminde yeniden
    kirp "$1"
    PULSE_SERVER="unix:$1" pactl subscribe 2>/dev/null | while read -r satir; do
        case "$satir" in *" on sink #"*|*" on server"*) kirp "$1" ;; esac
    done
}

while :; do
    for p in /run/user/*/pulse/native; do
        [ -S "$p" ] || continue
        uid=${p#/run/user/}; uid=${uid%%/*}
        pid=$(cat "$D/run/$uid" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            continue
        fi
        dinle "$p" &
        echo $! > "$D/run/$uid"
    done
    # Günlük büyümesin (kullanıcı sürgüyü oynattıkça satır yazılır).
    if [ "$({ wc -c < "$D/log"; } 2>/dev/null || echo 0)" -gt 200000 ]; then
        tail -n 500 "$D/log" > "$D/log.tmp" && cat "$D/log.tmp" > "$D/log"
        rm -f "$D/log.tmp"
    fi
    sleep 3
done
ANKAMON_EOF
    chmod 755 "$SINIR_DIR/guard.sh"
    cat > "/etc/systemd/system/$SINIR_UNIT" <<ANKAMON_EOF
[Unit]
Description=Ankamon ses sınırı bekçisi (en yüksek ses düzeyi)

[Service]
ExecStart=/bin/sh $SINIR_DIR/guard.sh
Restart=always
RestartSec=2
Nice=10
StandardOutput=append:$SINIR_DIR/log
StandardError=append:$SINIR_DIR/log

[Install]
WantedBy=multi-user.target
ANKAMON_EOF
    eski=$({ wc -l < "$SINIR_DIR/log"; } 2>/dev/null || echo 0)
    systemctl daemon-reload
    systemctl enable "$SINIR_UNIT" >/dev/null 2>&1
    systemctl restart "$SINIR_UNIT"
    sleep 2
    systemctl is-active -q "$SINIR_UNIT" || { echo "Ses sınırı bekçisi başlatılamadı:" >&2; tail -n 5 "$SINIR_DIR/log" >&2; exit 4; }
    echo "Ses sınırı %$1 olarak kuruldu: kullanıcı sesi bunun üstüne çıkaramaz (yeniden başlatmada da sürer)."
    tail -n +"$((eski + 1))" "$SINIR_DIR/log" 2>/dev/null | grep -- '->' | tail -n 6 | sed 's/^[^ ]* [^ ]* /  sınıra çekildi: /'
}

sinir_kaldir() {
    if [ ! -e "/etc/systemd/system/$SINIR_UNIT" ] && [ ! -d "$SINIR_DIR" ]; then
        echo "Bu cihazda ses sınırı yok."
        return 0
    fi
    systemctl disable --now "$SINIR_UNIT" >/dev/null 2>&1
    rm -f "/etc/systemd/system/$SINIR_UNIT"
    systemctl daemon-reload
    rm -rf "$SINIR_DIR"
    echo "Ses sınırı kaldırıldı: kullanıcı sesi istediği düzeye çıkarabilir (düzey değiştirilmedi)."
}

case "${ISLEM:-}" in
    mute)   ses_degistir set-sink-mute 1 mute ;;
    unmute) ses_degistir set-sink-mute 0 unmute ;;
    set)
        n=$(duzey_al) || exit 2
        L=$(sinir_oku)
        if [ -n "$L" ] && [ "$n" -gt "$L" ]; then
            echo "Ses sınırı %$L: düzey %$n yerine %$L yapıldı."
            n=$L
        fi
        ses_degistir set-sink-volume "$n%" "$n%" ;;
    down)
        n=$(duzey_al) || exit 2
        ses_degistir set-sink-volume "-$n%" "$n%-" ;;
    limit)
        n=$(duzey_al) || exit 2
        sinir_kur "$n" ;;
    unlimit) sinir_kaldir ;;
    *) echo "Geçersiz işlem: '${ISLEM:-}' (mute, unmute, set, down, limit, unlimit)." >&2; exit 2 ;;
esac

L=$(sinir_oku)
[ -n "$L" ] && echo "Etkin ses sınırı: %$L"
exit 0
