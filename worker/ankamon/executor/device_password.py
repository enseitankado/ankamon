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

"""Parola ayarla ▸ "Yönetici hesapları" sekmesi: tek cihazda root ve etapadmin parolası.

Genel parola: Ayarlar ▸ SSH erişimi (settings.ssh_access). Cihazda root parolası ondan farklıysa SSH o cihazda
tutmaz; bu yüzden cihaza özel root parolası `device_credentials`'ta saklanır. Konteynerdeki bütün sshpass çağrıları
docker/rootfs/ankamon-sshpass.sh'tan geçer: hedef adres için /run/ankamon/device-ssh/<ip> varsa parola o olur
(sync() tablodan yazar; sshfs ve web terminal tabloyu doğrudan okur). Böylece hiçbir çağıran değişmedi.

Görevler (parolalar komut satırına yazılmaz: cihazda `ps`'te görünürdü, stdin'den gider):
  password_status : cihazdaki parola özeti genel parolayla tutuyor mu (root, etapadmin). Tutmuyorsa arayüz mevcut parola sorar.
  password_verify : verilen mevcut parola doğru mu. root'ta SSH zaten reddediliyorsa parola doğrudan SSH ile denenir;
                    tutarsa cihaza özel kaydedilir (erişim geri gelir).
  password_change : mevcut parola genel paroladan farklıysa önce doğrulanır, sonra chpasswd. root'ta yeni parola
                    cihaza özel kaydedilir ve yeni parolayla bağlanılarak sınanır; genel parolayla aynıysa kayıt silinir.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess

from .accounts import _SSH_OPTS

CRED_DIR = "/run/ankamon/device-ssh"
ACCOUNTS = ("root", "etapadmin")

# Cihazda stdin'den JSON okur; özetle karşılaştırma cihazdadır (libcrypt: $6$, $y$ …). Çıkış 3 = mevcut parola yanlış.
_REMOTE = r"""
import crypt, json, subprocess, sys
req = json.loads(sys.stdin.readline())
shadow = {}
with open("/etc/shadow") as f:
    for line in f:
        p = line.split(":")
        shadow[p[0]] = p[1]
def same(name, pw):
    h = shadow.get(name, "")
    return bool(pw) and h[:1] not in ("", "!", "*") and crypt.crypt(pw, h) == h
op = req["op"]
if op == "status":
    print(json.dumps({n: {"exists": n in shadow, "differs": not same(n, req["general"])} for n in req["accounts"]}))
elif op == "verify":
    sys.exit(0 if same(req["account"], req["current"]) else 3)
elif op == "change":
    a = req["account"]
    if a not in shadow:
        print("Cihazda %s hesabı yok." % a); sys.exit(4)
    if not same(a, req["general"]) and not same(a, req["current"]):
        print("Mevcut parola yanlış."); sys.exit(3)
    # Düz chpasswd ETAP'ın PAM zincirinde reddedilir (bkz. actions/user-password): özet burada üretilir, -e PAM'e uğramaz.
    h = crypt.crypt(req["new"], crypt.mksalt(crypt.METHOD_SHA512))
    r = subprocess.run(["chpasswd", "-e"], input="%s:%s\n" % (a, h), text=True, capture_output=True)
    if r.returncode:
        print(r.stderr.strip() or "chpasswd başarısız."); sys.exit(5)
"""


def _run(device: dict, user: str, password: str, request: dict, direct: bool = False, timeout: int = 20) -> dict:
    """direct: süzgeci atlayarak tam bu parolayla bağlan (bkz. ankamon-sshpass.sh)."""
    if not device.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Cihazın IP adresi yok."}
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, "-o", "ConnectTimeout=8",
           f"{user}@{device['ip']}", "python3 -c " + shlex.quote(_REMOTE)]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    if direct:
        # Sarmalayıcı yine çalışır (SSH etkinlik kaydı) ama cihaza özel parolayla değiştirmez.
        env["ANKAMON_SSHPASS_DIRECT"] = "1"
    try:
        proc = subprocess.run(cmd, input=(json.dumps(request) + "\n").encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env=env, timeout=timeout)
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
    return {"status": "failed", "rc": proc.returncode, "output": out or err or "Başarısız."}


def sync(conn) -> None:
    """Cihaza özel parolaları süzgecin okuduğu dosyalara yazar (adres değişse de güncel kalır). Yalnız root okur."""
    rows = conn.execute(
        """SELECT host(b.ip) AS ip, c.root_password FROM device_credentials c JOIN devices b ON b.id = c.device_id
           WHERE b.ip IS NOT NULL""").fetchall()
    os.makedirs(CRED_DIR, mode=0o700, exist_ok=True)
    wanted = {r["ip"]: r["root_password"] for r in rows}
    for name in os.listdir(CRED_DIR):
        if name not in wanted:
            os.unlink(os.path.join(CRED_DIR, name))
    for ip, secret in wanted.items():
        path = os.path.join(CRED_DIR, ip)
        try:
            with open(path, encoding="utf-8") as f:
                if f.read() == secret:
                    continue
        except OSError:
            pass
        fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(secret)
        os.rename(path + ".tmp", path)


def remember_root(conn, device: dict, secret: str, general: str) -> None:
    if secret == general:
        conn.execute("DELETE FROM device_credentials WHERE device_id = %s", (device["device_id"],))
    else:
        conn.execute(
            """INSERT INTO device_credentials (device_id, root_password) VALUES (%s, %s)
               ON CONFLICT (device_id) DO UPDATE SET root_password = EXCLUDED.root_password, updated_at = now()""",
            (device["device_id"], secret))
    sync(conn)


def status(device: dict, user: str, general: str) -> dict:
    """Çıktı JSON: {"root": {"exists", "differs"}, "etapadmin": {…}, "ssh": true|false}. SSH reddedilirse root farklıdır,
    etapadmin bilinemez (arayüz önce root'un mevcut parolasını ister)."""
    res = _run(device, user, general, {"op": "status", "general": general, "accounts": list(ACCOUNTS)})
    if res["status"] == "ok":
        data = json.loads(res["output"])
        data["ssh"] = True
        return {"status": "ok", "rc": 0, "output": json.dumps(data)}
    if res["rc"] == 5:
        data = {"ssh": False, "root": {"exists": True, "differs": True}, "etapadmin": {"exists": True, "differs": True}}
        return {"status": "ok", "rc": 0, "output": json.dumps(data)}
    return res


def verify(conn, device: dict, user: str, general: str, account: str, current: str) -> dict:
    res = _run(device, user, general, {"op": "verify", "account": account, "current": current})
    if res["status"] == "ok":
        if account == "root" and user == "root":
            remember_root(conn, device, current, general)   # cihaza bağlanan parola bilinsin
        return {"status": "ok", "rc": 0, "output": "Mevcut parola doğru."}
    if res["rc"] == 3:
        return {"status": "failed", "rc": 3, "output": "Mevcut parola yanlış."}
    if res["rc"] == 5 and account == "root" and user == "root":
        direct = _run(device, "root", current, {"op": "verify", "account": "root", "current": current}, direct=True)
        if direct["status"] == "ok":
            remember_root(conn, device, current, general)
            return {"status": "ok", "rc": 0, "output": "Mevcut parola doğru; cihaza erişim bu parolayla sürecek."}
        return {"status": "failed", "rc": 3, "output": "Mevcut parola yanlış."}
    if res["rc"] == 5:
        return {"status": "failed", "rc": 5, "output": "Cihaza bağlanılamadı: önce root'un mevcut parolasını doğrulayın."}
    return res


def change(conn, device: dict, user: str, general: str, account: str, current: str, new: str) -> dict:
    request = {"op": "change", "account": account, "current": current, "general": general, "new": new}
    res = _run(device, user, general, request)
    if res["rc"] == 5 and account == "root" and user == "root" and current:
        res = _run(device, "root", current, request, direct=True)
    if res["status"] != "ok":
        return res
    if account != "root" or user != "root":
        return {"status": "ok", "rc": 0, "output": f"{account} parolası bu cihazda değiştirildi."}
    # root: artık bağlantı parolası da bu. Önce sınanır, sonra kaydedilir; sınanamazsa açıkça söylenir.
    probe = _run(device, "root", new, {"op": "verify", "account": "root", "current": new}, direct=True)
    remember_root(conn, device, new, general)
    if probe["status"] != "ok":
        return {"status": "failed", "rc": probe["rc"],
                "output": "Parola değişti ve kaydedildi, fakat yeni parolayla bağlantı sınanamadı: " + probe["output"]}
    own = "genel parolayla aynı: cihaza özel kayıt kaldırıldı" if new == general else "Ankamon bu cihaza artık bu parolayla bağlanır"
    return {"status": "ok", "rc": 0, "output": f"root parolası bu cihazda değiştirildi ({own})."}
