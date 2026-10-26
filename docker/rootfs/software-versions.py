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
