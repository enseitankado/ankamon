"""Ekran yansıtma ("Ekranımı yansıt"): yöneticinin ekranını seçili tahtalarda tam ekran gösterir.

Akış: tarayıcı ekranı WebRTC/WHIP ile Tiha-Mon'daki MediaMTX'e yollar (bkz. docker/rootfs/cast/,
services/mediamtx.sh); bu modül her tahtada SSH ile etkin X ekranında bir sarmalayıcı başlatır:
  1) ekranı uyandırır (DPMS "force on" + X ekran koruyucu sayacı sıfırlanır); oturumdaki
     cinnamon-screensaver etkinse kapatır, yayın bitince yeniden etkinleştirir. ETAP'ta ekran koruyucu
     "özel" kipte ve kilit `dm-tool lock`tur: oturum kendi VT'sinde kalır, giriş ekranı AYRI bir VT'de
     açılır. Yayın her zaman ETKİN VT'deki ekrana gider — kilitli tahtada kilit ekranının üstünde görünür,
     oturumun kilidi açılmaz, yayın bitince kilit yerinde kalır;
  2) mpv'yi RTSP ile (tcp, düşük gecikme profili, donanımsal kod çözme) tam ekran + her zaman üstte,
     klavye/fare kısayolları kapalı başlatır — mpv oynatırken DPMS/ekran koruyucuyu kendisi engeller;
  3) yayın biterse (yönetici paylaşımı durdurdu) mpv kendiliğinden çıkar; kısa ağ kesintilerinde
     sarmalayıcı yeniden bağlanır, art arda 3 kısa denemede vazgeçer ve ekranı eski hâline getirir.
Tahtada kurulum gerekmez: ETAP 23'te mpv hazır gelir. Ses isteğe bağlıdır (oturum kullanıcısının
pipewire-pulse soketi üzerinden).
"""

from __future__ import annotations

import os
import re
import shlex
import socket
import subprocess

RTSP_PORT = int(os.environ.get("CAST_RTSP_PORT", "8554"))
STREAM_RE = re.compile(r"^c-[A-Za-z0-9]{24,64}$")

_SSH_OPTS = [
    "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "ConnectTimeout=8",
    "-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
]

# Etkin VT'deki Xorg ve o ekranın oturum kullanıcısı (bkz. screen/remote.py ile aynı mantık). Oturum
# açılmamışsa kullanıcı giriş ekranının (lightdm) kendisidir.
_FIND_DISPLAY = r"""
vt=$(cat /sys/class/tty/tty0/active 2>/dev/null)
set -- $(ps -eo args= | awk -v vt="vt${vt#tty}" '
  $1 ~ /(^|\/)Xorg$/ { d = ""; a = ""; m = 0
    for (i = 2; i <= NF; i++) { if ($i ~ /^:[0-9]+$/) d = $i; if ($i == "-auth") a = $(i + 1); if ($i == vt) m = 1 }
    if (m && d != "") { print d, a; exit } }')
D=${1:-:0}
A=${2:-}
U=
for s in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
  info=$(loginctl show-session "$s" -p Display -p Name -p State 2>/dev/null)
  case "$info" in *"Display=$D"*) ;; *) continue ;; esac
  n=$(printf '%s\n' "$info" | sed -n 's/^Name=//p')
  case "$info" in *State=active*) U=$n; break ;; esac
  [ -n "$U" ] || U=$n
done
UI=
[ -n "$U" ] && UI=$(id -u "$U" 2>/dev/null)
"""

# Tahtada /run/tihamon-cast/run.sh olarak yazılan sarmalayıcı (setsid ile, oturumdan bağımsız çalışır).
_WRAPPER = r"""#!/bin/sh
D=__D__; A=__A__; U=__U__; UI=__UI__; URL=__URL__; AUDIO=__AUDIO__
DIR=/run/tihamon-cast
echo $$ > "$DIR/pid"
export DISPLAY="$D" HOME="$DIR"
[ -n "$A" ] && export XAUTHORITY="$A"
as_user() {
  [ -n "$U" ] && [ -n "$UI" ] && [ -S "/run/user/$UI/bus" ] || return 1
  runuser -u "$U" -- env XDG_RUNTIME_DIR="/run/user/$UI" DISPLAY="$D" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UI/bus" "$@"
}
ss=0
xset dpms force on 2>/dev/null; xset s reset 2>/dev/null
if as_user cinnamon-screensaver-command -q 2>/dev/null | grep -qi ' active'; then
  ss=1; as_user cinnamon-screensaver-command -d >/dev/null 2>&1
  echo "ekran koruyucu kapatıldı"
fi
xset dpms force on 2>/dev/null
restore() {
  [ "$ss" = 1 ] && as_user cinnamon-screensaver-command -a >/dev/null 2>&1
  rm -f "$DIR/pid"
}
snd=--no-audio
if [ "$AUDIO" = 1 ] && [ -n "$UI" ] && [ -S "/run/user/$UI/pulse/native" ]; then
  export PULSE_SERVER="unix:/run/user/$UI/pulse/native"; snd=--audio=auto
fi
lat=--untimed
[ "$snd" = --no-audio ] || lat=
# Kaplama penceresi (cover.py) varsa mpv ona gömülür; yoksa yalnız pencere yöneticisinin "üstte" ayarı.
player="mpv --fs --ontop --no-border"
python3 -c 'import gi; gi.require_version("Gtk", "3.0"); from gi.repository import Gtk' 2>/dev/null \
  && player="python3 $DIR/cover.py"
mp=
trap '[ -n "$mp" ] && kill "$mp" 2>/dev/null; wait; restore; exit 0' TERM INT HUP
short=0
while [ "$short" -lt 3 ]; do
  t0=$(date +%s)
  $player --no-config --profile=low-latency $lat --hwdec=auto-safe --rtsp-transport=tcp --network-timeout=10 \
      --title="Tiha-Mon yansıtma" --x11-name=tihamon-cast --stop-screensaver=yes --quiet \
      --no-osc --osd-level=0 --no-input-default-bindings --input-vo-keyboard=no --input-cursor=no \
      --cursor-autohide=always --keep-open=no --background=0/0/0 $snd "$URL" &
  mp=$!
  wait "$mp"
  mp=
  if [ $(( $(date +%s) - t0 )) -lt 5 ]; then short=$((short + 1)); else short=0; fi
  sleep 1
done
restore
"""

# Tahtada /run/tihamon-cast/cover.py: mpv'yi override-redirect (POPUP) tam ekran bir pencereye gömer ve
# pencereyi saniyede bir en üste çıkarır. Pencere yöneticisinin "üstte" kipi, kendini her zaman üstte
# tutan override-redirect pencereleri (giriş ekranındaki eta-keyboard, paneller, bildirimler) geçemiyordu.
# POPUP pencere odak almaz; dokunma/tıklama yayının altındaki uygulamaya da gitmez.
_COVER = r"""import signal, subprocess, sys, warnings
import gi
warnings.simplefilter("ignore")
gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("GdkX11", "3.0")
from gi.repository import Gdk, GdkX11, GLib, Gtk  # noqa: F401 (GdkX11: get_xid)

win = Gtk.Window(type=Gtk.WindowType.POPUP)
scr = Gdk.Screen.get_default()
win.move(0, 0)
win.set_default_size(scr.get_width(), scr.get_height())
win.override_background_color(Gtk.StateFlags.NORMAL, Gdk.RGBA(0, 0, 0, 1))
win.show_all()
gw = win.get_window()
gw.set_cursor(Gdk.Cursor.new_for_display(gw.get_display(), Gdk.CursorType.BLANK_CURSOR))
proc = subprocess.Popen(["mpv", "--wid=%d" % gw.get_xid()] + sys.argv[1:])

def tick():
    if proc.poll() is not None:
        Gtk.main_quit()
        return False
    gw.raise_()
    return True

def term():
    proc.terminate()
    Gtk.main_quit()
    return False

GLib.timeout_add(1000, tick)
for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    GLib.unix_signal_add(GLib.PRIORITY_HIGH, sig, term)
Gtk.main()
try:
    proc.wait(3)
except subprocess.TimeoutExpired:
    proc.kill()
sys.exit(proc.returncode or 0)
"""

_START = r"""
__FIND__
command -v mpv >/dev/null 2>&1 || { echo "Tahtada mpv kurulu değil." >&2; exit 3; }
DIR=/run/tihamon-cast
mkdir -p "$DIR"; chmod 700 "$DIR"
# Önceki yansıtma sürüyorsa kapanır (dash'in kill'i negatif pid almaz: pkill -g).
[ -s "$DIR/pid" ] && pkill -TERM -g "$(cat "$DIR/pid")" 2>/dev/null && sleep 1
cat > "$DIR/run.sh" <<'TIHAMON_EOF'
__WRAPPER__
TIHAMON_EOF
cat > "$DIR/cover.py" <<'TIHAMON_EOF'
__COVER__
TIHAMON_EOF
rm -f "$DIR/pid"
sed -i -e "s|__D__|'$D'|" -e "s|__A__|'$A'|" -e "s|__U__|'$U'|" -e "s|__UI__|'$UI'|" "$DIR/run.sh"
setsid sh "$DIR/run.sh" >"$DIR/log" 2>&1 </dev/null &
echo "Ekran $D (oturum: ${U:-yok}) — yayın açılıyor…"
i=0
while [ $i -lt 24 ]; do
  sleep 0.5; i=$((i + 1))
  if grep -q '^VO:' "$DIR/log" 2>/dev/null; then
    grep -E 'ekran koruyucu|^VO:|^AO:' "$DIR/log" | sed 's/^/  /'
    echo "Görüntü tahtada."
    exit 0
  fi
  [ $i -gt 4 ] && ! kill -0 "$(cat "$DIR/pid" 2>/dev/null)" 2>/dev/null && break
done
echo "Görüntü gelmedi. mpv çıktısı:" >&2
grep -v '^$' "$DIR/log" | tail -n 6 >&2
exit 4
"""

_STOP = r"""
DIR=/run/tihamon-cast
stopped=
if [ -s "$DIR/pid" ]; then
  p=$(cat "$DIR/pid")
  pkill -TERM -g "$p" 2>/dev/null && stopped=1
  i=0; while kill -0 "$p" 2>/dev/null && [ $i -lt 10 ]; do sleep 0.3; i=$((i + 1)); done
  pkill -KILL -g "$p" 2>/dev/null
  rm -f "$DIR/pid"
fi
# Yedek: pid dosyası kaybolduysa. Desenler satır başına çapalı — yoksa bu betiği çalıştıran
# "sh -c …" satırı da eşleşir ve SSH oturumu kendini öldürür.
pkill -f "^sh $DIR/run.sh" 2>/dev/null && stopped=1
pkill -f "^python3 $DIR/cover.py" 2>/dev/null && stopped=1
pkill -f "^mpv .*--x11-name=tihamon-cast" 2>/dev/null && stopped=1
if [ -n "$stopped" ]; then echo "Yansıtma durduruldu."; else echo "Tahtada yansıtma yoktu."; fi
"""


def server_address(board_ip: str) -> str:
    """Tahtanın Tiha-Mon'a hangi adresle ulaşacağı: çekirdeğin o tahtaya giden yolda seçtiği kaynak
    adres (host ağındayız; birden çok arayüz/segment olsa da tahtanın gördüğü adres seçilir)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.connect((board_ip, 9))  # UDP connect paket göndermez, yalnız yolu seçer
        return s.getsockname()[0]


def stream_url(board_ip: str, stream: str) -> str:
    return f"rtsp://{server_address(board_ip)}:{RTSP_PORT}/{stream}"


def _ssh(board: dict, user: str, password: str, script: str, timeout: int) -> dict:
    if not board.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, f"{user}@{board['ip']}", "sh -c " + shlex.quote(script)]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"status": "failed", "rc": None, "output": f"Zaman aşımı ({timeout} sn)."}
    out = proc.stdout.decode("utf-8", "replace").strip()
    err = proc.stderr.decode("utf-8", "replace").strip()
    if proc.returncode == 0:
        return {"status": "ok", "rc": 0, "output": out}
    if proc.returncode == 5:
        return {"status": "unreachable", "rc": 5, "output": "SSH parolası reddedildi."}
    if proc.returncode == 255:
        return {"status": "unreachable", "rc": 255, "output": err or "SSH ile ulaşılamadı."}
    return {"status": "failed", "rc": proc.returncode, "output": "\n".join(x for x in (out, err) if x)}


def start(board: dict, user: str, password: str, stream: str, audio: bool) -> dict:
    """Tahtada yansıtmayı başlatır; görüntü gerçekten gelene dek (en çok ~12 sn) bekler."""
    if not STREAM_RE.match(stream):
        return {"status": "failed", "rc": None, "output": "Geçersiz yayın adı."}
    if not board.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    wrapper = (_WRAPPER.replace("__URL__", shlex.quote(stream_url(board["ip"], stream)))
               .replace("__AUDIO__", "1" if audio else "0"))
    script = (_START.replace("__FIND__", _FIND_DISPLAY).replace("__WRAPPER__", wrapper)
              .replace("__COVER__", _COVER))
    return _ssh(board, user, password, script, timeout=40)


def stop(board: dict, user: str, password: str) -> dict:
    return _ssh(board, user, password, _STOP, timeout=20)
