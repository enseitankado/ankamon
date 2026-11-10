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

"""Parola ayarla ▸ "Yönetici hesapları" sekmesi: tek tahtada root ve etapadmin parolası.

Genel parola: Ayarlar ▸ SSH erişimi (settings.ssh_access). Tahtada root parolası ondan farklıysa SSH o tahtada
tutmaz; bu yüzden tahtaya özel root parolası `board_credentials`'ta saklanır. Konteynerdeki bütün sshpass çağrıları
docker/rootfs/ankamon-sshpass.sh'tan geçer: hedef adres için /run/ankamon/board-ssh/<ip> varsa parola o olur
(sync() tablodan yazar; sshfs ve web terminal tabloyu doğrudan okur). Böylece hiçbir çağıran değişmedi.

Görevler (parolalar komut satırına yazılmaz: tahtada `ps`'te görünürdü, stdin'den gider):
  password_status : tahtadaki parola özeti genel parolayla tutuyor mu (root, etapadmin). Tutmuyorsa arayüz mevcut parola sorar.
  password_verify : verilen mevcut parola doğru mu. root'ta SSH zaten reddediliyorsa parola doğrudan SSH ile denenir;
                    tutarsa tahtaya özel kaydedilir (erişim geri gelir).
  password_change : mevcut parola genel paroladan farklıysa önce doğrulanır, sonra chpasswd. root'ta yeni parola
                    tahtaya özel kaydedilir ve yeni parolayla bağlanılarak sınanır; genel parolayla aynıysa kayıt silinir.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess

from .accounts import _SSH_OPTS

CRED_DIR = "/run/ankamon/board-ssh"
ACCOUNTS = ("root", "etapadmin")

# Tahtada stdin'den JSON okur; özetle karşılaştırma tahtadadır (libcrypt: $6$, $y$ …). Çıkış 3 = mevcut parola yanlış.
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
        print("Tahtada %s hesabı yok." % a); sys.exit(4)
    if not same(a, req["general"]) and not same(a, req["current"]):
        print("Mevcut parola yanlış."); sys.exit(3)
    # Düz chpasswd ETAP'ın PAM zincirinde reddedilir (bkz. actions/user-password): özet burada üretilir, -e PAM'e uğramaz.
    h = crypt.crypt(req["new"], crypt.mksalt(crypt.METHOD_SHA512))
    r = subprocess.run(["chpasswd", "-e"], input="%s:%s\n" % (a, h), text=True, capture_output=True)
    if r.returncode:
        print(r.stderr.strip() or "chpasswd başarısız."); sys.exit(5)
"""


def _run(board: dict, user: str, password: str, request: dict, direct: bool = False, timeout: int = 20) -> dict:
    """direct: süzgeci atlayarak tam bu parolayla bağlan (bkz. ankamon-sshpass.sh)."""
    if not board.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, "-o", "ConnectTimeout=8",
           f"{user}@{board['ip']}", "python3 -c " + shlex.quote(_REMOTE)]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    if direct:
        # Sarmalayıcı yine çalışır (SSH etkinlik kaydı) ama tahtaya özel parolayla değiştirmez.
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
    """Tahtaya özel parolaları süzgecin okuduğu dosyalara yazar (adres değişse de güncel kalır). Yalnız root okur."""
    rows = conn.execute(
        """SELECT host(b.ip) AS ip, c.root_password FROM board_credentials c JOIN boards b ON b.id = c.board_id
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


def remember_root(conn, board: dict, secret: str, general: str) -> None:
    if secret == general:
        conn.execute("DELETE FROM board_credentials WHERE board_id = %s", (board["board_id"],))
    else:
        conn.execute(
            """INSERT INTO board_credentials (board_id, root_password) VALUES (%s, %s)
               ON CONFLICT (board_id) DO UPDATE SET root_password = EXCLUDED.root_password, updated_at = now()""",
            (board["board_id"], secret))
    sync(conn)


def status(board: dict, user: str, general: str) -> dict:
    """Çıktı JSON: {"root": {"exists", "differs"}, "etapadmin": {…}, "ssh": true|false}. SSH reddedilirse root farklıdır,
    etapadmin bilinemez (arayüz önce root'un mevcut parolasını ister)."""
    res = _run(board, user, general, {"op": "status", "general": general, "accounts": list(ACCOUNTS)})
    if res["status"] == "ok":
        data = json.loads(res["output"])
        data["ssh"] = True
        return {"status": "ok", "rc": 0, "output": json.dumps(data)}
    if res["rc"] == 5:
        data = {"ssh": False, "root": {"exists": True, "differs": True}, "etapadmin": {"exists": True, "differs": True}}
        return {"status": "ok", "rc": 0, "output": json.dumps(data)}
    return res


def verify(conn, board: dict, user: str, general: str, account: str, current: str) -> dict:
    res = _run(board, user, general, {"op": "verify", "account": account, "current": current})
    if res["status"] == "ok":
        if account == "root" and user == "root":
            remember_root(conn, board, current, general)   # tahtaya bağlanan parola bilinsin
        return {"status": "ok", "rc": 0, "output": "Mevcut parola doğru."}
    if res["rc"] == 3:
        return {"status": "failed", "rc": 3, "output": "Mevcut parola yanlış."}
    if res["rc"] == 5 and account == "root" and user == "root":
        direct = _run(board, "root", current, {"op": "verify", "account": "root", "current": current}, direct=True)
        if direct["status"] == "ok":
            remember_root(conn, board, current, general)
            return {"status": "ok", "rc": 0, "output": "Mevcut parola doğru; tahtaya erişim bu parolayla sürecek."}
        return {"status": "failed", "rc": 3, "output": "Mevcut parola yanlış."}
    if res["rc"] == 5:
        return {"status": "failed", "rc": 5, "output": "Tahtaya bağlanılamadı: önce root'un mevcut parolasını doğrulayın."}
    return res


def change(conn, board: dict, user: str, general: str, account: str, current: str, new: str) -> dict:
    request = {"op": "change", "account": account, "current": current, "general": general, "new": new}
    res = _run(board, user, general, request)
    if res["rc"] == 5 and account == "root" and user == "root" and current:
        res = _run(board, "root", current, request, direct=True)
    if res["status"] != "ok":
        return res
    if account != "root" or user != "root":
        return {"status": "ok", "rc": 0, "output": f"{account} parolası bu tahtada değiştirildi."}
    # root: artık bağlantı parolası da bu. Önce sınanır, sonra kaydedilir; sınanamazsa açıkça söylenir.
    probe = _run(board, "root", new, {"op": "verify", "account": "root", "current": new}, direct=True)
    remember_root(conn, board, new, general)
    if probe["status"] != "ok":
        return {"status": "failed", "rc": probe["rc"],
                "output": "Parola değişti ve kaydedildi, fakat yeni parolayla bağlantı sınanamadı: " + probe["output"]}
    own = "genel parolayla aynı: tahtaya özel kayıt kaldırıldı" if new == general else "Ankamon bu tahtaya artık bu parolayla bağlanır"
    return {"status": "ok", "rc": 0, "output": f"root parolası bu tahtada değiştirildi ({own})."}
