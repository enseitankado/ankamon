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

"""Log satırı → oturum hareketi: hangi mesaj kullanıcının yaptığı (ya da başına gelen) bir olaydır.

Tahta logları her uygulama açılışını kaydetmez; buradaki liste canlı loglardan çıkarıldı (2026-11-02): kullanıcı/oturum hareketi
anlamı taşıyan her şey alınır. Bilerek ALINMAYANLAR (gürültü, ayrıntı için kurallara bakın): systemd, rsyslogd, pam-script,
pam_sm_*, rtkit-daemon, gnome-keyring-daemon, cinnamon-session/x-session-manager, avahi-daemon, runuser (root otomasyonu),
root'un sudo/su/CRON'ları, otomatik işler (_AUTOMATED), sshd'nin Ankamon bağlantıları, açılıştaki USB sıralaması.
classify(program, message) -> (tür, özet, olayı yapan kullanıcı|None) ya da None.

Sıradan kabuk komutları syslog'a gitmez ve bilerek toplanmaz (kullanıcı kararı): tahtalara komut kancası kurulmaz, yalnız
logda olan yetkili komutlar (sudo, pkexec, su) görünür.
"""

from __future__ import annotations

import re

KINDS = {
    "oturum": "Oturum", "yetki": "Yetki", "usb": "USB", "ag": "Ağ", "uygulama": "Uygulama", "ssh": "SSH",
    "guc": "Güç", "hesap": "Hesap", "sistem": "Sistem", "komut": "Komut", "ankamon": "Ankamon", "sensor": "Sensör",
}

# Log gönderen uygulamalar: oturumda ilk görüldüğünde "açıldı" sayılır (bkz. tasks/session_activity.py).
APP_PROGRAMS = {
    "chrome": "Google Chrome", "chromium": "Chromium", "firefox": "Firefox", "firefox-esr": "Firefox", "vlc": "VLC",
    "soffice.bin": "LibreOffice", "libreoffice": "LibreOffice", "gimp": "GIMP", "inkscape": "Inkscape",
    "openboard": "OpenBoard", "OpenBoard": "OpenBoard", "evince": "Belge görüntüleyici",
}

_AUTOMATED = re.compile(r"AutoAptUpdat|ahenk_debug|tiha-|/opt/ankamon")
# Yetki yükseltme reddi: 028_local_command_log.sql ile aynı metinler.
_SUDO_DENIED = re.compile(r"incorrect password|NOT in sudoers|command not allowed|a password is required")
_SUDO = re.compile(r"^(\S+) : (.*?)USER=(\S+) ; (?:ENV=.*? ; )?COMMAND=(.*)$")
_PKEXEC = re.compile(r"^(\S+): Executing command .*COMMAND=([^\]]*)\]?")
_PKEXEC_DENIED = re.compile(r"^(\S+): Error executing command .*COMMAND=([^\]]*)\]?")
_POLKIT_FAILED = re.compile(r"^Operator of \S+ FAILED to authenticate to gain authorization for action \S+ for \S+ \[(.*)\] "
                            r"\(owned by unix-user:([^)]+)\)")
_POLKIT_OK = re.compile(r"^Operator of \S+ successfully authenticated as unix-user:(\S+) to gain \S+ authorization for action "
                        r"\S+ for \S+ \[(.*)\] \(owned by unix-user:([^)]+)\)")
_DBUS_APP = re.compile(r"^\[session uid=\d+ pid=\d+\] Activating service name='([^']+)'")
_DBUS_SKIP = re.compile(r"^(org\.freedesktop|org\.gtk|org\.a11y|ca\.desrt|org\.cinnamon|org\.gnome\.keyring|com\.canonical)")
_KERNEL_UPTIME = re.compile(r"^\[\s*(\d+)\.\d+\]")
_BOOT_SECONDS = 60       # açılışta sıralanan dahili USB aygıtları takma/çıkarma hareketi değildir

# Hesap değişiklikleri (shadow-utils ileti metinleri): program → [(desen, özet, kullanıcı grubu)]. Bilerek dışarıda: chpasswd
# "new password not acceptable" (tiha-boot-password-wipe gürültüsü), userdel "delete 'x' from group" (hesap silinince zaten olur),
# useradd "new group" (hesapla birlikte açılan grup), groupadd "group added to /etc/..." (aynı olayın dosya satırları).
_ACCOUNT = {
    "useradd": [(r"new user: name=([^,]+)", "Hesap açıldı: {0}", None)],
    "userdel": [(r"delete user '([^']+)'", "Hesap silindi: {0}", None)],
    "passwd": [(r".*password changed for (\S+)", "Parola değiştirildi: {0}", 1)],
    "chpasswd": [(r".*password changed for (\S+)", "Parola değiştirildi: {0}", 1)],
    "usermod": [
        (r"change user name '([^']+)' to '([^']+)'", "Hesap adı değişti: {0} → {1}", 2),
        (r"change user '([^']+)' password", "Parola değiştirildi: {0}", 1),
        (r"change user '([^']+)' shell", "Hesap kabuğu değişti: {0}", 1),
        (r"change user '([^']+)' home", "Ev dizini değişti: {0}", 1),
        (r"change user '([^']+)' expiration", "Hesap süresi değişti: {0}", 1),
        (r"lock user '([^']+)' password", "Hesap kilitlendi: {0}", 1),
        (r"unlock user '([^']+)' password", "Hesap kilidi açıldı: {0}", 1),
        (r"add '([^']+)' to group '([^']+)'", "Gruba eklendi: {0} → {1}", 1),
    ],
    "groupadd": [(r"new group: name=([^,]+)", "Grup açıldı: {0}", None)],
    "groupdel": [(r"group '([^']+)' removed$", "Grup silindi: {0}", None)],
    "gpasswd": [
        (r"user '?([^' ]+)'? added by \S+ to group '?([^' ]+)'?", "Gruba eklendi: {0} → {1}", 1),
        (r"user '?([^' ]+)'? removed by \S+ from group '?([^' ]+)'?", "Gruptan çıkarıldı: {0} → {1}", 1),
    ],
    "chage": [(r"changed password expiry for (\S+)", "Parola süresi değişti: {0}", 1)],
    "chfn": [(r"changed user '([^']+)' information", "Hesap bilgileri değişti: {0}", 1)],
    "chsh": [(r"changed user '([^']+)' shell", "Hesap kabuğu değişti: {0}", 1)],
}

PROGRAMS = sorted({"lightdm", "pkexec", "polkitd", "sudo", "su", "sshd", "smbd", "CRON", "udisksd", "kernel", "NetworkManager",
                   "wpa_supplicant", "systemd-logind", "dbus-daemon", "tiha"} | set(_ACCOUNT) | set(APP_PROGRAMS))

# Komut satırındaki parola benzeri değerler: sudo/pkexec satırları tahtada maskelenmeden gelir, hareket özeti ve ayrıntısında gizlenir.
_V = r"""("[^"]*"|'[^']*'|[^ \t;&|,]+)"""
SECRET_PATTERNS = [
    (r"\b(echo|printf)[ \t]+[^|]*\|[ \t]*(sudo[ \t]+-S|(sudo([ \t]+-[a-z]+)*[ \t]+)?([^ \t|;&]*/)?(chpasswd|passwd|smbpasswd|sshpass))", r"\1 *** | \2"),
    (r"(<<-?)[^|]*\|[ \t]*((sudo([ \t]+-[a-z]+)*[ \t]+)?([^ \t|;&]*/)?(chpasswd|passwd|smbpasswd)).*$", r"\1*** | \2"),
    (r"\b(chpasswd|passwd|smbpasswd)[ \t]*<<.*$", r"\1 <<***"),
    (r"\b(sudo[ \t]+-S[^<]*)<<<[ \t]*" + _V, r"\1<<< ***"),
    (r"\bsshpass(([ \t]+-[a-zA-Z]+)*)[ \t]+-p[ \t]*" + _V, r"sshpass\1 -p ***"),
    (r"--([a-z0-9_-]*(password|passwd|passphrase|pwd|pass|secret|token|api-?key))(=|[ \t]+)" + _V, r"--\1\3***"),
    (r"\b([a-z0-9_.-]*(password|passwd|passphrase|pass|parola|sifre|şifre|secret|token|api_?key)|[a-z0-9_.-]+pwd)=" + _V, r"\1=***"),
    (r"\b(mysql|mariadb|mysqldump|mariadb-dump|mysqladmin|7z|7za|7zr|rar|unrar)\b(.*[ \t])-p[^ \t;&|]+", r"\1\2-p***"),
    (r"\b(zip|unzip)\b(.*[ \t])-p[ \t]*" + _V, r"\1\2-P ***"),
    (r"\b(useradd|usermod)\b(.*[ \t])-p[ \t]*" + _V, r"\1\2-p ***"),
    (r"\b(ssh-keygen)\b(.*[ \t])-n[ \t]+" + _V, r"\1\2-N ***"),
    (r"\b(ssh-keygen)\b(.*[ \t])-p[ \t]+" + _V, r"\1\2-P ***"),
    (r"\b(curl|wget)\b(.*[ \t])(-u|--user)(=|[ \t]*)([^ \t:;&|]+):" + _V, r"\1\2\3\4\5:***"),
    (r"(-U[ \t]*[^ \t%;&|+]+)%" + _V, r"\1%***"),
    (r"([a-z][a-z0-9+.-]*://[^/ \t:@]+):[^/ \t@]+@", r"\1:***@"),
    (r"\bpass:" + _V, r"pass:***"),
    (r"\b(mkpasswd|htpasswd)\b.*$", r"\1 ***"),
    (r"\b(openssl[ \t]+passwd)\b.*$", r"\1 ***"),
]
_SECRETS = [(re.compile(p, re.I), r) for p, r in SECRET_PATTERNS]


def mask_secrets(text: str) -> str:
    for pattern, replacement in _SECRETS:
        text = pattern.sub(replacement, text)
    return text


def is_group_add(summary: str) -> bool:
    """usermod hesap başına art arda onlarca grup ekler: görev bunları tek satırda birleştirir."""
    return summary.startswith("Gruba eklendi: ")


def is_failed_pkexec(program: str, summary: str) -> bool:
    return program == "pkexec" and summary.startswith("Yetki isteği reddedildi")


def _account(program: str, m: str):
    for pattern, summary, who in _ACCOUNT[program]:
        hit = re.match(pattern, m)
        if hit:
            return "hesap", summary.format(*hit.groups()), hit.group(who) if who else None
    return None


def classify(program: str, message: str):
    m = mask_secrets(message.strip())
    if program in _ACCOUNT:
        return _account(program, m)
    if program == "lightdm":
        hit = re.match(r"pam_unix\(lightdm(-autologin)?:session\): session (opened|closed) for user (\S+?)(?:\(|$)", m)
        if hit and hit.group(3) != "lightdm":
            if hit.group(2) == "closed":
                return "oturum", "Oturum kapandı", hit.group(3)
            return "oturum", "Oturum açıldı (otomatik giriş)" if hit.group(1) else "Oturum açıldı", hit.group(3)
        hit = re.search(r"pam_unix\(lightdm:auth\): authentication failure.*user=(\S+)", m)
        if hit:
            return "oturum", f"Hatalı parola denemesi ({hit.group(1)})", hit.group(1)
        return None
    if program == "pkexec":
        # root'un pkexec'i kullanıcı hareketi değil (ör. ETAKisitActivator); bkz. 028_local_command_log.sql.
        if _AUTOMATED.search(m) or m.startswith("root:"):
            return None
        hit = _PKEXEC_DENIED.match(m)
        if hit:
            return "yetki", f"Yetki isteği reddedildi: {hit.group(2).strip()[:160]}", hit.group(1)
        hit = _PKEXEC.match(m)
        if hit:
            return "yetki", f"Yönetici olarak çalıştırıldı: {hit.group(2).strip()[:160]}", hit.group(1)
        return None
    if program == "polkitd":
        if _AUTOMATED.search(m):
            return None
        hit = _POLKIT_FAILED.match(m)
        if hit:
            return "yetki", f"Yetki doğrulaması başarısız: {hit.group(1).strip()[:160]}", hit.group(2)
        hit = _POLKIT_OK.match(m)
        if hit:
            return "yetki", f"Yetki doğrulandı ({hit.group(1)}): {hit.group(2).strip()[:160]}", hit.group(3)
        return None
    if program == "sudo":
        # pam_unix(sudo:*) satırları aynı olayın tekrarı; ret, "incorrect password attempt" satırında komutuyla gelir.
        hit = _SUDO.match(m)
        if not hit or hit.group(1) == "root" or _AUTOMATED.search(m):
            return None
        command = hit.group(4).strip()[:160]
        denied = _SUDO_DENIED.search(hit.group(2))
        if denied and "TTY=" not in hit.group(2):
            return None  # terminalsiz "sudo -n" yoklaması: otomasyon
        return "yetki", f"sudo reddedildi: {command}" if denied else f"sudo: {command}", hit.group(1)
    if program == "su":
        hit = re.match(r"(FAILED SU )?\(to (\S+)\) (\S+) on (\S+)", m)
        if hit and hit.group(4) != "none":
            action = "su başarısız" if hit.group(1) else "su ile geçildi"
            return "yetki", f"{action}: {hit.group(2)} hesabı", hit.group(3)
        return None
    if program == "sshd":
        hit = re.match(r"(Accepted|Failed) \S+ for (?:invalid user )?(\S+) from (\S+)", m)
        if hit:
            good = hit.group(1) == "Accepted"
            return "ssh", f"SSH {'girişi' if good else 'girişi başarısız'}: {hit.group(2)} ({hit.group(3)})", hit.group(2)
        hit = re.match(r"Disconnected from user (\S+) (\S+) port", m)
        if hit:
            return "ssh", f"SSH oturumu kapandı: {hit.group(1)} ({hit.group(2)})", hit.group(1)
        return None
    if program == "smbd":
        # "nobody": kimliksiz bağlantı; yalnız kapanış satırı gelir, birkaç tahtada aynı saniyede (ağ taraması) — hareket değil.
        hit = re.match(r"pam_unix\(samba:session\): session (opened|closed) for user (\S+?)(?:\(|$)", m)
        if hit and hit.group(2) != "nobody":
            return "ag", f"Samba bağlantısı {'açıldı' if hit.group(1) == 'opened' else 'kapandı'}: {hit.group(2)}", hit.group(2)
        return None
    if program == "CRON":
        # Root'un işleri sistem bakımıdır. CMD satırı cron tesisindedir, TiHA'nın Bakım profili iletmez; authpriv'deki oturum satırı gelir.
        hit = re.match(r"\((\S+)\) CMD \((.*)\)$", m)
        if hit:
            if hit.group(1) == "root" or _AUTOMATED.search(m):
                return None
            return "komut", f"Zamanlanmış iş: {hit.group(2).strip()[:240]}", hit.group(1)
        hit = re.match(r"pam_unix\(cron:session\): session opened for user (\S+?)(?:\(|$)", m)
        if hit and hit.group(1) != "root":
            return "sistem", f"Zamanlanmış iş çalıştı: {hit.group(1)}", hit.group(1)
        return None
    if program == "udisksd":
        hit = re.match(r"Mounted (\S+) at (\S+)", m)
        if hit:
            return "usb", f"Disk bağlandı: {hit.group(2).rsplit('/', 1)[-1]} ({hit.group(1)})", None
        hit = re.match(r"Unmounted (\S+)", m)
        if hit:
            return "usb", f"Disk çıkarıldı: {hit.group(1)}", None
        return None
    if program == "kernel":
        hit = _KERNEL_UPTIME.match(m)
        if hit and int(hit.group(1)) < _BOOT_SECONDS:
            return None
        if re.search(r"usb \d\S*: Product: ", m):  # "usb usb3" kök denetleyicidir, takılan aygıt değil
            return "usb", "USB aygıtı takıldı: " + m.split("Product: ", 1)[1].strip()[:80], None
        if "USB disconnect" in m:
            return "usb", "USB aygıtı çıkarıldı", None
        return None
    if program == "NetworkManager":
        hit = re.search(r"NetworkManager state is now (\S+)", m)
        if hit and hit.group(1) in ("CONNECTED_GLOBAL", "DISCONNECTED"):
            return "ag", "Ağ bağlantısı kuruldu" if hit.group(1) == "CONNECTED_GLOBAL" else "Ağ bağlantısı kesildi", None
        return None
    if program == "wpa_supplicant":
        if "CTRL-EVENT-CONNECTED" in m:
            return "ag", "Wi-Fi'ye bağlanıldı", None
        if "CTRL-EVENT-DISCONNECTED" in m:
            return "ag", "Wi-Fi bağlantısı kesildi", None
        return None
    if program == "systemd-logind":
        if m == "New seat seat0.":  # logind'in her başlangıcında bir kez: açılışın tek güvenilir izi
            return "guc", "Bilgisayar açıldı", None
        if "Power key pressed" in m:
            return "guc", "Güç düğmesine basıldı", None
        if "System is powering down" in m:
            return "guc", "Bilgisayar kapanıyor", None
        if "System is rebooting" in m:
            return "guc", "Bilgisayar yeniden başlıyor", None
        return None
    if program == "dbus-daemon":
        hit = _DBUS_APP.match(m)
        if hit and not _DBUS_SKIP.match(hit.group(1)):
            return "uygulama", f"Uygulama hizmeti açıldı: {hit.group(1)}", None
        return None
    if program == "tiha":
        return ("sistem", m.replace("TiHA: ", "TiHA: ", 1)[:200], None) if "uygulandı" in m else None
    return None
