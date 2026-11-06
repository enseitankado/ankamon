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

"""Sağ menü Ekran ▸ "Kilitle" / "Kilidi aç": tahtanın ekranını Ankamon'dan açılana dek kilitler.

Kilitliyken etkin VT'deki X ekranının tamamını büyük "Kilitli" yazısı ve kilit simgesi kaplar; klavye,
fare ve dokunmatik bu pencerede yakalanır (Gdk seat grab), alttaki masaüstüne ya da giriş ekranına
ulaşmaz. Oturum açık olsun olmasın aynı çalışır; kilit tahtanın yeniden açılmasından sonra da sürer.

Neden ETAP'ın kendi araçları değil (2026-10-30, Arge 2'de kaynaktan okundu):
  - pardus-lightdm-greeter'ın denetim soketi (/var/lib/lightdm/pardus-greeter, daemon.py) "block-gui"
    olayıyla yalnız giriş formunu soluklaştırır (döner simge), block-gui-timeout (10 sn) sonra kendiliğinden
    açar; açık masaüstü oturumunda işlemez; "message" yalnız küçük bir bildirim gösterir.
  - `dm-tool lock` (ETAP'ın oturum kilidi) parolayla açılır — kullanıcı aşabilir.
  - eta-screen-cover kapatma düğmeli, taşınabilir bir perdedir.
Tahtadaki paket dosyalarına dokunulmaz; kurulanlar Ankamon'un kendi dosyalarıdır ve kilit açılınca silinir:
  /var/lib/ankamon-lock/{lock.py,cover.py,info.json,locked,log}, /etc/systemd/system/ankamon-screen-lock.service.

Bekçi (lock.py, root, systemd Restart=always): yarım saniyede bir etkin VT'ye bakar.
  - O VT'de X varsa kilit penceresini (cover.py) o ekranda çalıştırır; VT değişince (oturum açma, kullanıcı
    değiştirme, dm-tool lock) pencere yeni ekrana taşınır, X yeniden başlarsa pencere de yeniden açılır.
  - Ctrl+Alt+Fn (VT değiştirme) ve Ctrl+Alt+Backspace (X'i öldürme) X'in kendi tuşlarıdır, grab'i geçer:
    ekranda `setxkbmap -option srvrkeys:none` tutulur (sonradan takılan klavye için 2 sn'de bir yinelenir),
    kilit açılınca eski seçenekler geri yazılır. Yine de X'siz bir VT'ye (metin konsolu) geçilirse hemen son
    X VT'sine dönülür (chvt).
Kilit penceresi (cover.py): override-redirect (POPUP) tam ekran pencere, saniyede bir en üste çıkar ve
yakalamayı yeniler (başka bir uygulamanın açık menüsü o an yakalamayı tutuyorsa bir sonraki turda alınır).
Ekran güç tasarrufuna girebilir; dokunulunca uyanır, kilit ekranı görünür.
Açılışta kilit penceresi pencere yöneticisinden (compositor, giriş ekranıyla gelir) önce başlar; compositor sonradan
açılınca pencere en üstte görünse de ekrana çizilmiyordu (Arge 1'de 2026-11-02'de yeniden üretildi). Bu yüzden
pencere bileşim durumu değişince kapanır, bekçi onu hemen yeniden açar.

Kilit yazısının altında tahtanın kimliği (info.json, kilitlerken Ankamon'daki kayıttan): takma ad (kod adı)
büyükçe, altında bilgisayar adı, ETAP modeli/fazı, kablolu/kablosuz MAC ve IP — kilitli tahtayı bulmak/bildirmek için.

Oturum yoklaması (executor/session_probe.py) SCRIPT'teki "L" satırıyla kilit durumunu okur
(boards.screen_locked — göç 035); Tahtalar grid'inin "Oturum" hücresi "… / Kilitli" yazar.
"""

from __future__ import annotations

import json

from .accounts import _ssh
from .display import _ACTIVE_X

DIR = "/var/lib/ankamon-lock"
UNIT = "ankamon-screen-lock.service"

# Oturum yoklamasına eklenen satır: kilit kurulu ise "L 1" (bkz. session_probe.py). if/fi: yoklama betiğinin
# son satırı — "[ … ] && echo" kilitsiz tahtada betiği 1 koduyla bitirir, yoklama başarısız sayılırdı.
SCRIPT = f"""
if [ -e {DIR}/locked ]; then echo "L 1"; fi
"""

_DAEMON = r'''import os, re, signal, subprocess, sys, time

DIR = "/var/lib/ankamon-lock"
COVER = os.path.join(DIR, "cover.py")


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def active_vt():
    try:
        with open("/sys/class/tty/tty0/active") as f:
            return f.read().strip()            # "tty7"
    except OSError:
        return ""


def x_on(vt):
    """Bu VT'de çalışan Xorg'un (DISPLAY, XAUTHORITY) ikilisi; yoksa None."""
    if not vt.startswith("tty"):
        return None
    want = "vt" + vt[3:]
    out = subprocess.run(["ps", "-eo", "args="], stdout=subprocess.PIPE, text=True).stdout
    for line in out.splitlines():
        a = line.split()
        if not a or not re.search(r"(^|/)Xorg$", a[0]) or want not in a[1:]:
            continue
        disp = next((x for x in a[1:] if re.fullmatch(r":[0-9]+", x)), None)
        auth = a[a.index("-auth") + 1] if "-auth" in a[:-1] else ""
        if disp:
            return disp, auth
    return None


def xenv(x):
    env = dict(os.environ, DISPLAY=x[0], HOME=DIR)
    if x[1]:
        env["XAUTHORITY"] = x[1]
    return env


touched = {}        # srvrkeys:none uygulanan ekranlar (ekran -> (DISPLAY, XAUTHORITY))


def xkb_options(x):
    r = subprocess.run(["setxkbmap", "-query"], env=xenv(x), stdout=subprocess.PIPE,
                       stderr=subprocess.DEVNULL, text=True, timeout=5)
    if r.returncode != 0:
        return None
    m = re.search(r"^options:\s*(.*)$", r.stdout, re.M)
    return m.group(1).strip() if m else ""


def keep_srvrkeys_off(x):
    """VT değiştirme / X öldürme tuşlarını o ekranda kapalı tutar."""
    try:
        opts = xkb_options(x)
        if opts is None or "srvrkeys:none" in opts.split(","):
            return
        touched[x[0]] = x
        subprocess.run(["setxkbmap", "-option", "srvrkeys:none"], env=xenv(x), timeout=5,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:  # noqa: BLE001 — X o an kapanıyor olabilir; bir sonraki turda yinelenir
        log("setxkbmap: %s" % e)


def restore_xkb():
    """Kilidin eklediği srvrkeys:none'ı çıkarır, öteki seçenekler kalır. O anki seçeneklerden hesaplanır:
    bekçi yeniden başlamış olsa da (bellekteki kayıt yoksa) temizlenir."""
    if cur:
        touched[cur[0]] = cur
    for x in touched.values():
        try:
            opts = xkb_options(x)
            if opts is None or "srvrkeys:none" not in opts.split(","):
                continue
            rest = [o for o in opts.split(",") if o and o != "srvrkeys:none"]
            cmd = ["setxkbmap", "-option", ""] + sum((["-option", o] for o in rest), [])
            subprocess.run(cmd, env=xenv(x), timeout=5, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:  # noqa: BLE001
            pass


cover = None
cur = None


def stop_cover():
    global cover
    if cover and cover.poll() is None:
        cover.terminate()
        try:
            cover.wait(3)
        except subprocess.TimeoutExpired:
            cover.kill()
    cover = None


stopping = False


def on_signal(*_):
    # Yalnız bayrak: kapanış tek yerden (döngü sonu) yapılır — kilit açılırken "locked" dosyasının silinmesi
    # ile systemd'nin SIGTERM'i aynı anda gelir, işleyicide çıkmak geri yüklemeyi yarıda keserdi.
    global stopping
    stopping = True


signal.signal(signal.SIGTERM, on_signal)
signal.signal(signal.SIGINT, on_signal)

log("kilit bekçisi başladı")
last_x_vt = None
next_xkb = 0.0
while not stopping and os.path.exists(os.path.join(DIR, "locked")):
    vt = active_vt()
    x = x_on(vt)
    if x:
        last_x_vt = vt
    elif last_x_vt and vt and vt != last_x_vt:
        # X'siz VT (metin konsolu): kilit yokmuş gibi kullanılamasın — son X VT'sine dön.
        log("VT %s → %s'e geri dönülüyor" % (vt, last_x_vt))
        subprocess.run(["chvt", last_x_vt[3:]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.5)
        continue
    if x != cur or (cover is not None and cover.poll() is not None):
        stop_cover()
        cur = x
        if x:
            log("kilit ekranı %s (%s)" % (x[0], vt))
            cover = subprocess.Popen([sys.executable, COVER], env=xenv(x),
                                     stdout=subprocess.DEVNULL, stderr=open(os.path.join(DIR, "cover.err"), "a"))
            next_xkb = 0.0
    if x and time.monotonic() >= next_xkb:
        keep_srvrkeys_off(x)
        next_xkb = time.monotonic() + 2
    time.sleep(0.5)
stop_cover()
restore_xkb()
log("kilit kapandı")
'''

_COVER = r'''import json, signal, warnings
import gi
warnings.simplefilter("ignore")
gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GLib, Gtk

scr = Gdk.Screen.get_default()
W, H = scr.get_width(), scr.get_height()
unit = max(min(W, H) // 6, 60)

css = Gtk.CssProvider()
css.load_from_data(("""
window.ankamon-lock { background-color: #14181d; }
.ankamon-lock-title { color: #ffffff; font-weight: bold; font-size: %dpx; }
.ankamon-lock-sub { color: #9aa4ae; font-size: %dpx; }
.ankamon-lock-code { color: #ffffff; font-weight: bold; font-size: %dpx; }
.ankamon-lock-key { color: #7d8790; font-size: %dpx; }
.ankamon-lock-val { color: #d6dce2; font-size: %dpx; font-family: monospace; }
""" % (unit, max(unit // 5, 16), max(unit * 2 // 5, 26), max(unit // 6, 14), max(unit // 6, 14))).encode())
Gtk.StyleContext.add_provider_for_screen(scr, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 10)

win = Gtk.Window(type=Gtk.WindowType.POPUP)
win.get_style_context().add_class("ankamon-lock")
win.move(0, 0)
win.set_default_size(W, H)
win.resize(W, H)

# Tahtanın kimliği (bkz. modül notu): kod adı büyükçe, ayrıntılar alt yazı boyunda.
try:
    with open("/var/lib/ankamon-lock/info.json", encoding="utf-8") as f:
        info = json.load(f)
except (OSError, ValueError):
    info = {}
rows = [r for r in info.get("rows") or [] if isinstance(r, list) and len(r) == 2 and r[1]]

box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=unit // 5, halign=Gtk.Align.CENTER,
              valign=Gtk.Align.CENTER)
icon = None
theme = Gtk.IconTheme.get_default()
# Asma kilit: Adwaita'nın ölçeklenebilir (SVG) simgesi büyükte de net; sembolik simge rengini CSS'ten alır.
for name in ("changes-prevent-symbolic", "system-lock-screen-symbolic", "changes-prevent", "system-lock-screen"):
    if theme.has_icon(name):
        icon = Gtk.Image.new_from_icon_name(name, Gtk.IconSize.DIALOG)
        icon.set_pixel_size(int(unit * 1.3))
        icon.get_style_context().add_class("ankamon-lock-title")
        break
if icon is None:
    icon = Gtk.Label(label="\U0001F512")
    icon.get_style_context().add_class("ankamon-lock-title")
box.pack_start(icon, False, False, 0)
title = Gtk.Label(label="Kilitli")
title.get_style_context().add_class("ankamon-lock-title")
box.pack_start(title, False, False, 0)
sub = Gtk.Label(label="Bu tahta yönetici tarafından kilitlendi.")
sub.get_style_context().add_class("ankamon-lock-sub")
box.pack_start(sub, False, False, 0)
code = info.get("code") or ""
if code or rows:
    ident = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=unit // 10, margin_top=unit // 4)
    if code:
        lbl = Gtk.Label(label=code)
        lbl.get_style_context().add_class("ankamon-lock-code")
        ident.pack_start(lbl, False, False, 0)
    grid = Gtk.Grid(column_spacing=unit // 8, row_spacing=unit // 25, halign=Gtk.Align.CENTER)
    for i, (k, v) in enumerate(rows):
        kl = Gtk.Label(label=str(k), xalign=1)
        kl.get_style_context().add_class("ankamon-lock-key")
        vl = Gtk.Label(label=str(v), xalign=0)
        vl.get_style_context().add_class("ankamon-lock-val")
        grid.attach(kl, 0, i, 1, 1)
        grid.attach(vl, 1, i, 1, 1)
    ident.pack_start(grid, False, False, 0)
    box.pack_start(ident, False, False, 0)
win.add(box)
win.show_all()

gw = win.get_window()
gw.set_cursor(Gdk.Cursor.new_for_display(gw.get_display(), Gdk.CursorType.BLANK_CURSOR))
seat = gw.get_display().get_default_seat()


composited = scr.is_composited()


def tick():
    # Compositor sonradan açıldı/kapandı: bu pencere çizilmez olur; bekçi yeniden başlatır (bkz. modül notu).
    if scr.is_composited() != composited:
        Gtk.main_quit()
        return False
    # Tam ekran (ekran çözünürlüğü değişmiş olabilir), en üstte ve tüm girişler bu pencerede.
    if (scr.get_width(), scr.get_height()) != win.get_size():
        win.resize(scr.get_width(), scr.get_height())
    gw.raise_()
    # Teyit: pencere görünür ve giriş bu pencerede — kilitleme işi bu işareti bekler (bkz. _LOCK).
    if seat.grab(gw, Gdk.SeatCapabilities.ALL, True, None, None, None, None) == Gdk.GrabStatus.SUCCESS:
        open("/var/lib/ankamon-lock/shown", "w").close()
    return True


tick()
GLib.timeout_add(1000, tick)
for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    GLib.unix_signal_add(GLib.PRIORITY_HIGH, sig, Gtk.main_quit)
Gtk.main()
'''

_UNIT = f"""[Unit]
Description=Ankamon ekran kilidi (Ankamon'dan "Kilidi aç" uygulanana dek)
After=display-manager.service
ConditionPathExists={DIR}/locked

[Service]
ExecStart=/usr/bin/python3 {DIR}/lock.py
Restart=always
RestartSec=1
# SIGTERM yalnız bekçiye: kilit penceresini kendisi kapatır, klavye seçeneklerini geri yazar.
KillMode=mixed
StandardOutput=append:{DIR}/log
StandardError=append:{DIR}/log

[Install]
WantedBy=graphical.target
"""

_LOCK = f"""
command -v python3 >/dev/null 2>&1 && python3 -c 'import gi; gi.require_version("Gtk", "3.0"); from gi.repository import Gtk' 2>/dev/null \\
  || {{ echo "Tahtada python3-gi (Gtk 3) yok — kilit ekranı çizilemez." >&2; exit 3; }}
D={DIR}
mkdir -p "$D"; chmod 700 "$D"
cat > "$D/lock.py" <<'ANKAMON_EOF'
__DAEMON__
ANKAMON_EOF
cat > "$D/cover.py" <<'ANKAMON_EOF'
__COVER__
ANKAMON_EOF
cat > "$D/info.json" <<'ANKAMON_EOF'
__INFO__
ANKAMON_EOF
cat > /etc/systemd/system/{UNIT} <<'ANKAMON_EOF'
{_UNIT}ANKAMON_EOF
was=$([ -e "$D/locked" ] && echo 1)
date '+%F %T' > "$D/locked"
: > "$D/log"
rm -f "$D/shown"
systemctl daemon-reload
systemctl enable {UNIT} >/dev/null 2>&1
systemctl restart {UNIT}
i=0
while [ $i -lt 16 ]; do
  sleep 0.5; i=$((i + 1))
  if [ -e "$D/shown" ]; then
    __WAKE__
    echo "Ekran kilitlendi$([ -n "$was" ] && echo ' (zaten kilitliydi, yenilendi)'): $(grep 'kilit ekranı' "$D/log" | tail -1 | cut -d' ' -f2-)"
    exit 0
  fi
done
if pgrep -f "^/usr/bin/python3 $D/cover.py" >/dev/null; then
  # Başka bir uygulamanın açık menüsü girişi tutuyor olabilir: pencere saniyede bir yeniden dener.
  __WAKE__
  echo "Kilit ekranı açık; giriş henüz yakalanamadı (başka bir uygulama tutuyor), yeniden deneniyor."
  exit 0
fi
if systemctl is-active -q {UNIT} && ! grep -q 'kilit ekranı' "$D/log" 2>/dev/null; then
  echo "Kilit kuruldu; ekranda X bulunamadı — X açılınca kilit ekranı gelir."
  exit 0
fi
echo "Kilit başlatılamadı:" >&2
tail -n 5 "$D/log" "$D/cover.err" 2>/dev/null >&2
exit 4
"""

# Kilit görünsün: uyuyan ekran uyandırılır (alt kabukta — _ACTIVE_X X bulamazsa çıkar).
_WAKE = "(\n" + _ACTIVE_X + """
xset s reset; xset dpms force on
) >/dev/null 2>&1"""

# Bekçi geri yüklemeyi yapamadıysa: etkin ekranda kilidin eklediği srvrkeys:none çıkarılır (alt kabukta —
# _ACTIVE_X X bulamazsa çıkar).
_XKB_RESTORE = "(\n" + _ACTIVE_X + r"""
o=$(setxkbmap -query 2>/dev/null | sed -n 's/^options: *//p')
case ",$o," in
  *,srvrkeys:none,*)
    rest=$(printf '%s' "$o" | tr ',' ' ' | xargs -n1 | grep -v '^srvrkeys:none$' | sed 's/^/-option /' | xargs)
    setxkbmap -option "" $rest 2>/dev/null ;;
esac
) >/dev/null 2>&1
"""

_UNLOCK = r"""
D=__DIR__
was=$([ -e "$D/locked" ] && echo 1)
rm -f "$D/locked"
systemctl disable --now __UNIT__ >/dev/null 2>&1
__XKB_RESTORE__
rm -f /etc/systemd/system/__UNIT__
systemctl daemon-reload
pkill -f "^/usr/bin/python3 $D/lock.py" 2>/dev/null
pkill -f "^/usr/bin/python3 $D/cover.py" 2>/dev/null
rm -rf "$D"
if [ -n "$was" ]; then echo "Ekran kilidi açıldı."; else echo "Tahtada ekran kilidi yoktu."; fi
""".replace("__DIR__", DIR).replace("__UNIT__", UNIT).replace("__XKB_RESTORE__", _XKB_RESTORE)


def identities(conn, board_ids: list[int]) -> dict[int, dict]:
    """Kilit ekranında yazacak kimlik: {board_id: {"code", "rows": [[ad, değer], …]}} (boş değerler atlanır)."""
    rows = conn.execute(
        "SELECT id, label, hostname, mac::text AS mac, wifi_mac::text AS wifi_mac, host(ip) AS ip, etap"
        " FROM boards WHERE id = ANY(%s)",
        (board_ids,)).fetchall()
    out = {}
    for r in rows:
        etap = r["etap"] or {}
        model = ""
        if etap.get("tahta"):
            # util.Format.etap ile aynı ad: model (yoksa marka) ve FATİH fazı.
            model = " · ".join(x for x in (etap.get("ad") or etap.get("marka") or "",
                                            f"Faz {etap['faz']}" if etap.get("faz") else "") if x)
        out[r["id"]] = {"code": (r["label"] or "").strip(),
                        "rows": [["Bilgisayar adı", r["hostname"] or ""], ["ETAP", model],
                                 ["Kablolu MAC", (r["mac"] or "").upper()],
                                 ["Kablosuz MAC", (r["wifi_mac"] or "").upper()], ["IP", r["ip"] or ""]]}
    return out


def lock(board: dict, user: str, password: str, identity: dict | None = None) -> dict:
    """Ekran ▸ Kilitle. Döner: {"status", "rc", "output"} (bkz. accounts._ssh). identity: bkz. identities()."""
    info = dict(identity or {"code": "", "rows": []})
    if board.get("ip"):
        # Bağlanılan adres kayıttakinden günceldir.
        info["rows"] = [[k, board["ip"] if k == "IP" else v] for k, v in info.get("rows") or [["IP", ""]]]
    # Tek satır, yalnız ASCII (ensure_ascii): heredoc sonlandırıcısıyla ya da betikteki yer tutucularla karışmaz.
    script = (_LOCK.replace("__DAEMON__", _DAEMON).replace("__COVER__", _COVER).replace("__WAKE__", _WAKE)
              .replace("__INFO__", json.dumps(info)))
    return _ssh(board, user, password, script, timeout=30)


def unlock(board: dict, user: str, password: str) -> dict:
    """Ekran ▸ Kilidi aç. Döner: {"status", "rc", "output"}."""
    return _ssh(board, user, password, _UNLOCK, timeout=20)
