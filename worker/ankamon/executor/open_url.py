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

"""Sağ menü "Web sitesi aç": oturumu açık tahtada varsayılan tarayıcıyla siteyi ekranı kaplayacak biçimde açar.

Tarayıcı oturum kullanıcısı olarak `xdg-open` ile başlatılır (kullanıcının varsayılanı), yeni pencere gelince pencere
yöneticisinden tam ekran istenir (EWMH _NET_WM_STATE_FULLSCREEN): her tarayıcıda aynı çalışır, kiosk kipinin aksine kullanıcı
F11 ya da pencere yöneticisiyle çıkabilir. Oturum yoksa işlem yapılmaz (giriş ekranında tarayıcı açılmaz).
"""

from __future__ import annotations

import re
import shlex

from .accounts import _ssh
from .cast import _FIND_DISPLAY

# API'de de aynı kural: tırnak/boşluk/denetim karakteri yok; betiğe yine de shlex ile gömülür.
URL_RE = re.compile(r"^https?://[^\s\"'`<>\\]{1,2000}$")

_FULLSCREEN = r"""
import sys, time
from Xlib import X, display
from Xlib.protocol import event
d = display.Display(); r = d.screen().root
active = d.intern_atom("_NET_ACTIVE_WINDOW"); state = d.intern_atom("_NET_WM_STATE"); full = d.intern_atom("_NET_WM_STATE_FULLSCREEN")
def current():
    p = r.get_full_property(active, X.AnyPropertyType)
    return p.value[0] if p and p.value else 0
before = int(sys.argv[1]); end = time.time() + 15
while time.time() < end and current() in (0, before):
    time.sleep(0.3)
win = current()
if not win:
    sys.exit("Etkin pencere bulunamadı.")
time.sleep(1.5)  # pencere yerleşsin; hemen gönderilen istek bazı tarayıcılarda yok sayılır
w = d.create_resource_object("window", current())
w.configure(stack_mode=X.Above)
r.send_event(event.ClientMessage(window=w, client_type=state, data=(32, [1, full, 0, 1, 0])),
             event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
d.sync()
print((w.get_wm_class() or ("", "tarayıcı"))[-1])
"""

_SCRIPT = _FIND_DISPLAY + r"""
URL=__URL__
case "$U" in ''|lightdm) echo "Bu tahtada açık oturum yok; site açılmadı."; exit 0 ;; esac
export DISPLAY="$D"
[ -n "$A" ] && export XAUTHORITY="$A"
before=$(python3 -c '
from Xlib import X, display
d = display.Display(); p = d.screen().root.get_full_property(d.intern_atom("_NET_ACTIVE_WINDOW"), X.AnyPropertyType)
print(p.value[0] if p and p.value else 0)' 2>/dev/null)
xset dpms force on 2>/dev/null
H=$(getent passwd "$U" | cut -d: -f6)
setsid runuser -u "$U" -- env DISPLAY="$D" XAUTHORITY="$H/.Xauthority" HOME="$H" XDG_RUNTIME_DIR="/run/user/$UI" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UI/bus" xdg-open "$URL" >/dev/null 2>&1 </dev/null &
name=$(python3 -c __FULLSCREEN__ "${before:-0}" 2>&1) && echo "Açıldı ($U oturumu, $name): tam ekran." || { echo "Site açıldı, tam ekran yapılamadı: $name"; exit 0; }
"""


def open_site(board: dict, user: str, password: str, url: str) -> dict:
    """Döner: {"status", "rc", "output"} (bkz. accounts._ssh)."""
    if not URL_RE.match(url or ""):
        return {"status": "failed", "rc": None, "output": "Geçersiz adres."}
    script = _SCRIPT.replace("__URL__", shlex.quote(url)).replace("__FULLSCREEN__", shlex.quote(_FULLSCREEN))
    return _ssh(board, user, password, script, timeout=40)
