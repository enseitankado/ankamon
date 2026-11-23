# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

set -u

# Oturum açık kullanıcıların ses sunucuları (ETAP/Pardus: PipeWire'ın pulse soketi /run/user/<uid>/pulse/native). Root
# bunlara PULSE_SERVER ile bağlanır (bkz. worker executor/cast.py). Sistem kullanıcıları (uid < 1000, ör. giriş ekranının
# lightdm'i) atlanır. Kullanıcı oturumu yoksa ALSA ana kanalı (amixer, ses kartı başına Master) değiştirilir.
# Ekran güç tasarrufundayken (DPMS) HDMI çıkışı kaybolur, varsayılan sahte "auto_null" kalır: o oturum atlanır.
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

case "${DUZEY:-adim10}" in
    adim10) pa=-10%; al=10%- ;;
    adim20) pa=-20%; al=20%- ;;
    10|30|50) pa=$DUZEY%; al=$DUZEY% ;;
    *) echo "Geçersiz düzey: $DUZEY" >&2; exit 2 ;;
esac
ses_pulse set-sink-volume "$pa" || ses_alsa "$al" || { echo "Bu cihazda değiştirilebilecek ses çıkışı bulunamadı." >&2; exit 1; }
