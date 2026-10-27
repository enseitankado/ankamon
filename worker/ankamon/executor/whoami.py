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

"""Tahtada o anda oturum açmış GERÇEK kullanıcıyı SSH ile anlık sorgular.

board_sessions.py'nin logs tablosundan (lightdm PAM mesajlarından) türettiği kayıt bazen YANLIŞ/eski
kalabilir (kapanış mesajı kaybolmuşsa, ya da tahta loglamadan yeniden kullanılmışsa — kullanıcı
bildirdi). Bu modül onun yerine "Kullanıcı sorgula" / "Tüm kullanıcıları sorgula" (bkz. page.Boards,
docker/rootfs/screen/index.html) için ANLIK, gerçek zamanlı bir yoklamadır; sonuç hiçbir tabloya
yazılmaz, yalnız o an için görüntülenir.

Tahtada aynı anda birden fazla oturum olabilir (kullanıcı değiştir / kilit ekranından başka hesapla
giriş: her oturum kendi X'inde kalır). Bu yüzden `who`nun ilk satırı yerine SÜREÇLERE bakılır: uid'si
1000'den büyük (kullanıcı isteği; 1000 = etapadmin hariç) ve 60000'den küçük (nobody vb. hariç) her
kullanıcının en eski sürecinin yaşı onun oturum açma anı sayılır; kullanıcılar buna göre (ilk açan
önce) virgülle ayrılarak döner. TiHA oturum kapanınca kullanıcının süreçlerini öldürür
(KillUserProcesses=yes), yani süreci kalan kullanıcı gerçekten oturumu açık olandır. root SSH ile
bağlandığımız için sorgunun kendisi listeye girmez. Boş çıktı: açık kullanıcı oturumu yok.
"""

from __future__ import annotations

import os
import subprocess

_WHO_CMD = (
    "LC_ALL=C ps -eo uid=,etimes=,user:64= | awk '$1 > 1000 && $1 < 60000 "
    "{ if (!($3 in t) || $2 > t[$3]) t[$3] = $2 } END { for (u in t) print t[u], u }' "
    "| sort -rn | awk '{ printf \"%s%s\", (NR > 1 ? \", \" : \"\"), $2 }'"
)

_SSH_OPTS = [
    "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
]


def query(board: dict, user: str, password: str, timeout: int = 8) -> dict:
    """Döner: {"status": ok|unreachable|failed, "rc": int|None, "output": "ali, veli" (oturum açma
    sırasıyla; boşsa açık oturum yok)}."""
    if not board.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    target = f"{user}@{board['ip']}"
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, "-o", f"ConnectTimeout={min(timeout, 8)}", target, _WHO_CMD]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"status": "failed", "rc": None, "output": f"Zaman aşımı ({timeout} sn)."}
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace").strip()
        if proc.returncode == 5:
            return {"status": "unreachable", "rc": 5, "output": "SSH parolası reddedildi."}
        return {"status": "unreachable", "rc": proc.returncode, "output": err or f"ssh çıkış kodu {proc.returncode}"}
    return {"status": "ok", "rc": 0, "output": proc.stdout.decode("utf-8", "replace").strip()}


def dynamic_concurrency(min_n: int = 2, max_n: int = 20) -> int:
    """Şu anki CPU/RAM yüküne göre kaç tahtaya aynı anda bağlanılacağını belirler (kullanıcı isteği:
    sabit bir sayı değil, konteynerin o anki yoğunluğuna göre). SSH sorgusu G/Ç ağırlıklı olduğundan
    (CPU'yu değil ağ gecikmesini bekler), boşta kalan CPU payı başına birkaç eşzamanlı iş kaldırılır;
    kullanılabilir bellek azsa (yoğun bir anda yeni süreç açmak riskli) sıkı bir üst sınıra düşülür."""
    try:
        load1 = os.getloadavg()[0]
    except (OSError, AttributeError):
        load1 = 0.0
    cpu = os.cpu_count() or 1
    headroom = max(0.1, cpu - load1)  # yükün altında kalan "boş" CPU payı
    n = int(headroom * 4)
    try:
        with open("/proc/meminfo", encoding="ascii") as f:
            mem = {line.split(":")[0]: int(line.split()[1]) for line in f if ":" in line}
        if mem.get("MemAvailable", 0) / 1024 < 200:  # < 200 MB kullanılabilir: ihtiyatlı ol
            n = min(n, min_n)
    except OSError:
        pass
    return max(min_n, min(max_n, n))
