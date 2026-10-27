# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Sağ menü Ekran ▸ "Uyandır" / "Uyut": tahtanın ekranını güç tasarrufundan çıkarır ya da ona sokar.

ETAP oturumlarında Cinnamon'un kendi ekran karartması kapalıdır (sleep-display-* 0); ekranı X
sunucusunun yerleşik ekran koruyucusu (prefer blanking — çerçeve tamponu siyaha boyanır, önizleme de
siyah görünür) ve DPMS kapatır — giriş ekranında X'in varsayılan süreleri işler. Uyandırma etkin VT'deki
X sunucusunda (bkz. screen/remote.py ile aynı seçim) `xset s reset` + `xset dpms force on`: kullanıcı
dokunmuş gibi davranır; kilitli oturumun kilidini AÇMAZ (ETAP kilidi dm-tool lock — ayrı VT'deki
giriş ekranı; uyanan ekran o olur). Uyutma `xset dpms force off`: tahtaya dokunulunca ekran kendiliğinden
açılır; oturuma ve otomatik kapanmanın boşta kalma sayacına dokunmaz (DPMS sayacı sıfırlamaz).

`xset s reset` X'in boşta kalma süresini de sıfırlar (XScreenSaver idle — TiHA'nın otomatik kapanması
bunu okur, bkz. executor/autoshutdown.py; Arge 1'de ölçüldü: 84,8 sn → 0,3 sn). Müdahale ("Ekranı yönet")
oturumu başında ve sürdükçe sayacı sıfırlar, açık geri sayım penceresini COUNTDOWN_POSTPONE ile
erteler (bkz. screen/remote.py).
"""

from __future__ import annotations

from .accounts import _ssh

# Etkin VT'deki X sunucusu → DISPLAY/XAUTHORITY (yoksa çıkış 3).
_ACTIVE_X = r"""
vt=$(cat /sys/class/tty/tty0/active 2>/dev/null)
set -- $(ps -eo args= | awk -v vt="vt${vt#tty}" '
  $1 ~ /(^|\/)Xorg$/ { d = ""; a = ""; m = 0
    for (i = 2; i <= NF; i++) { if ($i ~ /^:[0-9]+$/) d = $i; if ($i == "-auth") a = $(i + 1); if ($i == vt) m = 1 }
    if (m && d != "") { print d, a; exit } }')
[ -n "$1" ] || { echo "Ekranda çalışan X sunucusu bulunamadı."; exit 3; }
export DISPLAY="$1"
[ -n "$2" ] && export XAUTHORITY="$2"
"""

# TiHA'nın açık geri sayım penceresini (tiha-shutdown-countdown.py, başlık "Otomatik Kapatma Uyarısı")
# "10 dakika ertele" anlamında kapatır: pencereye WM_DELETE_WINDOW gönderilir — pencerenin kendi sağ üst X
# davranışı (xset s reset + çıkış kodu 1 = servis 10 dk erteler). Süreci öldürmek YANLIŞ olurdu: servis
# 1 dışındaki her çıkış kodunu "süre doldu" sayıp tahtayı kapatır. DISPLAY/XAUTHORITY ayarlı olmalı;
# python3-xlib yoksa sessizce geçilir (pencere açık kalır, müdahale eden kişi düğmeye basabilir).
COUNTDOWN_POSTPONE = r"""
if pgrep -f 'tiha-shutdown-countdown[.]py' >/dev/null 2>&1; then
  python3 -c '
from Xlib import X, display, protocol
d = display.Display()
proto, delete = d.intern_atom("WM_PROTOCOLS"), d.intern_atom("WM_DELETE_WINDOW")
name, utf8 = d.intern_atom("_NET_WM_NAME"), d.intern_atom("UTF8_STRING")
want = "Otomatik Kapatma Uyar\u0131s\u0131".encode()
def walk(w):
    try:
        kids = w.query_tree().children
    except Exception:
        return
    for c in kids:
        try:
            p = c.get_full_property(name, utf8)
        except Exception:
            p = None
        if p and p.value == want:
            yield c
        yield from walk(c)
n = 0
for w in list(walk(d.screen().root)):
    w.send_event(protocol.event.ClientMessage(window=w, client_type=proto, data=(32, [delete, X.CurrentTime, 0, 0, 0])))
    n += 1
d.flush()
print(n)' 2>/dev/null
fi
"""

_WAKE_SCRIPT = _ACTIVE_X + r"""
before=$(xset q 2>/dev/null | awk '/Monitor is/ { print $3 }')
xset s reset && xset dpms force on || { echo "Ekran uyandırılamadı (xset)."; exit 4; }
case "$before" in
  On) echo "Ekran zaten açıktı (koruyucu sıfırlandı)." ;;
  "") echo "Ekran uyandırıldı." ;;
  *) echo "Ekran uyandırıldı (önceki durum: $before)." ;;
esac
"""

# Kapattıktan sonra kısa bekleyip yeniden okunur: ekranı açık tutan bir şey (yansıtma oynatıcısı mpv,
# müdahale oturumu, o an dokunan biri) varsa monitör hemen geri açılır — bu durumda başarısız sayılır.
_SLEEP_SCRIPT = _ACTIVE_X + r"""
xset dpms force off || { echo "Ekran uyutulamadı (xset)."; exit 4; }
sleep 2
case "$(xset q 2>/dev/null | awk '/Monitor is/ { print $3 }')" in
  On) echo "Ekran hemen yeniden açıldı: tahtada ekranı açık tutan bir şey var (ekran yansıtma, müdahale oturumu ya da kullanım)."; exit 5 ;;
  *) echo "Ekran uyutuldu (dokunulunca açılır)." ;;
esac
"""


def wake(board: dict, user: str, password: str) -> dict:
    """Döner: {"status", "rc", "output"} (bkz. accounts._ssh)."""
    return _ssh(board, user, password, _WAKE_SCRIPT, timeout=20)


def sleep(board: dict, user: str, password: str) -> dict:
    """Ekran ▸ Uyut. Döner: {"status", "rc", "output"} (bkz. accounts._ssh)."""
    return _ssh(board, user, password, _SLEEP_SCRIPT, timeout=20)
