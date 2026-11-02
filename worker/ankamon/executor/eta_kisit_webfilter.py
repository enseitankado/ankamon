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

"""Sağ menü "Web Filtre": ETAP Pardus'taki eta-kisit (Sınırlı Erişim) uygulamasıyla kara/beyaz liste ve DNS sayımı.

Filtreyi eta-kisit uygular: profil ProfileManager ile yazılır, etkinleştirme ETAKisitActivator ile yapılır; o da smartdns-rs
yapılandırmasını, /etc/resolv.conf'u ve tarayıcı policy dosyalarını üretir. Bu modül kendi filtresini yazmaz.

eta-kisit'e eklenen iki şey:
- Sayım: eta-kisit smartdns.conf'u her seferinde yeniden ürettiğinden denetim (audit) satırları servis başlarken eklenir
  (smartdns-rs.service.d drop-in, ExecStartPre). smartdns root yetkisini bırakıp nobody olur: denetim dizini nobody'nin.
- "ogrenci" hesabı olmayan tahta: eta-kisit bu hesap yoksa daha içe aktarılırken KeyError ile düşer (Arge 1'de görüldü).
  Etkinleştirici, yalnız pwd.getpwnam("ogrenci") nobody'ye düşecek biçimde çalıştırılır; hesap açılmaz.
- "ogrenci" hesabı olan tahta: eta-kisit.service oturumu loginctl'den izler ve root SSH bağlantısını "oturum yok" sayar. Ankamon'un
  her bağlantısı kapanınca `eta-kisit --user-login ogrenci` yeniden çalışır: öğrencinin tarayıcıları KILL ile kapanır, bildirim
  çıkar (Arge 1'de ölçüldü). Serviste PATH önüne konan küçük sarmalayıcı, aynı kullanıcı için tekrarlanan çağrıyı atlar.

Filtre kapatılınca tahta ilk etkinleştirmeden önceki hâline döner: eta-kisit'in sildiği smartdns.conf ve biçimini değiştirdiği
Firefox policies.json geri konur, oluşturduğu boş policy dizinleri, drop-in ve denetim kayıtları silinir.

Program tahtaya stdin ile gider, parametreler base64 JSON'dur: alan adı kabuğa ya da Python koduna metin olarak girmez.
NetworkManager yeniden başlarken SSH kopabileceğinden değişiklik tahtada ayrı oturumda çalışır, sonuç dosyasından okunur.
"""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import subprocess
import time

from .accounts import _SSH_OPTS, _ssh

# JobsApi::webFilterJob ve frontend EtaKisitWebFilter ile AYNI kural: en az iki etiket, son etiket harfle başlar.
DOMAIN_RE = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$")
MODES = ("off", "denylist", "allowlist")
MAX_DOMAINS = 500

_APPLY_WAIT = 150  # tahtadaki işlemin üst sınırı (sn)

_BOARD_PROGRAM = r'''
import base64, fcntl, glob, gzip, json, os, re, shutil, subprocess, sys, time

P = json.loads(base64.b64decode("__PARAMS__"))
SRC = "/usr/share/eta/eta-kisit/src"
ACT = SRC + "/ETAKisitActivator.py"
PROFILES = "/var/lib/eta/eta-kisit/profiles.json"
APPLIED = "/var/lib/eta/eta-kisit/applied_profile.lock.json"
SMARTDNS_CONF = "/etc/smartdns/smartdns.conf"
RESOLV = "/etc/resolv.conf"
FIREFOX_POLICY = "/usr/share/firefox-esr/distribution/policies.json"
POLICY_DIRS = ["/etc/opt/chrome/policies/managed", "/etc/brave/policies/managed", "/etc/chromium/policies/managed",
               "/etc/chromium-browser/policies/managed"]
STATE_DIR = "/var/lib/ankamon-webfilter"
STATE = STATE_DIR + "/ilk-durum.json"
AUDIT_LINES = STATE_DIR + "/denetim-satirlari.conf"
AUDIT_DIR = "/var/log/ankamon-webfilter"
DROPIN_DIR = "/etc/systemd/system/smartdns-rs.service.d"
DROPIN = DROPIN_DIR + "/ankamon-webfilter.conf"
SERVICE_DROPIN_DIR = "/etc/systemd/system/eta-kisit.service.d"
SERVICE_DROPIN = SERVICE_DROPIN_DIR + "/ankamon-webfilter.conf"
SERVICE_DROPIN_TEXT = """[Service]
Environment=PATH=%s/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
""" % STATE_DIR
LAST_LOGIN = "/run/ankamon-webfilter-son-oturum"
LOGIN_WRAPPER = STATE_DIR + "/bin/eta-kisit"
LOGIN_WRAPPER_TEXT = """#!/bin/sh
# Ankamon Web Filtre: root SSH bitince gelen ayni kullanici cagrisi ogrencinin tarayicilarini kapatmasin.
if [ "$1" = --user-login ]; then
    [ "$(cat %s 2>/dev/null)" = "$2" ] && exit 0
    printf '%%s' "$2" > %s
fi
exec /usr/bin/eta-kisit "$@"
""" % (LAST_LOGIN, LAST_LOGIN)
# Tahtada en çok ~8 MB denetim kaydı: 2 MB'ta döner, audit-num 4 = geçerli + 3 eski (eskisi silinir, Arge 1'de görüldü).
AUDIT_CONF = """
# Ankamon Web Filtre sayimi
audit-enable yes
audit-file %s/denetim.log
audit-size 2m
audit-num 4
audit-SOA yes
""" % AUDIT_DIR
DROPIN_TEXT = """[Service]
ExecStartPre=-/bin/sh -c 'install -d -o nobody -g nogroup -m 750 %s; grep -q eta-kisit %s && ! grep -q "^audit-enable" %s && cat %s >> %s; exit 0'
""" % (AUDIT_DIR, SMARTDNS_CONF, SMARTDNS_CONF, AUDIT_LINES, SMARTDNS_CONF)

# Etkinleştirici ve ProfileManager, ogrenci hesabı yoksa içe aktarılırken düşer: yalnız o ad nobody'ye düşürülür.
PWD_SHIM = """
import pwd, sys
_getpwnam = pwd.getpwnam
def _getpwnam_ogrencisiz(name):
    try:
        return _getpwnam(name)
    except KeyError:
        if name == "ogrenci":
            return _getpwnam("nobody")
        raise
pwd.getpwnam = _getpwnam_ogrencisiz
sys.path.insert(0, %r)
""" % SRC
PROFILE_EDIT = PWD_SHIM + """
import json
from managers import ProfileManager
req = json.load(sys.stdin)
pm = ProfileManager.get_default()
profile = pm.get_current_profile()
if profile.get_is_default():
    sys.exit(3)
profile.set_website_restriction_type(req["type"])
if req.get("denylist") is not None:
    profile.set_website_denylist(req["denylist"])
if req.get("allowlist") is not None:
    profile.set_website_allowlist(req["allowlist"])
pm.save_as_json_file()
print(profile.get_application_restriction_type())
"""
ACTIVATOR_RUN = PWD_SHIM + """
import runpy
sys.argv = [%r] + sys.argv[1:]
runpy.run_path(%r, run_name="__main__")
""" % (ACT, ACT)


def run(args, stdin=None, timeout=90):
    try:
        p = subprocess.run(args, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout)
        return p.returncode, p.stdout
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, str(e)


def read_text(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def has_ogrenci():
    return run(["getent", "passwd", "ogrenci"])[0] == 0


def unsupported():
    if "etap" not in (read_text("/etc/os-release") or "").lower():
        return "not_etap"
    if not os.path.exists(ACT) or not os.path.exists("/usr/sbin/smartdns"):
        return "no_eta_kisit"
    return None


def seat_session():
    """seat0'daki etkin kullanıcı oturumu (giriş ekranı ve SSH oturumları sayılmaz)."""
    for line in run(["loginctl", "list-sessions", "--no-legend"])[1].splitlines():
        cols = line.split()
        if "seat0" not in cols:
            continue
        rc, out = run(["loginctl", "show-session", cols[0], "-p", "Active", "-p", "Name", "-p", "Class"])
        info = dict(x.split("=", 1) for x in out.splitlines() if "=" in x)
        if info.get("Active") == "yes" and info.get("Class") == "user" and info.get("Name") != "lightdm":
            return info.get("Name")
    return None


def activator(*flags):
    rc, out = run(["python3", "-B", "-c", ACTIVATOR_RUN, *flags], timeout=100)
    return rc, out


def smartdns_answers():
    # dig yanıt alamazsa 9 döner; engelli ya da boş yanıt sunucunun çalıştığını gösterir.
    return run(["dig", "+short", "+time=2", "+tries=1", "@127.0.0.1", "etap.org.tr", "A"], timeout=8)[0] == 0


def filter_active():
    return "eta-kisit" in (read_text(RESOLV) or "") and run(["pgrep", "-x", "smartdns"])[0] == 0


def count_audit(listed):
    """Listedeki her alan adı (alt alan adları dahil) için ziyaret/engel sayısı; yalnız A sorguları.

    AAAA'yı eta-kisit her zaman SOA ile yanıtlar (force-AAAA-SOA): sayılsa her sorgu engel görünürdü. Kaynak portu 0 olan
    satırlar smartdns'in kendi arka plan sorgularıdır. smartdns-rs 0.12.2 kaydı onar onar yazar, zaman aşımıyla yazmaz, servis
    dururken bekleyenleri atar (Arge 1'de ölçüldü): son en çok 9 sorgu görünmeyebilir.
    """
    line_re = re.compile(r"^\[([^\]]+)\] (\S+) query (\S+?)\.?, type: (\S+), .*?result (.*)$")
    counts = {d: {"visits": 0, "blocked": 0} for d in listed}
    other = {}
    since = None
    files = sorted(glob.glob(AUDIT_DIR + "/denetim*"), key=os.path.getmtime)
    for path in files:
        opener = gzip.open if path.endswith(".gz") else open
        try:
            with opener(path, "rt", encoding="utf-8", errors="replace") as f:
                for line in f:
                    m = line_re.match(line.strip())
                    if not m or m.group(4) != "A" or m.group(2).endswith(":0"):
                        continue
                    if not m.group(2).startswith(("127.", "[::1]", "[::ffff:127.")):
                        continue
                    since = since or m.group(1)
                    name = m.group(3).lower()
                    blocked = m.group(5).endswith(" SOA")
                    visited = not blocked and m.group(5) != "query failed"
                    labels = name.split(".")
                    match = next((".".join(labels[i:]) for i in range(len(labels)) if ".".join(labels[i:]) in counts), None)
                    if match:
                        counts[match]["blocked" if blocked else "visits"] += 1 if (blocked or visited) else 0
                    elif blocked:
                        other[name] = other.get(name, 0) + 1
        except OSError:
            pass
    top = sorted(other.items(), key=lambda kv: -kv[1])[:30]
    return counts, [{"domain": d, "blocked": n} for d, n in top], since


def status():
    reason = unsupported()
    if reason:
        return {"reason": reason}
    data = json.loads(read_text(PROFILES) or "null") or {"current_profile": "", "profile_list": {}}
    name = data.get("current_profile", "")
    profile = data.get("profile_list", {}).get(name, {})
    web = profile.get("website", {})
    applied = json.loads(read_text(APPLIED) or "null")
    deny, allow = web.get("denylist", []), web.get("allowlist", [])
    counts, other, since = count_audit(sorted(set(deny) | set(allow)))
    rc, version = run(["dpkg-query", "-W", "-f=${Version}", "eta-kisit"])
    return {
        "reason": None, "version": version if rc == 0 else "", "ogrenci": has_ogrenci(), "session": seat_session(),
        "profile": name, "locked": bool(profile.get("is_default")),
        "mode": web.get("restriction_type", "none"), "denylist": deny, "allowlist": allow,
        "applied_mode": applied.get("website", {}).get("restriction_type") if applied else None,
        "active": filter_active(), "counting": os.path.exists(DROPIN),
        "counts": counts, "other_blocked": other, "since": since,
    }


def first_missing_ancestor(path):
    top = None
    while path != "/" and not os.path.exists(path):
        top, path = path, os.path.dirname(path)
    return top


def save_first_state():
    """Tahtayı kapatınca geri dönülecek durum; yalnız ilk etkinleştirmede, filtre yokken alınır."""
    if os.path.exists(STATE):
        return
    os.makedirs(STATE_DIR, exist_ok=True)
    resolv = read_text(RESOLV)
    state = {
        "firefox": read_text(FIREFOX_POLICY),
        "resolv": None if "eta-kisit" in (resolv or "") else resolv,
        "created_dirs": {d: first_missing_ancestor(d) for d in POLICY_DIRS if not os.path.exists(d)},
        "rc_links": bool(glob.glob("/etc/rc?.d/*smartdns-rs")),
    }
    with open(STATE + ".tmp", "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(STATE + ".tmp", STATE)


def install_counting():
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(AUDIT_LINES, "w", encoding="utf-8") as f:
        f.write(AUDIT_CONF)
    if read_text(DROPIN) != DROPIN_TEXT:
        os.makedirs(DROPIN_DIR, exist_ok=True)
        with open(DROPIN, "w", encoding="utf-8") as f:
            f.write(DROPIN_TEXT)
        run(["systemctl", "daemon-reload"])


def write_if_changed(path, text, mode=0o644):
    if read_text(path) == text:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(path, mode)
    return True


def install_login_wrapper():
    wrapper = write_if_changed(LOGIN_WRAPPER, LOGIN_WRAPPER_TEXT, 0o755)
    if write_if_changed(SERVICE_DROPIN, SERVICE_DROPIN_TEXT) or wrapper:
        run(["systemctl", "daemon-reload"])
        run(["systemctl", "restart", "eta-kisit.service"])


def note_session(session):
    """Sarmalayıcıya o anki oturum: yeni kuralı bu oturum için bir daha eta-kisit'e çalıştırtmaz."""
    if session:
        with open(LAST_LOGIN, "w") as f:
            f.write(session)
    elif os.path.exists(LAST_LOGIN):
        os.remove(LAST_LOGIN)


def wait_resolv(state):
    """--unrestrict resolv.conf'u siler, NetworkManager yeniden üretir; üretmezse ilk içerik yazılır."""
    for _ in range(30):
        if os.path.exists(RESOLV):
            return
        time.sleep(0.5)
    if state.get("resolv"):
        with open(RESOLV, "w", encoding="utf-8") as f:
            f.write(state["resolv"])


def restore_first_state():
    state = json.loads(read_text(STATE) or "{}")
    wait_resolv(state)
    if state.get("rc_links") is False:
        run(["update-rc.d", "-f", "smartdns-rs", "remove"])  # systemctl disable K01 bağları bırakır
    if not os.path.exists(SMARTDNS_CONF) and os.path.exists(SMARTDNS_CONF + ".default"):
        shutil.copy2(SMARTDNS_CONF + ".default", SMARTDNS_CONF)
    if state.get("firefox") is not None:
        with open(FIREFOX_POLICY, "w", encoding="utf-8") as f:
            f.write(state["firefox"])
    for leaf, top in (state.get("created_dirs") or {}).items():
        path = leaf
        while top and path.startswith(top):
            try:
                os.rmdir(path)
            except OSError:
                break
            path = os.path.dirname(path)
    if os.path.exists(DROPIN):
        os.remove(DROPIN)
        try:
            os.rmdir(DROPIN_DIR)
        except OSError:
            pass
        run(["systemctl", "daemon-reload"])
    if os.path.exists(SERVICE_DROPIN):
        os.remove(SERVICE_DROPIN)
        try:
            os.rmdir(SERVICE_DROPIN_DIR)
        except OSError:
            pass
        run(["systemctl", "daemon-reload"])
        run(["systemctl", "restart", "eta-kisit.service"])
    if os.path.exists(LAST_LOGIN):
        os.remove(LAST_LOGIN)
    shutil.rmtree(AUDIT_DIR, ignore_errors=True)
    shutil.rmtree(STATE_DIR, ignore_errors=True)


def edit_profile(mode):
    req = {"type": "none" if mode == "off" else mode, "denylist": P.get("denylist"), "allowlist": P.get("allowlist")}
    os.makedirs(os.path.dirname(PROFILES), exist_ok=True)
    return run(["python3", "-B", "-c", PROFILE_EDIT], stdin=json.dumps(req))


def apply_filter():
    reason = unsupported()
    if reason:
        return {"ok": False, "lines": ["Bu tahta ETAP Pardus değil; Web Filtre uygulanmadı." if reason == "not_etap"
                                       else "eta-kisit kurulu değil; Web Filtre uygulanmadı."]}
    mode = P["mode"]
    lines = []
    was_applied = os.path.exists(APPLIED)
    if mode != "off" and not was_applied:
        save_first_state()
    rc, out = edit_profile(mode)
    if rc == 3:
        return {"ok": False, "lines": ["Etkin eta-kisit profili merkezden (Lider Ahenk) yönetiliyor; değiştirilmedi."]}
    if rc != 0:
        return {"ok": False, "lines": ["Profil yazılamadı: " + out.strip()[-300:]]}
    app_restriction = out.strip().splitlines()[-1] if out.strip() else "none"
    if was_applied:
        # set_network_filter açık filtreyi yeniden yazmaz: liste değişikliği için önce kapatılır.
        rc, out = activator("--unrestrict")
        if rc != 0:
            return {"ok": False, "lines": ["eta-kisit kapatılamadı: " + out.strip()[-300:]]}
        wait_resolv(json.loads(read_text(STATE) or "{}"))
    if mode == "off":
        if app_restriction != "none":
            rc, out = activator("--restrict")  # uygulama kısıtı web filtresiyle kapanmasın
            if rc != 0:
                lines.append("Uygulama kısıtı yeniden etkinleştirilemedi: " + out.strip()[-300:])
        restore_first_state()
        lines.append("Web Filtre kapatıldı; sayım kayıtları silindi.")
        return {"ok": rc == 0, "lines": lines}
    install_counting()
    rc, out = activator("--restrict")
    if rc != 0:
        return {"ok": False, "lines": ["eta-kisit etkinleştirilemedi: " + out.strip()[-300:]]}
    label = "Kara liste" if mode == "denylist" else "Beyaz liste"
    session = seat_session()
    if has_ogrenci():
        note_session(session)
        install_login_wrapper()
    if has_ogrenci() and session not in (None, "ogrenci"):
        # eta-kisit filtreyi ogrenci dışındaki oturumda kaldırır; kendi arayüzü de ogrenci oturumunu bekler.
        return {"ok": True, "lines": [f"{label} kaydedildi. Şu an {session} oturumu açık: ogrenci oturumu açılınca devreye girer."]}
    rc, out = activator("--enable-websites-restriction")
    if rc == 0:
        for _ in range(16):
            if filter_active() and smartdns_answers():
                break
            time.sleep(0.5)
        else:
            rc, out = 1, "smartdns yanıt vermiyor"
    if rc != 0:
        # DNS tahtayı internetsiz bırakmasın: filtre geri alınır.
        activator("--unrestrict")
        wait_resolv(json.loads(read_text(STATE) or "{}"))
        return {"ok": False, "lines": ["Filtre devreye alınamadı, geri alındı: " + out.strip()[-300:]]}
    lines.append(f"{label} devrede.")
    return {"ok": True, "lines": lines}


def detached_apply():
    """Değişiklik SSH oturumundan bağımsız çalışır; sonuç /run altındaki dosyada, üst süreç bekleyip yazdırır."""
    result = "/run/ankamon-webfilter-%s.json" % P["run_id"]
    pid = os.fork()
    if pid == 0:
        os.setsid()
        fd = os.open(os.devnull, os.O_RDWR)
        for std in (0, 1, 2):
            os.dup2(fd, std)
        with open("/run/ankamon-webfilter.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                res = apply_filter()
            except Exception as e:
                res = {"ok": False, "lines": ["Hata: %s" % e]}
        if P["mode"] == "off":
            try:
                os.remove("/run/ankamon-webfilter.lock")
            except OSError:
                pass
        with open(result + ".tmp", "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
        os.replace(result + ".tmp", result)
        os._exit(0)
    end = time.time() + int(P["wait"])
    while time.time() < end:
        if os.path.exists(result):
            print(read_text(result))
            os.remove(result)
            return
        time.sleep(0.5)
    sys.exit(75)


if P["op"] == "status":
    print(json.dumps(status(), ensure_ascii=False))
else:
    detached_apply()
'''


def _send(board: dict, user: str, password: str, params: dict, timeout: int) -> dict:
    """Programı stdin ile tahtadaki python3'e verir. Döner: {"status", "rc", "output"} (bkz. accounts._ssh)."""
    if not board.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    encoded = base64.b64encode(json.dumps(params).encode()).decode()
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, "-o", "ConnectTimeout=8", f"{user}@{board['ip']}", "python3 -B -"]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    try:
        proc = subprocess.run(cmd, input=_BOARD_PROGRAM.replace("__PARAMS__", encoded).encode(),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"status": "failed", "rc": None, "output": f"Zaman aşımı ({timeout} sn)."}
    out = proc.stdout.decode("utf-8", "replace").strip()
    if proc.returncode == 5:
        return {"status": "unreachable", "rc": 5, "output": "SSH parolası reddedildi."}
    if proc.returncode == 255:
        return {"status": "unreachable", "rc": 255, "output": proc.stderr.decode("utf-8", "replace").strip() or "SSH bağlantısı kurulamadı."}
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace").strip()
        return {"status": "failed", "rc": proc.returncode, "output": (out + "\n" + err).strip()[-1000:]}
    return {"status": "ok", "rc": 0, "output": out}


def clean_domains(domains) -> list[str] | None:
    """Küçük harf, tekrarsız, sıra korunur; geçersiz alan adı varsa None."""
    seen = []
    for domain in domains or []:
        if not isinstance(domain, str):
            return None
        domain = domain.strip().lower()
        if not DOMAIN_RE.match(domain):
            return None
        if domain not in seen:
            seen.append(domain)
    return seen if len(seen) <= MAX_DOMAINS else None


def read_status(board: dict, user: str, password: str) -> dict:
    """Tahtadaki profil, filtre durumu ve sayımlar; başarılıysa output JSON."""
    return _send(board, user, password, {"op": "status"}, timeout=40)


def _reattach(board: dict, user: str, password: str, run_id: str) -> dict:
    """SSH koptuysa tahtadaki işlem sürer: yeni bağlantıyla sonuç dosyası beklenir."""
    path = f"/run/ankamon-webfilter-{run_id}.json"
    end = time.time() + _APPLY_WAIT
    last = None
    unreachable = 0
    while time.time() < end:
        last = _ssh(board, user, password, f"cat {path} 2>/dev/null && rm -f {path}", timeout=15)
        if last["status"] == "ok" and last["output"]:
            return last
        unreachable = unreachable + 1 if last["status"] == "unreachable" else 0
        if unreachable >= 3:  # NetworkManager'ın yeniden başlaması bu kadar sürmez: tahta kapalı
            return last
        time.sleep(3)
    return last or {"status": "failed", "rc": None, "output": "Sonuç okunamadı."}


def apply(board: dict, user: str, password: str, mode: str, denylist, allowlist) -> dict:
    """Modu ve listeleri uygular; output kullanıcıya gösterilen metin. Liste None ise tahtadaki liste korunur."""
    if mode not in MODES:
        return {"status": "failed", "rc": None, "output": "Geçersiz mod."}
    deny = None if denylist is None else clean_domains(denylist)
    allow = None if allowlist is None else clean_domains(allowlist)
    if (denylist is not None and deny is None) or (allowlist is not None and allow is None):
        return {"status": "failed", "rc": None, "output": "Geçersiz alan adı."}
    if mode != "off" and not (deny if mode == "denylist" else allow):
        return {"status": "failed", "rc": None, "output": "Adres listesi boş."}
    if not board.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    run_id = secrets.token_hex(8)
    res = _send(board, user, password, {"op": "apply", "mode": mode, "denylist": deny, "allowlist": allow,
                                        "run_id": run_id, "wait": _APPLY_WAIT}, timeout=_APPLY_WAIT + 20)
    if res["rc"] == 255 or res["rc"] is None:
        res = _reattach(board, user, password, run_id)
    if res["status"] != "ok":
        return res
    try:
        data = json.loads(res["output"])
    except ValueError:
        return {"status": "failed", "rc": None, "output": res["output"][-1000:]}
    text = "\n".join(data.get("lines") or [])
    return {"status": "ok" if data.get("ok") else "failed", "rc": 0 if data.get("ok") else 1, "output": text}
