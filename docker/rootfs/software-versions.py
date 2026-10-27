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

"""Derleme sırasında (Dockerfile'ın son adımı) konteynerdeki bileşenlerin sürümlerini toplar ve
/opt/ankamon/software-versions.json'a yazar: Sistem ▸ Yazılımlar sayfası bunu okur (bkz. backend
Api/SoftwareApi.php — bileşen listesi, açıklamalar ve canlı durum orada). Sürüm her istekte komut
çalıştırılarak değil, imaj üretilirken bir kez belirlenir: imaj değişmeden sürüm de değişmez.

Kaynaklar: apk paket veritabanı (Alpine paketleri, dağıtım yaması "-rN" dahil), pip (webssh), ikili
dosyaların kendi --version çıktısı, ön yüz derleme aşamasının yazdığı frontend-versions.json.
Bulunamayan sürüm boş bırakılır (sayfa "bilinmiyor" gösterir); betik hiçbir durumda derlemeyi durdurmaz.
"""

import json
import re
import subprocess
import time

OUT = "/opt/ankamon/software-versions.json"
APK = ["nginx", "php84", "php84-fpm", "grafana", "telegraf", "rsyslog", "python3", "py3-psycopg", "py3-tornado",
       "ansible-core", "openssh-client-default", "sshpass", "sshfs", "openssl", "arp-scan", "nmap", "samba-client",
       "supervisor", "bash", "curl"]


def run(*cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return (r.stdout or "") + (r.stderr or "")
    except (OSError, subprocess.TimeoutExpired):
        return ""


def first_version(text):
    m = re.search(r"v?(\d+\.\d+(?:\.\d+)?(?:[-.+~][0-9A-Za-z.]+)?)", text)
    return m.group(1) if m else ""


versions = {}
# apk 3: "nginx-1.28.3-r7 x86_64 {nginx} (BSD-2-Clause) [installed]" — ad ile sürüm "-<rakam>" ile ayrılır.
installed = run("apk", "list", "-I", *APK).splitlines()
for pkg in APK:
    for line in installed:
        m = re.match(re.escape(pkg) + r"-(\d\S*)\s", line)
        if m:
            versions[pkg] = m.group(1)
            break
try:
    with open("/etc/alpine-release") as f:
        versions["alpine"] = f.read().strip()
except OSError:
    pass
versions["postgres"] = first_version(run("postgres", "--version"))
versions["webssh"] = run("python3", "-c", "import importlib.metadata as m; print(m.version('webssh'))").strip()
versions["mediamtx"] = first_version(run("/opt/ankamon/mediamtx/mediamtx", "--version"))
fb = "/opt/ankamon/filemanager/filebrowser"
versions["filebrowser"] = first_version(run(fb, "version") or "") or first_version(run(fb, "--version"))
try:  # noVNC kurulmaz, yalnız istemci dosyaları açılır; sürüm paket adından (bkz. Dockerfile)
    with open("/opt/ankamon/novnc.version") as f:
        versions["novnc"] = f.read().strip()
except OSError:
    pass
try:
    with open("/opt/ankamon/frontend-versions.json") as f:
        versions.update(json.load(f))
except (OSError, ValueError):
    pass

versions = {k: v for k, v in versions.items() if v}
with open(OUT, "w") as f:
    json.dump({"built_at": int(time.time()), "versions": versions}, f, ensure_ascii=False, indent=1)
print("software-versions:", ", ".join(f"{k}={v}" for k, v in sorted(versions.items())))
