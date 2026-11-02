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

"""Sağ menü Ekran ▸ Klavye / Fare / Dokunmatik kilitle: tahtanın giriş aygıtlarını Ankamon'dan açılana dek kapatır.

Tahtada xinput yok; X'ten bağımsız, daha güçlü yol kullanılır: bekçi (systemd, root) /dev/input/event* aygıtlarını
EVIOCGRAB ile tek başına tutar — olaylar X'e de metin konsoluna da ulaşmaz; X yeniden başlasa, oturum değişse ya da aygıt
sonradan takılsa da (2 sn'de bir yeniden taranır) kilit sürer, yeniden açılışta da devam eder.
Kilitler birbirinden bağımsızdır, birkaçı birlikte tutulabilir:
  keyboard: klavye sınıfı aygıtlar, aynı USB klavyenin ses/medya/uyku düğümleri + ekran klavyesi (eta-keyboard çalışmaz).
  mouse:    fare + dokunma (fare kilidi dokunmayı da kapatır).
  touch:    yalnız dokunma; fare çalışır.
"Ekranı yönet" (x11vnc, XTEST) bu kilitlerden etkilenmez: yönetici kilitli tahtaya müdahale edebilir.

Kurulum: /var/lib/ankamon-input/{lock.py, keyboard|mouse|touch (bayrak dosyaları), log} ve
/etc/systemd/system/ankamon-input-lock.service; son kilit açılınca hepsi silinir. Oturum yoklaması SCRIPT'teki "I"
satırıyla durumu okur (boards.input_locks — göç 036).
"""

from __future__ import annotations

from .accounts import _ssh

DIR = "/var/lib/ankamon-input"
UNIT = "ankamon-input-lock.service"
DEVICES = ("keyboard", "mouse", "touch")

# if/fi: yoklama betiğinin son satırları kilitsiz tahtada betiği hata koduyla bitirmesin (bkz. screenlock.SCRIPT).
SCRIPT = f"""
if [ -d {DIR} ]; then echo "I $(cd {DIR} && ls keyboard mouse touch 2>/dev/null | xargs)"; fi
"""

_DAEMON = r'''import fcntl, glob, os, signal, time

DIR = "/var/lib/ankamon-input"
EVIOCGRAB = 0x40044590
KEY_ENTER, KEY_A, KEY_Z = 28, 30, 44
BTN_LEFT, BTN_TOUCH = 0x110, 0x14a
ABS_X, ABS_MT_X = 0x00, 0x35
REL_X = 0x00
PROP_DIRECT = 0


def bits(path):
    """sysfs yetenek maskesi ("1f 0 ffff", en anlamlı kelime başta) -> tamsayı."""
    try:
        with open(path) as f:
            words = f.read().split()
    except OSError:
        return 0
    value = 0
    for word in words:
        value = (value << 64) | int(word, 16)
    return value


def has(mask, bit):
    return bool(mask >> bit & 1)


def classes(node):
    """Aygıtın sınıfları: {"keyboard", "mouse", "touch"} alt kümesi (güç düğmesi, ses vb. boş kalır)."""
    base = "/sys/class/input/%s/device/" % node
    key, rel, abs_, prop = (bits(base + "capabilities/key"), bits(base + "capabilities/rel"),
                            bits(base + "capabilities/abs"), bits(base + "properties"))
    out = set()
    if has(key, KEY_A) and has(key, KEY_Z) and has(key, KEY_ENTER):
        out.add("keyboard")
    if has(rel, REL_X) and has(key, BTN_LEFT):
        out.add("mouse")
    # Dokunmatik: çok noktalı ya da mutlak konumlu işaretçi (kızılötesi çerçeveler kendini "fare" gibi de tanıtır).
    if has(abs_, ABS_MT_X) or (has(abs_, ABS_X) and (has(prop, PROP_DIRECT) or has(key, BTN_TOUCH) or has(key, BTN_LEFT))):
        out.add("touch")
    return out


def usb_parent(node):
    """Aynı fiziksel aygıtın düğümlerinde ortak ön ek ("usb-0000:00:12.0-1"); bilinmiyorsa ""."""
    try:
        with open("/sys/class/input/%s/device/phys" % node) as f:
            phys = f.read().strip()
    except OSError:
        return ""
    return phys.split("/input")[0] if phys.startswith("usb-") else ""


def classify(nodes):
    """Düğüm -> sınıflar. Klavyenin ses/medya düğümleri KEY_A taşımaz: aynı USB aygıtındaki sınıfsız tuş düğümleri klavye sayılır."""
    found = {n: classes(n) for n in nodes}
    parents = {usb_parent(n) for n, c in found.items() if "keyboard" in c} - {""}
    for n, c in found.items():
        if not c and usb_parent(n) in parents and bits("/sys/class/input/%s/device/capabilities/key" % n):
            c.add("keyboard")
    return found


def wanted():
    flags = {d for d in ("keyboard", "mouse", "touch") if os.path.exists(os.path.join(DIR, d))}
    if "mouse" in flags:
        flags.add("touch")     # fare kilidi dokunmayı da kapatır
    return flags


def kill_osk():
    """Ekran klavyesi: yalnız kendi süreci (komut satırının ilk iki öğesi) — başka betiklerin metninde geçmesi sayılmaz."""
    for path in glob.glob("/proc/[0-9]*/cmdline"):
        try:
            with open(path, "rb") as f:
                argv = f.read().split(b"\0")
        except OSError:
            continue
        if any(os.path.basename(a) == b"eta-keyboard" for a in argv[:2]):
            try:
                os.kill(int(path.split("/")[2]), signal.SIGKILL)
            except OSError:
                pass


held = {}
stopping = False


def on_signal(*_):
    global stopping
    stopping = True


signal.signal(signal.SIGTERM, on_signal)
signal.signal(signal.SIGINT, on_signal)
print(time.strftime("%H:%M:%S"), "giriş kilidi bekçisi başladı", flush=True)
while not stopping:
    want = wanted()
    if not want:
        break
    paths = glob.glob("/dev/input/event*")
    found = classify([os.path.basename(p) for p in paths])
    for path in paths:
        node = os.path.basename(path)
        cls = found[node]
        grab = bool(cls & want)
        if grab and path not in held:
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)
                fcntl.ioctl(fd, EVIOCGRAB, 1)
                held[path] = (fd, os.stat(path).st_rdev)
                print(time.strftime("%H:%M:%S"), "tutuldu:", node, sorted(cls), flush=True)
            except OSError as e:
                print(time.strftime("%H:%M:%S"), "tutulamadı:", node, e, flush=True)
        elif not grab and path in held:
            os.close(held.pop(path)[0])
    # Çıkarılan aygıt: tanıtıcıyı bırak (aynı adla yeni aygıt yeniden tutulur).
    for path in list(held):
        try:
            same = os.stat(path).st_rdev == held[path][1]
        except OSError:
            same = False
        if not same:
            os.close(held.pop(path)[0])
    if "keyboard" in want:
        kill_osk()
    time.sleep(2)
for fd, _ in held.values():
    os.close(fd)
print(time.strftime("%H:%M:%S"), "giriş kilidi kapandı", flush=True)
'''

_UNIT = f"""[Unit]
Description=Ankamon klavye/fare/dokunmatik kilidi (Ankamon'dan açılana dek)

[Service]
ExecStart=/usr/bin/python3 {DIR}/lock.py
Restart=always
RestartSec=1
StandardOutput=append:{DIR}/log
StandardError=append:{DIR}/log

[Install]
WantedBy=multi-user.target
"""

_LOCK = f"""
command -v python3 >/dev/null 2>&1 || {{ echo "Tahtada python3 yok." >&2; exit 3; }}
D={DIR}
mkdir -p "$D"; chmod 700 "$D"
cat > "$D/lock.py" <<'ANKAMON_EOF'
__DAEMON__
ANKAMON_EOF
cat > /etc/systemd/system/{UNIT} <<'ANKAMON_EOF'
{_UNIT}ANKAMON_EOF
touch "$D/__DEVICE__"
systemctl daemon-reload
systemctl enable --now {UNIT} >/dev/null 2>&1
sleep 3
systemctl is-active -q {UNIT} || {{ echo "Kilit başlatılamadı:" >&2; tail -n 5 "$D/log" >&2; exit 4; }}
echo "__TITLE__ kilitlendi."
grep -E 'tutuldu|tutulamadı' "$D/log" | tail -n 12 | cut -d' ' -f2-
echo "I $(cd "$D" && ls keyboard mouse touch 2>/dev/null | xargs)"
"""

_UNLOCK = f"""
D={DIR}
rm -f "$D/__DEVICE__"
left=$(cd "$D" 2>/dev/null && ls keyboard mouse touch 2>/dev/null | xargs)
if [ -z "$left" ]; then
  systemctl disable --now {UNIT} >/dev/null 2>&1
  rm -f /etc/systemd/system/{UNIT}
  systemctl daemon-reload
  rm -rf "$D"
  echo "__TITLE__ kilidi açıldı; başka giriş kilidi yok."
else
  sleep 3
  echo "__TITLE__ kilidi açıldı. Süren kilitler: $left"
fi
echo "I $left"
"""

_TITLES = {"keyboard": "Klavye", "mouse": "Fare", "touch": "Dokunmatik"}


def apply(board: dict, user: str, password: str, device: str, lock: bool) -> dict:
    """Döner: {"status", "rc", "output"} (bkz. accounts._ssh); output'un son satırı "I <süren kilitler>"."""
    if device not in DEVICES:
        return {"status": "failed", "rc": None, "output": "Geçersiz aygıt."}
    script = _LOCK.replace("__DAEMON__", _DAEMON) if lock else _UNLOCK
    script = script.replace("__DEVICE__", device).replace("__TITLE__", _TITLES[device])
    return _ssh(board, user, password, script, timeout=30)


def parse(output: str) -> list[str]:
    """Betik çıktısındaki son "I …" satırından süren kilitler."""
    for line in reversed(output.splitlines()):
        if line == "I" or line.startswith("I "):
            return [d for d in line[1:].split() if d in DEVICES]
    return []


def store(conn, board_id: int, locks: list[str]) -> None:
    conn.execute("UPDATE boards SET input_locks = %s WHERE id = %s", (locks, board_id))
