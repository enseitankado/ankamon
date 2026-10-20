"""Sağ menü Ekran ▸ "Uyandır": tahtanın güç tasarrufuna girmiş (karartılmış) ekranını uyandırır.

ETAP oturumlarında Cinnamon'un kendi ekran karartması kapalıdır (sleep-display-* 0); ekranı X
sunucusunun yerleşik ekran koruyucusu (prefer blanking — çerçeve tamponu siyaha boyanır, önizleme de
siyah görünür) ve DPMS kapatır — giriş ekranında X'in varsayılan süreleri işler. Uyandırma etkin VT'deki
X sunucusunda (bkz. screen/remote.py ile aynı seçim) `xset s reset` + `xset dpms force on`: kullanıcı
dokunmuş gibi davranır; kilitli oturumun kilidini AÇMAZ (ETAP kilidi dm-tool lock — ayrı VT'deki
giriş ekranı; uyanan ekran o olur).
"""

from __future__ import annotations

from .accounts import _ssh

_WAKE_SCRIPT = r"""
vt=$(cat /sys/class/tty/tty0/active 2>/dev/null)
set -- $(ps -eo args= | awk -v vt="vt${vt#tty}" '
  $1 ~ /(^|\/)Xorg$/ { d = ""; a = ""; m = 0
    for (i = 2; i <= NF; i++) { if ($i ~ /^:[0-9]+$/) d = $i; if ($i == "-auth") a = $(i + 1); if ($i == vt) m = 1 }
    if (m && d != "") { print d, a; exit } }')
[ -n "$1" ] || { echo "Ekranda çalışan X sunucusu bulunamadı."; exit 3; }
export DISPLAY="$1"
[ -n "$2" ] && export XAUTHORITY="$2"
before=$(xset q 2>/dev/null | awk '/Monitor is/ { print $3 }')
xset s reset && xset dpms force on || { echo "Ekran uyandırılamadı (xset)."; exit 4; }
case "$before" in
  On) echo "Ekran zaten açıktı (koruyucu sıfırlandı)." ;;
  "") echo "Ekran uyandırıldı." ;;
  *) echo "Ekran uyandırıldı (önceki durum: $before)." ;;
esac
"""


def wake(board: dict, user: str, password: str) -> dict:
    """Döner: {"status", "rc", "output"} (bkz. accounts._ssh)."""
    return _ssh(board, user, password, _WAKE_SCRIPT, timeout=20)
