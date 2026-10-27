# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
# Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
# https://github.com/enseitankado/ankamon
#
# Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
# GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
# daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
# değiştirebilirsiniz.
#
# Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
# YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
# verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
#
# Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
# dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
# adresine bakınız.
#
# Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
# parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
# lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
# korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
# kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).

"""Tahtada SSH ile çalıştırılan başlatma betiği: ekrandaki X sunucusunu bulur, x11vnc'yi başlatır, portunu bildirir.

Akış iki adımdır (bkz. __main__.py):
  1) `ssh tahta <betik>` — x11vnc yalnız tahtanın 127.0.0.1'inde, tek bağlantılık (-once) ve 15 sn
     içinde bağlanılmazsa kendiliğinden çıkacak şekilde (-timeout) arka planda başlar; betik seçilen
     portu "PORT=<n>" diye yazıp biter.
  2) `ssh -W 127.0.0.1:<n> tahta` — standart SSH tüneli: SSH'nin stdin/stdout'u doğrudan x11vnc'nin
     TCP bağlantısıdır. Köprü bu baytları WebSocket'e geçirir. Tünel kapanınca x11vnc (-once) biter.
"""

from __future__ import annotations

import re
import shlex

# Görüntü profilleri. max_width: tahta ekranı bundan genişse x11vnc tahtada küçültür (ağ ve
# tarayıcı yükü azalır). wait: x11vnc'nin ekran yoklama/güncelleme aralığı (ms) — kare hızını belirler.
PROFILES = {
    "view": {"max_width": 1920, "wait": 20},    # tek tahta, büyük pencere
    "thumb": {"max_width": 480, "wait": 250},   # çoklu önizleme kutucukları (~4 kare/sn)
}

# Çıkış kodları (köprü bunları WebSocket kapanış kodlarına çevirir).
EXIT_NO_X11VNC = 127
EXIT_START_FAILED = 4

# Etkin VT'deki Xorg seçilir: ETAP'ta kullanıcı değiştirince her oturum ayrı X sunucusunda (:0, :1…)
# kalır; ekranda görünen, /sys/class/tty/tty0/active'in gösterdiği VT'dekidir. -auth dosyası Xorg'un
# kendi komut satırından alınır (lightdm: /var/run/lightdm/root/:N) — giriş ekranında da kullanıcı
# oturumunda da çalışır (Xorg bulunamazsa -auth verilmez: erişim denetimsiz X için).
# x11vnc'ye </dev/null verilir: arka plana geçen süreç SSH oturumunun girdisini devralmasın.
# VNC masaüstü adı ekranın gerçek çözünürlüğünü taşır ("ankamon-1920x1080"): önizleme -scale ile küçültülse de
# tarayıcı kutucuğun en-boy oranını ve gerçek boyuta oranını bilsin (bkz. screen/index.html Tile.setResolution).
_SCRIPT = r"""
vt=$(cat /sys/class/tty/tty0/active 2>/dev/null)
set -- $(ps -eo args= | awk -v vt="vt${vt#tty}" '
  $1 ~ /(^|\/)Xorg$/ { d = ""; a = ""; m = 0
    for (i = 2; i <= NF; i++) { if ($i ~ /^:[0-9]+$/) d = $i; if ($i == "-auth") a = $(i + 1); if ($i == vt) m = 1 }
    if (m && d != "") { print d, a; exit } }')
disp=${1:-:0}
auth=${2:-}
command -v x11vnc >/dev/null 2>&1 || exit 127
sc=
dim=$(XAUTHORITY=${auth:-/nonexistent} xdpyinfo -display "$disp" 2>/dev/null | awk '/dimensions:/ { print $2; exit }')
case $dim in *[!0-9x]*|x*|*x) dim= ;; esac
w=${dim%x*}
[ -n "$w" ] && [ "$w" -gt MAXW ] && sc="-scale MAXW/$w"
out=$(x11vnc -q -bg -localhost -once -timeout 15 -display "$disp" ${auth:+-auth "$auth"} INPUT -shared \
  -nopw -norc -nosel -nobell -nolookup -noxrecord -wait WAIT -defer WAIT $sc ${dim:+-desktop "ankamon-$dim"} 2>&1 </dev/null)
case "$out" in
  *PORT=*) printf '%s\n' "$out" | grep '^PORT=' | head -n 1 ;;
  *) printf '%s\n' "$out" | grep -v '^$' | tail -n 2 >&2; exit 4 ;;
esac
"""

_PORT = re.compile(r"^PORT=(\d+)\s*$", re.M)


def start_command(profile: str, control: bool = False) -> str:
    """1. adımın uzak komutu. Profilin sayıları dışında betiğe dışarıdan gelen metin girmez.
    control: fare/klavye girdisine izin verilir (-viewonly yok; -xkb Türkçe klavye düzeninde
    tuşların doğru karşılığını bulur). Varsayılan salt izlemedir."""
    p = PROFILES[profile]
    script = _SCRIPT.replace("MAXW", str(int(p["max_width"]))).replace("WAIT", str(int(p["wait"])))
    script = script.replace("INPUT", "-xkb" if control else "-viewonly")
    return "sh -c " + shlex.quote(script)


def parse_port(output: str) -> int | None:
    m = _PORT.search(output)
    return int(m.group(1)) if m else None
