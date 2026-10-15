"""Tahtadaki kullanıcı hesaplarını listeler ve seçilen hesapla tahtada grafik oturum açar.

Tahtalar/Ekranlar sağ menüsü "Oturum aç" (bkz. frontend ui/BoardOps.js loginMenu) iki görev türü kullanır:
  - "accounts": tek tahtadan hesap listesi (UID 1000-59999, kabuğu nologin/false olmayan yerel
    hesaplar; GECOS'un ilk alanı tam ad). Sonuç boards.facts'e (accounts + accounts_at) yazılır,
    CACHE_SECONDS boyunca aynı tahtaya tekrar bağlanılmaz. Çoklu seçimde menü listeyi ilk tahtadan alır.
  - "logout" ("Oturumu kapat"): seat0'daki kullanıcı oturumunu loginctl ile sonlandırır (kullanıcı adı
    verilirse o kullanıcının oturumunu — Oturumlar grid'i; verilmezse etkin olanı).
  - "lock" ("Oturumu kilitle"): LightDM'in Seat.Lock'u (= ETAP'ın `dm-tool lock`'u): kullanıcı oturumu
    ve süreçleri kendi VT'sinde AÇIK kalır, seat0'da giriş ekranı (greeter) açılır.
  - "login": LightDM'in tek seferlik otomatik oturumuyla (autologin) hesabı parolasız açar:
    /etc/lightdm/lightdm.conf.d'ye geçici bir autologin dosyası yazılır, lightdm yeniden başlatılır
    (yalnız seat0'da kullanıcı oturumu yokken), oturum görünür görünmez dosya silinir — tahta sonraki
    açılışında yine normal giriş ekranıyla gelir. Açık oturum varsa onun yerine kullanıcı değiştirilir
    (bkz. _LOGIN_SCRIPT notu) — mevcut oturum kapanmaz. ETAP'ta /etc/pam.d/lightdm-autologin
    yalnız root'u reddeder, parola istemez.

Kullanıcı adı betiğe metin olarak gömülür: hem API'de hem burada USERNAME_RE ile doğrulanır.
"""

from __future__ import annotations

import json
import os
import re
import subprocess

CACHE_SECONDS = 24 * 3600

USERNAME_RE = re.compile(r"^[a-z_][a-z0-9_.-]{0,31}$")

_LIST_SCRIPT = r"""
getent passwd | awk -F: '$3 >= 1000 && $3 < 60000 && $7 !~ /(nologin|false)$/ {split($5, g, ","); print $1 "\t" g[1]}'
"""

# seat0'daki kullanıcı oturumlarından birini seçer: U verilmişse onunkini, yoksa ETKİN olanı (birden çok
# oturum olabilir — kullanıcı değiştirilince öncekiler arka planda kalır), o da yoksa ilkini. Kilitliyken
# açılan giriş ekranı "lightdm" oturumudur, sayılmaz. Çıktı: "<oturum> <kullanıcı> <Active>" ya da boş.
_PICK_SESSION = r"""
pick_session() {
    first=""
    for s in $(loginctl list-sessions --no-legend 2>/dev/null | awk -v u="$1" '$4 == "seat0" && $3 != "lightdm" && (u == "" || $3 == u) {print $1}'); do
        n=$(loginctl show-session "$s" -p Name --value 2>/dev/null)
        a=$(loginctl show-session "$s" -p Active --value 2>/dev/null)
        [ "$a" = yes ] && { echo "$s $n yes"; return; }
        [ -z "$first" ] && first="$s $n no"
    done
    echo "$first"
}
"""

# loginctl list-sessions sütunları (systemd 252): SESSION UID USER SEAT TTY.
#
# İki yol:
#  - seat0'da kullanıcı oturumu YOKSA (yalnız giriş ekranı): tek seferlik autologin dosyası + lightdm
#    yeniden başlatma (kaybedilecek oturum yok).
#  - VARSA: "kullanıcı değiştir" — LightDM Seat.SwitchToUser; mevcut oturum(lar) ve süreçleri kendi
#    VT'sinde arka planda yaşamaya devam eder. SwitchToUser hedefin parolasını "lightdm" PAM servisiyle
#    sorar; parolasız geçiş için /etc/pam.d/lightdm'in başına (pam_nologin'den sonra) YALNIZ bu
#    kullanıcıya özel, "# tihamon-switch" işaretli geçici bir satır eklenir ve oturum etkinleşir
#    etkinleşmez silinir (trap + SSH koparsa bile 60 sn sonra silen bağımsız emniyet süreci).
#    Kullanıcı onayı: 2026-10-14.
_LOGIN_SCRIPT = _PICK_SESSION + r"""
set -u
U='{user}'
uid=$(id -u "$U" 2>/dev/null) || { echo "Hesap bulunamadı: $U"; exit 2; }
[ "$uid" -ge 1000 ] || { echo "Sistem hesabıyla oturum açılamaz: $U"; exit 2; }
active_of() {
    for s in $(loginctl list-sessions --no-legend 2>/dev/null | awk -v u="$1" '$3 == u && $4 == "seat0" {print $1}'); do
        [ "$(loginctl show-session "$s" -p Active --value 2>/dev/null)" = yes ] && { echo "$s"; return; }
    done
}
if [ -n "$(active_of "$U")" ]; then
    echo "$U zaten bu tahtada oturum açmış ve ekranda — bir şey yapılmadı."
    exit 0
fi
sess=$(awk -F= '/^(XSession|Session)=/ && $2 != "" {print $2; exit}' "/var/lib/AccountsService/users/$U" 2>/dev/null)
[ -n "$sess" ] && [ -e "/usr/share/xsessions/$sess.desktop" ] || sess=""

wait_active() {
    for i in $(seq 1 45); do
        s=$(active_of "$U")
        if [ -n "$s" ]; then
            echo "Oturum açıldı: $U (oturum $s, $i sn)."
            return 0
        fi
        sleep 1
    done
    echo "Oturum 45 sn içinde açılmadı — ayrıntı: /var/log/lightdm/lightdm.log"
    return 1
}

cur=$(pick_session '')
if [ -n "$cur" ]; then
    set -- $cur
    echo "Kullanıcı değiştiriliyor: $2 oturumu arka planda açık kalır (programları kapanmaz)."
    PAM=/etc/pam.d/lightdm
    seat=$(busctl --system tree --list org.freedesktop.DisplayManager 2>/dev/null | grep -m1 '/Seat[0-9]*$')
    [ -n "$seat" ] || { echo "LightDM D-Bus koltuğu bulunamadı (lightdm çalışıyor mu?)."; exit 1; }
    [ -f "$PAM" ] || { echo "$PAM bulunamadı."; exit 1; }
    unpatch() { sed -i '/# tihamon-switch$/d' "$PAM"; }
    unpatch
    trap unpatch EXIT HUP INT TERM
    setsid sh -c "sleep 60; sed -i '/# tihamon-switch\$/d' $PAM" >/dev/null 2>&1 </dev/null &
    sed -i "0,/^auth .*pam_nologin\.so.*/s//&\nauth [success=done default=ignore] pam_succeed_if.so quiet user = $U # tihamon-switch/" "$PAM"
    grep -q '# tihamon-switch$' "$PAM" || { echo "Parolasız geçiş hazırlanamadı ($PAM)."; exit 1; }
    busctl --system call org.freedesktop.DisplayManager "$seat" org.freedesktop.DisplayManager.Seat SwitchToUser ss "$U" "$sess" \
        || { echo "Kullanıcı değiştirilemedi (LightDM Seat.SwitchToUser)."; exit 1; }
    wait_active; rc=$?
    unpatch
    exit $rc
fi

CONF=/etc/lightdm/lightdm.conf.d/99-tihamon-oturum-ac.conf
mkdir -p /etc/lightdm/lightdm.conf.d
{
    echo "[Seat:*]"
    echo "autologin-user=$U"
    echo "autologin-user-timeout=0"
    [ -n "$sess" ] && echo "autologin-session=$sess"
} > "$CONF"
trap 'rm -f "$CONF"' EXIT
echo "Giriş yöneticisi (lightdm) yeniden başlatılıyor, $U için otomatik oturum açılıyor…"
systemctl restart lightdm || { echo "lightdm yeniden başlatılamadı."; exit 1; }
wait_active
"""

# "Oturumu kapat": seçilen kullanıcı oturumunu sonlandırır; etkin oturumsa lightdm giriş ekranına döner.
# Çıktının İLK satırı kapatılan kullanıcının adıdır (yoksa boş) — arayüz önizleme kutucuğunda bunu kullanır.
_LOGOUT_SCRIPT = _PICK_SESSION + r"""
set -u
line=$(pick_session '{user}')
if [ -z "$line" ]; then
    echo ""
    echo "Açık kullanıcı oturumu yok — bir şey yapılmadı."
    exit 0
fi
set -- $line
s=$1
u=$2
echo "$u"
loginctl terminate-session "$s" || { echo "Oturum sonlandırılamadı (loginctl terminate-session $s)."; exit 1; }
for i in $(seq 1 20); do
    st=$(loginctl show-session "$s" -p State --value 2>/dev/null)
    if [ -z "$st" ] || [ "$st" = closing ]; then
        echo "Oturum kapatıldı: $u (oturum $s, ${i} sn)."
        exit 0
    fi
    sleep 1
done
echo "Oturum 20 sn içinde kapanmadı: $u (oturum $s)."
exit 1
"""

# "Oturumu kilitle": LightDM Seat.Lock (ETAP'ta `dm-tool lock` ile aynı; dm-tool XDG_SEAT_PATH ister,
# SSH'de yok — doğrudan D-Bus). Oturum AÇIK kalır, seat0'da greeter etkinleşir. Çıktının İLK satırı
# kilitlenen kullanıcının adıdır (yoksa boş).
_LOCK_SCRIPT = _PICK_SESSION + r"""
set -u
line=$(pick_session '{user}')
if [ -z "$line" ]; then
    echo ""
    echo "Açık kullanıcı oturumu yok — bir şey yapılmadı."
    exit 0
fi
set -- $line
s=$1
u=$2
echo "$u"
if [ "$3" != yes ]; then
    echo "$u oturumu zaten etkin değil (ekran kilitli ya da başka kullanıcıya geçilmiş) — bir şey yapılmadı."
    exit 0
fi
seat=$(busctl --system tree --list org.freedesktop.DisplayManager 2>/dev/null | grep -m1 '/Seat[0-9]*$')
[ -n "$seat" ] || { echo "LightDM D-Bus koltuğu bulunamadı (lightdm çalışıyor mu?)."; exit 1; }
busctl --system call org.freedesktop.DisplayManager "$seat" org.freedesktop.DisplayManager.Seat Lock \
    || { echo "Kilitlenemedi (LightDM Seat.Lock)."; exit 1; }
for i in $(seq 1 15); do
    if [ "$(loginctl show-session "$s" -p Active --value 2>/dev/null)" != yes ]; then
        echo "Oturum kilitlendi: $u (oturum açık kalır, tahta giriş ekranında; ${i} sn)."
        exit 0
    fi
    sleep 1
done
echo "Oturum 15 sn içinde kilitlenmedi: $u (oturum $s)."
exit 1
"""

_SSH_OPTS = [
    "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
]


def _ssh(board: dict, user: str, password: str, script: str, timeout: int) -> dict:
    if not board.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, "-o", f"ConnectTimeout={min(timeout, 8)}",
           f"{user}@{board['ip']}", script]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"status": "failed", "rc": None, "output": f"Zaman aşımı ({timeout} sn)."}
    out = proc.stdout.decode("utf-8", "replace").strip()
    if proc.returncode == 5:
        return {"status": "unreachable", "rc": 5, "output": "SSH parolası reddedildi."}
    if proc.returncode == 255:
        err = proc.stderr.decode("utf-8", "replace").strip()
        return {"status": "unreachable", "rc": 255, "output": err or "SSH bağlantısı kurulamadı."}
    return {"status": "ok" if proc.returncode == 0 else "failed", "rc": proc.returncode, "output": out}


def list_accounts(board: dict, user: str, password: str) -> dict:
    """Döner: {"status", "rc", "output"} — başarılıysa output [{name, full_name}] JSON'u (ada göre sıralı)."""
    res = _ssh(board, user, password, _LIST_SCRIPT, timeout=15)
    if res["status"] != "ok":
        return res
    accounts = []
    for line in res["output"].splitlines():
        name, _, full = line.partition("\t")
        if USERNAME_RE.match(name):
            accounts.append({"name": name, "full_name": full.strip() or None})
    accounts.sort(key=lambda a: (a["full_name"] or a["name"]).casefold())
    return {"status": "ok", "rc": 0, "output": json.dumps(accounts, ensure_ascii=False)}


def cached(conn, board_id: int, cutoff_ts: int) -> list | None:
    row = conn.execute("SELECT facts FROM boards WHERE id = %s", (board_id,)).fetchone()
    facts = (row or {}).get("facts") or {}
    if (facts.get("accounts_at") or 0) < cutoff_ts or not isinstance(facts.get("accounts"), list):
        return None
    return facts["accounts"]


def store(conn, board_id: int, accounts: list, ts: int) -> None:
    conn.execute("UPDATE boards SET facts = facts || %s::jsonb WHERE id = %s",
                 (json.dumps({"accounts": accounts, "accounts_at": ts}, ensure_ascii=False), board_id))


def login(board: dict, user: str, password: str, username: str) -> dict:
    if not USERNAME_RE.match(username or ""):
        return {"status": "failed", "rc": None, "output": "Geçersiz kullanıcı adı."}
    return _ssh(board, user, password, _LOGIN_SCRIPT.replace("{user}", username), timeout=75)


def _target(username: str | None) -> str | None:
    """Kullanıcı adı betiğe gömülür: boş (= etkin oturum) ya da USERNAME_RE'ye uyan bir ad; değilse None."""
    username = username or ""
    return username if not username or USERNAME_RE.match(username) else None


def logout(board: dict, user: str, password: str, username: str | None = None) -> dict:
    target = _target(username)
    if target is None:
        return {"status": "failed", "rc": None, "output": "Geçersiz kullanıcı adı."}
    return _ssh(board, user, password, _LOGOUT_SCRIPT.replace("{user}", target), timeout=40)


def lock(board: dict, user: str, password: str, username: str | None = None) -> dict:
    target = _target(username)
    if target is None:
        return {"status": "failed", "rc": None, "output": "Geçersiz kullanıcı adı."}
    return _ssh(board, user, password, _LOCK_SCRIPT.replace("{user}", target), timeout=30)
