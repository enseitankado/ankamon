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

"""Oturum hareketi kuralları: canlı log örnekleri ve parola maskeleme. python3 -m unittest discover -s worker/tests"""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "worker"))

from ankamon import session_activity_rules as rules  # noqa: E402

KEPT = [
    ("usermod", "change user 'etapadmin' password", ("hesap", "Parola değiştirildi: etapadmin", "etapadmin")),
    ("usermod", "add 'ali' to group 'audio'", ("hesap", "Gruba eklendi: ali → audio", "ali")),
    ("groupadd", "new group: name=ogretmenler, GID=1060", ("hesap", "Grup açıldı: ogretmenler", None)),
    ("chpasswd", "pam_unix(chpasswd:chauthtok): password changed for root", ("hesap", "Parola değiştirildi: root", "root")),
    ("passwd", "pam_unix(passwd:chauthtok): password changed for ali", ("hesap", "Parola değiştirildi: ali", "ali")),
    ("useradd", "new user: name=ali, UID=1059, GID=1060, home=/home/ali, shell=/bin/bash, from=none", ("hesap", "Hesap açıldı: ali", None)),
    ("userdel", "delete user 'ali'", ("hesap", "Hesap silindi: ali", None)),
    ("smbd", "pam_unix(samba:session): session opened for user ali(uid=1001) by (uid=0)", ("ag", "Samba bağlantısı açıldı: ali", "ali")),
    ("polkitd", "Operator of unix-session:2 FAILED to authenticate to gain authorization for action tr.org.pardus.eta.shutdown.policy "
                "for unix-process:5925:90412 [/usr/bin/python3 /usr/bin/eta-shutdown] (owned by unix-user:ogretmen)",
     ("yetki", "Yetki doğrulaması başarısız: /usr/bin/python3 /usr/bin/eta-shutdown", "ogretmen")),
    ("polkitd", "Operator of unix-session:2 successfully authenticated as unix-user:etapadmin to gain TEMPORARY authorization for action "
                "org.x for unix-process:1:2 [/usr/bin/foo] (owned by unix-user:ogretmen)",
     ("yetki", "Yetki doğrulandı (etapadmin): /usr/bin/foo", "ogretmen")),
    ("lightdm", "pam_unix(lightdm:session): session opened for user ali(uid=1058) by (uid=0)", ("oturum", "Oturum açıldı", "ali")),
    ("lightdm", "pam_unix(lightdm-autologin:session): session opened for user felsefe(uid=1043) by (uid=0)",
     ("oturum", "Oturum açıldı (otomatik giriş)", "felsefe")),
    ("lightdm", "pam_unix(lightdm:auth): authentication failure; logname= uid=0 euid=0 tty=:0 ruser= rhost=  user=tarih",
     ("oturum", "Hatalı parola denemesi (tarih)", "tarih")),
    ("CRON", "(ali) CMD (/home/ali/yedek.sh)", ("komut", "Zamanlanmış iş: /home/ali/yedek.sh", "ali")),
    ("CRON", "pam_unix(cron:session): session opened for user ali(uid=1001) by (uid=0)", ("sistem", "Zamanlanmış iş çalıştı: ali", "ali")),
    ("sudo", "etapadmin : TTY=pts/0 ; PWD=/home/etapadmin ; USER=root ; COMMAND=/usr/bin/ss -ntp", ("yetki", "sudo: /usr/bin/ss -ntp", "etapadmin")),
    ("sudo", "ogretmen : user NOT in sudoers ; TTY=pts/1 ; PWD=/home/ogretmen ; USER=root ; COMMAND=/usr/bin/systemctl stop x",
     ("yetki", "sudo reddedildi: /usr/bin/systemctl stop x", "ogretmen")),
    ("su", "(to root) etapadmin on pts/0", ("yetki", "su ile geçildi: root hesabı", "etapadmin")),
    ("su", "FAILED SU (to root) ali on pts/1", ("yetki", "su başarısız: root hesabı", "ali")),
    ("pkexec", "ogretmen: Error executing command as another user: Not authorized [USER=root] [TTY=unknown] [CWD=/home/ogretmen] "
               "[COMMAND=/usr/bin/eta-shutdown]", ("yetki", "Yetki isteği reddedildi: /usr/bin/eta-shutdown", "ogretmen")),
    ("sshd", "Accepted password for ali from 10.0.0.5 port 22 ssh2", ("ssh", "SSH girişi: ali (10.0.0.5)", "ali")),
    ("sshd", "Disconnected from user ali 10.0.0.5 port 22", ("ssh", "SSH oturumu kapandı: ali (10.0.0.5)", "ali")),
    ("systemd-logind", "New seat seat0.", ("guc", "Bilgisayar açıldı", None)),
    ("kernel", "[  236.1] usb 1-2: Product: Basic Optical Mouse", ("usb", "USB aygıtı takıldı: Basic Optical Mouse", None)),
    ("kernel", "[ 3000.1] usb 4-4: USB disconnect, device number 2", ("usb", "USB aygıtı çıkarıldı", None)),
]

NOISE = [
    ("chpasswd", "pam_unix(chpasswd:chauthtok): new password not acceptable"),
    ("chpasswd", "gkr-pam: couldn't update the login keyring password: no old password was entered"),
    ("usermod", "add 'ali' to shadow group 'audio'"),
    ("userdel", "delete 'ali' from group 'audio'"),
    ("useradd", "new group: name=ali, GID=1060"),
    ("groupadd", "group added to /etc/group: name=x, GID=1"),
    ("smbd", "pam_unix(samba:session): session closed for user nobody"),
    ("CRON", "pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)"),
    ("CRON", "(root) CMD (cd / && run-parts --report /etc/cron.hourly)"),
    ("polkitd", "Loading rules from directory /etc/polkit-1/rules.d"),
    ("polkitd", "Registered Authentication Agent for unix-session:172 (system bus name :1.62896)"),
    ("lightdm", "pam_unix(lightdm-greeter:session): session opened for user lightdm(uid=107) by (uid=0)"),
    ("lightdm", "gkr-pam: unlocked login keyring"),
    ("sudo", "pam_unix(sudo:session): session opened for user etapadmin(uid=1000) by (uid=0)"),
    ("sudo", "pam_unix(sudo:auth): authentication failure; logname= uid=1000"),
    ("sudo", "root : PWD=/ ; USER=lightdm ; COMMAND=/usr/bin/env DISPLAY=:0"),
    ("sudo", "etapadmin : PWD=/ ; USER=root ; COMMAND=/usr/bin/python3 /opt/ahenk-debug/ahenk_debug.py --json"),
    ("sudo", "etapadmin : a password is required ; PWD=/root ; USER=root ; COMMAND=/usr/bin/id"),
    ("su", "(to tmtestuser) root on none"),
    ("pkexec", "ali: Executing command [USER=root] [TTY=unknown] [CWD=/h] [COMMAND=/usr/share/pardus/pardus-update/src/AutoAptUpdate.py]"),
    ("pkexec", "root: Executing command [USER=root] [TTY=unknown] [CWD=/root] [COMMAND=/usr/share/eta/eta-kisit/src/ETAKisitActivator.py --x]"),
    ("sshd", "Connection closed by 192.168.22.249 port 32772"),
    ("systemd-logind", "New session 10 of user root."),
    ("kernel", "[    1.2] usb usb3: Product: xHCI Host Controller"),
    ("kernel", "[    2.2] usb 6-1: Product: USB Keyboard"),
    ("kernel", "[    6.2] usb 4-4: USB disconnect, device number 2"),
]

# (girdi, gizli kalması gereken metin)
SECRETS = [
    ("sshpass -p gizli123 ssh root@x", "gizli123"),
    ("sshpass -pgizli123 ssh root@x", "gizli123"),
    ("sshpass -v -p 'gizli 123' ssh x", "gizli 123"),
    ("mysql --password=gizli123 -u root", "gizli123"),
    ("foo --new-password gizli123 bar", "gizli123"),
    ("foo --token=gizli123", "gizli123"),
    ("foo --api-key gizli123", "gizli123"),
    ("mysql -u root -pgizli123 db", "gizli123"),
    ("mysqldump -uroot -pgizli123 db", "gizli123"),
    ("7z x -pgizli123 a.7z", "gizli123"),
    ("unzip -P gizli123 a.zip", "gizli123"),
    ("echo 'ali:gizli123' | chpasswd", "gizli123"),
    ("echo gizli123 | sudo -S ls", "gizli123"),
    ("echo 'ali:gizli123' | sudo chpasswd", "gizli123"),
    ("cat <<EOF | chpasswd ali:gizli123 EOF", "gizli123"),
    ("echo 'ali:gizli123' | /usr/sbin/chpasswd", "gizli123"),
    ("echo 'ali:gizli123' | sudo -n /usr/sbin/chpasswd -c SHA512", "gizli123"),
    ("printf 'gizli123\\n' | passwd ali", "gizli123"),
    ("chpasswd <<< 'ali:gizli123'", "gizli123"),
    ("sudo -S ls <<< gizli123", "gizli123"),
    ("PGPASSWORD=gizli123 psql", "gizli123"),
    ("MYSQL_PWD=gizli123 mysql", "gizli123"),
    ("SSHPASS=gizli123 sshpass -e ssh x", "gizli123"),
    ("PAROLA=gizli123 ./kur.sh", "gizli123"),
    ("mount -t cifs //a/b /m -o username=ali,password=gizli123,ro", "gizli123"),
    ("curl -u ali:gizli123 http://x", "gizli123"),
    ("curl --user ali:gizli123 http://x", "gizli123"),
    ("git clone https://ali:gizli123@host/r.git", "gizli123"),
    ("smbclient //a/b -U ali%gizli123", "gizli123"),
    ("openssl enc -k x -pass pass:gizli123", "gizli123"),
    ("openssl passwd gizli123", "gizli123"),
    ("mkpasswd gizli123", "gizli123"),
    ("htpasswd -b f ali gizli123", "gizli123"),
    ("useradd -m -p gizli123 ali", "gizli123"),
    ("ssh-keygen -t rsa -N gizli123 -f k", "gizli123"),
]

UNTOUCHED = [
    "echo foo | grep passwd", "ls -la /tmp", "mkdir -p /tmp/x", "ssh -p2222 ali@x", "date -u +%Y-%m-%d", "grep -r parola .", "man chpasswd", "passwd ali",
    "cd /home/ali; PWD=/tmp ls", "docker run -p 80:80 x", "curl http://x/a:b", "pass",
]


class Rules(unittest.TestCase):
    def test_kept(self):
        for program, message, want in KEPT:
            self.assertEqual(rules.classify(program, message), want, message)
            self.assertIn(program, rules.PROGRAMS)

    def test_noise(self):
        for program, message in NOISE:
            self.assertIsNone(rules.classify(program, message), message)

    def test_sudo_summary_is_masked(self):
        hit = rules.classify("sudo", "ali : TTY=pts/0 ; PWD=/h ; USER=root ; COMMAND=/usr/bin/sshpass -p gizli123 ssh x")
        self.assertNotIn("gizli123", hit[1])


class NoShellHook(unittest.TestCase):
    def test_shell_hook_not_collected(self):
        self.assertNotIn("ankamon-shell", rules.PROGRAMS)
        self.assertIsNone(rules.classify("ankamon-shell", "ali : TTY=pts/0 ; PWD=/h ; COMMAND=ls"))
        self.assertFalse(os.path.exists(os.path.join(ROOT, "actions/shell-command-log-on")))


class Masking(unittest.TestCase):
    def test_python_hides(self):
        for text, secret in SECRETS:
            self.assertNotIn(secret, rules.mask_secrets(text), text)

    def test_plain_commands_untouched(self):
        for text in UNTOUCHED:
            self.assertEqual(rules.mask_secrets(text), text)



if __name__ == "__main__":
    unittest.main()
