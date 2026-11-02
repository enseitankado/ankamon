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

Tahta logları her uygulama açılışını kaydetmez; buradaki liste canlı loglardan çıkarıldı (2026-11-02): yalnız anlamlı
olaylar tutulur, otomatik işler (sshd'nin Ankamon bağlantıları, güncelleme denetimi, root'un kendi sudo'ları) gürültüdür.
classify(program, message) -> (tür, özet, olayı yapan kullanıcı|None) ya da None.
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

PROGRAMS = sorted({"lightdm", "pkexec", "sudo", "su", "sshd", "udisksd", "kernel", "NetworkManager", "wpa_supplicant",
                   "systemd-logind", "dbus-daemon", "passwd", "useradd", "userdel", "tiha"} | set(APP_PROGRAMS))

_AUTOMATED = re.compile(r"AutoAptUpdat|ahenk_debug|tiha-|/opt/ankamon")
_SUDO = re.compile(r"^(\S+) : .*?USER=(\S+) ; (?:ENV=.*? ; )?COMMAND=(.*)$")
_PKEXEC = re.compile(r"^(\S+): Executing command .*COMMAND=([^\]]*)\]?")
_PKEXEC_DENIED = re.compile(r"^(\S+): Error executing command")
_DBUS_APP = re.compile(r"^\[session uid=\d+ pid=\d+\] Activating service name='([^']+)'")
_DBUS_SKIP = re.compile(r"^(org\.freedesktop|org\.gtk|org\.a11y|ca\.desrt|org\.cinnamon|org\.gnome\.keyring|com\.canonical)")


def is_automated(text: str) -> bool:
    return bool(_AUTOMATED.search(text))


def classify(program: str, message: str):
    m = message.strip()
    if program == "lightdm":
        hit = re.match(r"pam_unix\(lightdm(?:-autologin)?:session\): session (opened|closed) for user (\S+?)(?:\(|$)", m)
        if hit and hit.group(2) != "lightdm":
            return "oturum", "Oturum açıldı" if hit.group(1) == "opened" else "Oturum kapandı", hit.group(2)
        hit = re.search(r"pam_unix\(lightdm:auth\): authentication failure.*user=(\S+)", m)
        if hit:
            return "oturum", f"Hatalı parola denemesi ({hit.group(1)})", hit.group(1)
        return None
    if program == "pkexec":
        hit = _PKEXEC_DENIED.match(m)
        if hit:
            return "yetki", "Yetki isteği reddedildi", hit.group(1)
        hit = _PKEXEC.match(m)
        if hit and not _AUTOMATED.search(m):
            return "yetki", f"Yönetici olarak çalıştırıldı: {hit.group(2).strip()[:160]}", hit.group(1)
        return None
    if program == "sudo":
        hit = _SUDO.match(m)
        if hit and hit.group(1) != "root" and not _AUTOMATED.search(m):
            return "yetki", f"sudo: {hit.group(3).strip()[:160]}", hit.group(1)
        if "incorrect password" in m or "authentication failure" in m:
            return "yetki", "sudo: hatalı parola", None
        return None
    if program == "su":
        hit = re.match(r"\(to (\S+)\) (\S+) on (\S+)", m)
        if hit and hit.group(3) != "none":
            return "yetki", f"su ile {hit.group(1)} hesabına geçildi", hit.group(2)
        return None
    if program == "sshd":
        hit = re.match(r"(Accepted|Failed) \S+ for (?:invalid user )?(\S+) from (\S+)", m)
        if hit:
            good = hit.group(1) == "Accepted"
            return "ssh", f"SSH {'girişi' if good else 'girişi başarısız'}: {hit.group(2)} ({hit.group(3)})", hit.group(2)
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
        if re.search(r"usb \S+: Product: ", m):
            return "usb", "USB aygıtı takıldı: " + m.split("Product: ", 1)[1][:80], None
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
    if program == "passwd":
        hit = re.search(r"password changed for (\S+)", m)
        return ("hesap", f"Parola değiştirildi: {hit.group(1)}", hit.group(1)) if hit else None
    if program == "useradd":
        hit = re.match(r"new user: name=([^,]+)", m)
        return ("hesap", f"Hesap açıldı: {hit.group(1)}", None) if hit else None
    if program == "userdel":
        hit = re.match(r"delete user '([^']+)'", m)
        return ("hesap", f"Hesap silindi: {hit.group(1)}", None) if hit else None
    if program == "tiha":
        return ("sistem", m.replace("TiHA: ", "TiHA: ", 1)[:200], None) if "uygulandı" in m else None
    return None
