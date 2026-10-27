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

"""Sorun tespiti: seçilen tahtaları denetler (runner PARALEL çalıştırır — whoami.dynamic_concurrency), tahta başına bulgu listesi üretir.

Arayüz: "Sorun tespiti" sayfası (frontend page/Diagnose.js — Tahtalar grid'inin kendisinden türetilmiş).
Görev türü "diagnose" (bkz. runner, backend JobsApi). Her tahtaya TEK SSH turu: hwfacts.SCRIPT (donanım
+ SMART — Bilgi kartıyla aynı; sonuç boards.facts'e de yazılır, önbellek tazelenir) + CHECK_SCRIPT (ek
sistem denetimleri). Filo karşılaştırmaları (RAM/disk ortalaması, sıcaklık ortalaması) veritabanından:
kayıtlı TÜM tahtaların son donanım bilgisi ve son 24 saatin sensör verisi — yalnız seçilenler değil.

Bulgu düzeyleri: ok (sorun yok), info (bilgi), warn (dikkat), bad (acil). Tahtanın genel düzeyi en kötü
bulgusudur. Sonuç job_targets.output'a JSON olarak yazılır: {"level", "checks": [{group, title, level,
detail, advice}], "collected_at"}.
"""

from __future__ import annotations

import json
import os
import subprocess
import time

from . import hwfacts

# Kernel günlüğü SON 7 GÜNDEN okunur (yalnız bu açılıştan değil): disk takılıp tahta yeniden
# başlatılınca hata kanıtı önceki açılışta kalır — yine de görünmeli.
# "Başarısız servisler" denetiminde sayılmayan servisler (kullanıcı isteği): openipmi sunucu donanımı
# (IPMI) içindir, tahtalarda BMC olmadığından her açılışta başarısız görünür — sorun değildir.
_IGNORED_UNITS = {"openipmi.service"}

_IO_RE = r"I/O error|ata[0-9.]+: (failed command|exception)|EXT4-fs error|link is slow to respond|Buffer I/O error|blk_update_request"
CHECK_SCRIPT = r"""
export LC_ALL=C
echo "DG_FAILED_UNITS=$(systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}' | paste -sd, -)"
k=$(journalctl -k --since "-7 days" -q --no-pager 2>/dev/null)
echo "DG_IO_ERRORS=$(printf '%s\n' "$k" | grep -ciE '__IO__')"
echo "DG_IO_SAMPLE=$(printf '%s\n' "$k" | grep -iE '__IO__' | tail -n 1 | cut -c1-200)"
echo "DG_OOM=$(printf '%s\n' "$k" | grep -ciE 'out of memory|oom-kill')"
echo "DG_THROTTLE=$(printf '%s\n' "$k" | grep -ciE 'temperature above threshold|clock throttled')"
echo "DG_ROOT_RO=$(awk '$2=="/"{split($4,o,","); print (o[1]=="ro")?1:0; exit}' /proc/mounts)"
echo "DG_INODE_PCT=$(df -Pi / 2>/dev/null | awk 'NR==2{gsub("%","",$5); print $5}')"
echo "DG_NTP_SYNC=$(timedatectl show -p NTPSynchronized --value 2>/dev/null)"
echo "DG_REBOOT_REQUIRED=$([ -f /var/run/reboot-required ] && echo 1 || echo 0)"
echo "DG_LOAD15=$(awk '{print $3}' /proc/loadavg)"
echo "DG_DPKG_BROKEN=$(dpkg --audit 2>/dev/null | grep -c '^ ')"
echo "DG_SWAP=$(swapon --show=NAME --noheadings 2>/dev/null | paste -sd, -)"
# Güncellemesi gelen paketler: tahtadaki MEVCUT paket listesinden (apt update ÇALIŞTIRILMAZ — tarama ağa
# bağlı kalmasın, MEB filtresinde takılmasın). Listenin yaşı ayrıca bildirilir: eskiyse sayı eksik olabilir.
u=$(apt list --upgradable 2>/dev/null | grep -F '[upgradable from')
echo "DG_UPG_COUNT=$(printf '%s' "$u" | grep -c .)"
echo "DG_UPG_SECURITY=$(printf '%s\n' "$u" | grep -c -- '-security')"
echo "DG_UPG_SAMPLE=$(printf '%s\n' "$u" | cut -d/ -f1 | head -n 8 | paste -sd, -)"
echo "DG_APT_LISTS_AT=$(find /var/lib/apt/lists -maxdepth 1 -name '*Packages*' -printf '%T@\n' 2>/dev/null | sort -n | tail -n 1 | cut -d. -f1)"
# Donanım sensörleri (hwmon): her satır "DGS <yonga> <dosya> <ham değer> <etiket>" — fan devri, gerilimler
# (CMOS pili), Super I/O ve ACPI sıcaklıkları. Super I/O sürücüsü yüklü değilse fan/pil satırı çıkmaz
# (bkz. actions/sensors-superio).
for h in /sys/class/hwmon/hwmon*; do
  n=$(cat "$h/name" 2>/dev/null)
  for f in "$h"/fan*_input "$h"/in*_input "$h"/temp*_input; do
    [ -r "$f" ] || continue
    b=${f%_input}
    echo "DGS $n $(basename "$f") $(cat "$f" 2>/dev/null) $(cat "${b}_label" 2>/dev/null | tr ' ' '_')"
  done
done
# O anki en çok işlemci kullanan süreçler (1 sn'lik örnek — top'un 2. turu): "DGP %cpu komut".
top -b -n 2 -d 1 -o %CPU -w 200 2>/dev/null | awk '/^top -/{n++} n==2 && /^ *PID/{p=1; next} n==2 && p && c<3 {c++; print "DGP", $9, $12}'
# Saat sapması için: açılıştan beri geçen süre ve tahtanın saati — EN SONDA (yukarıdaki komutlar birkaç sn
# sürer; sunucu saati SSH döner dönmez alınır, bkz. _ssh DG_SERVER_EPOCH) ki fark gerçek sapmayı versin.
echo "DG_UPTIME=$(cut -d. -f1 /proc/uptime)"
echo "DG_EPOCH=$(date +%s)"
""".replace("__IO__", _IO_RE)

SCRIPT = hwfacts.SCRIPT + CHECK_SCRIPT

LEVELS = ["ok", "info", "warn", "bad"]

# Super I/O (anakart donanım izleme yongası) hwmon adları — fan devri, CMOS pili ve anakart sıcaklığı
# yalnız bunlardan gelir (bkz. backend Core/BoardSensors.php).
_SUPERIO = ("it87", "it86", "nct6", "f71", "w836")

# CMOS (RTC) pili: CR2032, anma 3,0 V. RTC yongası (Intel PCH / AMD FCH) VccRTC için en az 2,0 V ister;
# pil ile yonga arasındaki yalıtım diyotu ~0,2 V düşürdüğünden pil 2,2 V'un altına inince saat/BIOS
# ayarları, tahta prizden çekildiğinde kaybolabilir (acil). 2,5 V'un altı zayıflama işaretidir (dikkat).
CMOS_BAD_V = 2.2
CMOS_WARN_V = 2.5
# Kasa içi (anakart/ortam) sıcaklığı — Super I/O temp1, yoksa ACPI termal bölge.
CASE_WARN_C = 50
# Paket listesi (apt update) bu kadar gün yenilenmemişse "bekleyen güncelleme" sayısı eksik olabilir.
APT_LISTS_STALE_DAYS = 7
# "Saat eşitlenmemiş" yalnız tahta açılalı bu kadar saniye geçtiyse: açılışta NTP sunucusuna bağlanıp
# eşitlenmek zaman alır (kullanıcı isteği: en az 3 dk).
NTP_GRACE_S = 180
# Son 15 dakikanın ortalama işlemci kullanımı bu yüzdeyi aşarsa bilgi verilir.
CPU_INFO_PCT = 80
GIB = 1024 ** 3


def _ssh(board: dict, user: str, password: str, timeout: int = 60) -> dict:
    if not board.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    cmd = ["sshpass", "-e", "ssh", *hwfacts._SSH_OPTS, "-o", "ConnectTimeout=8",
           f"{user}@{board['ip']}", SCRIPT]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"status": "failed", "rc": None, "output": f"Zaman aşımı ({timeout} sn) — tahta yanıt vermiyor."}
    if proc.returncode == 5:
        return {"status": "unreachable", "rc": 5, "output": "SSH parolası reddedildi."}
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace").strip()
        return {"status": "unreachable", "rc": proc.returncode, "output": err or f"ssh çıkış kodu {proc.returncode}"}
    # Sunucunun saati SSH döner dönmez (tahtanın DG_EPOCH'u betiğin son satırı): fark = saat sapması.
    return {"status": "ok", "rc": 0,
            "output": proc.stdout.decode("utf-8", "replace") + f"\nDG_SERVER_EPOCH={int(time.time())}\n"}


def _drift_text(seconds: int) -> str:
    """Saat sapması: "4 dk 12 sn ileri", "3 sa 5 dk geri", "12 gün ileri"."""
    a = abs(seconds)
    if a < 90:
        amount = f"{a} sn"
    elif a < 90 * 60:
        amount = f"{a // 60} dk {a % 60} sn"
    elif a < 48 * 3600:
        amount = f"{a // 3600} sa {a % 3600 // 60} dk"
    else:
        amount = f"{a // 86400} gün {a % 86400 // 3600} sa"
    return amount + (" ileri" if seconds > 0 else " geri")


def _extra(output: str) -> dict:
    values = dict(line.split("=", 1) for line in output.splitlines() if line.startswith("DG_") and "=" in line)
    num = lambda k: int(values[k]) if values.get(k, "").strip().isdigit() else None  # noqa: E731
    try:
        load15 = float(values.get("DG_LOAD15", ""))
    except ValueError:
        load15 = None
    split = lambda k: [x for x in values.get(k, "").strip().split(",") if x]  # noqa: E731
    return {
        "failed_units": [u for u in split("DG_FAILED_UNITS") if u not in _IGNORED_UNITS],
        "io_errors": num("DG_IO_ERRORS"),
        "io_sample": values.get("DG_IO_SAMPLE", "").strip() or None,
        "oom": num("DG_OOM"),
        "throttle": num("DG_THROTTLE"),
        "root_ro": num("DG_ROOT_RO"),
        "inode_pct": num("DG_INODE_PCT"),
        "ntp_sync": values.get("DG_NTP_SYNC", "").strip() or None,
        "uptime": num("DG_UPTIME"),
        "epoch": num("DG_EPOCH"),
        "server_epoch": num("DG_SERVER_EPOCH"),
        "reboot_required": num("DG_REBOOT_REQUIRED"),
        "load15": load15,
        "dpkg_broken": num("DG_DPKG_BROKEN"),
        "swap": split("DG_SWAP"),
        "upg_count": num("DG_UPG_COUNT"),
        "upg_security": num("DG_UPG_SECURITY"),
        "upg_sample": split("DG_UPG_SAMPLE"),
        "apt_lists_at": num("DG_APT_LISTS_AT"),
        "sensors": _sensors(output),
        "top": [line.split(None, 2)[1:] for line in output.splitlines()
                if line.startswith("DGP ") and len(line.split(None, 2)) == 3],
    }


def _sensors(output: str) -> dict:
    """DGS satırları → {"superio": bool, "fans": {sensor: rpm}, "vbat": V|None, "case": [(kaynak, °C)]}."""
    fans, vbat, case, superio = {}, None, [], False
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 4 or parts[0] != "DGS":
            continue
        chip, sensor, raw = parts[1], parts[2].replace("_input", ""), parts[3]
        label = parts[4].lower() if len(parts) > 4 else ""
        try:
            value = int(raw)
        except ValueError:
            continue
        sio = chip.startswith(_SUPERIO)
        superio = superio or sio
        if sio and sensor.startswith("fan"):
            fans[sensor] = value
        elif sio and sensor.startswith("in") and ("bat" in label or (not label and sensor == "in8")):
            vbat = value / 1000
        elif sensor.startswith("temp") and 0 < value <= 120000:
            # Super I/O temp1 = anakart üzerindeki termal diyot; acpitz = ACPI kasa/ortam bölgesi.
            if sio and sensor == "temp1":
                case.append(("anakart", value / 1000))
            elif chip == "acpitz":
                case.append(("ACPI", value / 1000))
    return {"superio": superio, "fans": fans, "vbat": vbat, "case": case}


def history(conn, board_id: int) -> dict:
    """Tahtanın sensör geçmişi (veritabanı): fan başına bugüne dek en yüksek devir (fan "bağlı mı" —
    hiç dönmemiş giriş boştur), son 24 saatte kasa içi en yüksek sıcaklık, son 15 dk işlemci kullanımı."""
    bid = str(board_id)
    fans = {r["sensor"]: float(r["mx"] or 0) for r in conn.execute(
        """SELECT t.sensor, greatest(max(h.max), (SELECT max(m.value) FROM metrics m WHERE m.tag_id = t.tag_id
                                                   AND m.time > now() - interval '2 hours')) AS mx
           FROM metrics_tag t LEFT JOIN metrics_1h h USING (tag_id)
           WHERE t.board_id = %s AND t.name = 'node_hwmon_fan_rpm'
           GROUP BY t.sensor, t.tag_id""", (bid,)).fetchall()}
    case = conn.execute(
        """SELECT max(m.value) AS mx FROM metrics m JOIN metrics_tag t USING (tag_id)
           WHERE t.board_id = %s AND t.name = 'node_hwmon_temp_celsius' AND m.time > now() - interval '24 hours'
             AND m.value > 0 AND m.value <= 120
             AND ((t.sensor = 'temp1' AND t.chip ~ '(it87|nct6|f71|w836)') OR t.chip LIKE 'thermal_thermal_zone%%')""",
        (bid,)).fetchone()
    cpu = conn.execute(
        """SELECT 1 - avg(idle_rate) AS cpu FROM (
               SELECT t.cpu, (max(m.value) - min(m.value)) / NULLIF(extract(epoch FROM max(m.time) - min(m.time)), 0) AS idle_rate
               FROM metrics m JOIN metrics_tag t USING (tag_id)
               WHERE t.board_id = %s AND t.name = 'node_cpu_seconds_total' AND t.mode = 'idle'
                 AND m.time > now() - interval '15 minutes'
               GROUP BY t.cpu) per_cpu""", (bid,)).fetchone()
    return {
        "fans": fans,
        "case_max24": float(case["mx"]) if case and case["mx"] is not None else None,
        "cpu15": max(0.0, min(100.0, float(cpu["cpu"]) * 100)) if cpu and cpu["cpu"] is not None else None,
    }


# Son 24 saatte tahta başına işlemci sıcaklığı: her ölçüm anında CPU algılayıcılarının en yükseği,
# bunların ortalaması ve tepesi. CPU algılayıcısı (coretemp/k10temp/zenpower) olmayan tahtada tüm
# sıcaklık serilerine (termal bölgeler) düşülür. Fiziksel olmayan değerler (≤0, >120) atılır.
_TEMP_SQL = """
WITH s AS (
    SELECT t.board_id, m.time, m.value,
           (t.chip ~* '(coretemp|k10temp|zenpower)') AS cpu
    FROM metrics m JOIN metrics_tag t USING (tag_id)
    WHERE t.name IN ('node_hwmon_temp_celsius', 'node_thermal_zone_temp')
      AND m.time > now() - interval '24 hours' AND m.value > 0 AND m.value <= 120
), pick AS (
    SELECT board_id, bool_or(cpu) AS has_cpu FROM s GROUP BY board_id
), per_time AS (
    SELECT s.board_id, s.time, max(s.value) AS v
    FROM s JOIN pick USING (board_id)
    WHERE s.cpu OR NOT pick.has_cpu
    GROUP BY s.board_id, s.time
)
SELECT board_id, avg(v) AS avg24, max(v) AS max24, count(*) AS n FROM per_time GROUP BY board_id
"""


def fleet(conn) -> dict:
    """Karşılaştırma tabanı: kayıtlı TÜM tahtaların son bilinen RAM/disk kapasitesi ve 24 sa sıcaklığı."""
    mem, disk = [], []
    for row in conn.execute("SELECT facts FROM boards").fetchall():
        f = row["facts"] or {}
        if f.get("mem_total_bytes"):
            mem.append(f["mem_total_bytes"])
        if f.get("disk_total_bytes"):
            disk.append(f["disk_total_bytes"])
    temps = {str(r["board_id"]): {"avg": float(r["avg24"]), "max": float(r["max24"]), "n": r["n"]}
             for r in conn.execute(_TEMP_SQL).fetchall()}
    avg = lambda xs: sum(xs) / len(xs) if xs else None  # noqa: E731
    return {
        "mem_avg": avg(mem), "mem_n": len(mem),
        "disk_avg": avg(disk), "disk_n": len(disk),
        "temp_avg": avg([t["avg"] for t in temps.values()]), "temp_n": len(temps),
        "temps": temps,
    }


def _gb(v) -> str:
    return f"{v / GIB:.1f} GB".replace(".", ",")


def evaluate(board_id: int, facts: dict, extra: dict, fl: dict, hist: dict | None = None) -> list[dict]:
    checks: list[dict] = []

    def add(group, title, level, detail, advice=None):
        checks.append({"group": group, "title": title, "level": level, "detail": detail, "advice": advice})

    # 1) Donanım kapasitesi — filo ortalamasından %20+ düşük
    g = "Donanım kapasitesi"
    for key, avg_key, n_key, label, advice in (
        ("mem_total_bytes", "mem_avg", "mem_n", "RAM",
         "RAM yükseltmesi önerilir: tarayıcı, EBA ve video gibi uygulamalar bu tahtada belirgin biçimde yavaş çalışır."),
        ("disk_total_bytes", "disk_avg", "disk_n", "Disk kapasitesi",
         "Daha büyük bir SSD ile değiştirmeyi planlayın: güncellemeler, önbellek ve kullanıcı dosyaları için alan çabuk daralır."),
    ):
        val, avg, n = facts.get(key), fl[avg_key], fl[n_key]
        if not val:
            add(g, label, "info", "Okunamadı.")
        elif n < 2 or not avg:
            add(g, label, "info", f"{_gb(val)} — karşılaştırma için en az 2 tahtanın donanım bilgisi gerekir.")
        elif val < 0.8 * avg:
            add(g, label, "warn", f"{_gb(val)}; tahtaların ortalaması {_gb(avg)} — ortalamanın %{round(100 - 100 * val / avg)} altında.", advice)
        else:
            add(g, label, "ok", f"{_gb(val)} (tahtaların ortalaması {_gb(avg)}).")

    # 2) Disk sağlığı — SMART + son 7 günün çekirdek disk hataları
    g = "Disk sağlığı (SMART)"
    health = facts.get("smart_health")
    realloc, pending, uncorr = facts.get("smart_reallocated"), facts.get("smart_pending"), facts.get("smart_uncorrectable")
    life, stemp, hours = facts.get("smart_life_left_pct"), facts.get("smart_temp_c"), facts.get("smart_power_on_hours")
    if health is None and hours is None:
        add(g, "SMART", "info", "Okunamadı (smartctl yok ya da disk SMART desteklemiyor).",
            "\"smartmontools\" paketini kurun; sanal ya da USB disklerde SMART okunamayabilir.")
    else:
        if health == "failed":
            add(g, "Genel sağlık testi", "bad", "Disk kendi sağlık testinden GEÇEMEDİ — arıza yakın.",
                "Önce önemli verileri yedekleyin, ardından diski HEMEN değiştirin.")
        if pending:
            add(g, "Bekleyen (okunamayan) sektör", "bad", f"{pending} sektör okunamıyor.",
                "Disk yüzeyinde aktif bozulma var: verileri yedekleyin ve diski değiştirin.")
        worn = [f"{realloc} yeniden atanmış sektör" if realloc else None,
                f"{uncorr} düzeltilemeyen hata" if uncorr else None]
        worn = [w for w in worn if w]
        if worn:
            add(g, "Yıpranma işaretleri", "warn", ", ".join(worn) + ".",
                "Diskte yıpranma başlamış. Önemli verileri yedekleyin ve sorun tespitini haftalık tekrarlayın; "
                "sayılar artıyorsa diski değiştirin.")
        if life is not None and life < 30:
            add(g, "SSD kalan ömrü", "bad" if life < 10 else "warn", f"%{life}.",
                "SSD yazma ömrünün sonuna yaklaşıyor; değişimini planlayın.")
        if stemp is not None and stemp >= 60:
            add(g, "Disk sıcaklığı", "warn", f"{stemp} °C.", "Kasa içi havalandırmayı kontrol edin.")
        if not any(c["group"] == g and c["level"] in ("warn", "bad") for c in checks):
            parts = [f"{hours:,} saat çalışmış".replace(",", ".") if hours is not None else None,
                     f"kalan ömür %{life}" if life is not None else None]
            add(g, "SMART", "ok", "Sağlıklı" + (" — " + ", ".join(p for p in parts if p) if any(parts) else "") + ".")
    if extra.get("io_errors"):
        add(g, "Çekirdek disk hataları (son 7 gün)", "bad",
            f"{extra['io_errors']} disk G/Ç hatası kaydı. Son: {extra['io_sample'] or '—'}",
            "Disk bir süre yanıt vermemiş (tahta donmuş ya da SSH'a cevap vermemiş olabilir). SMART temiz olsa bile "
            "SATA kablosu/bağlantısı, güç beslemesi ya da disk denetleyicisi sorunlu olabilir: kabloyu yeniden "
            "takın ya da değiştirin; tekrarlarsa diski değiştirin.")

    # 3) İşlemci sıcaklığı — son 24 saat ortalaması, filo ortalamasından %20+ yüksek
    g = "İşlemci sıcaklığı"
    t = fl["temps"].get(str(board_id))
    cause = ("Soğutucu ve fan tozlanmış, termal macun kurumuş ya da fan arızalı/yavaş olabilir: tahtanın içini "
             "temizletin, fanın döndüğünü kontrol edin, gerekirse termal macunu yenileyin.")
    if not t:
        cur = facts.get("cpu_temp_c")
        add(g, "Son 24 saat", "info",
            "Sensör verisi yok (tahta kapalıydı ya da \"Metrik izlemeyi kur\" yapılmamış)"
            + (f"; şu an {cur} °C." if cur else "."))
    else:
        avg = fl["temp_avg"]
        detail = f"ortalama {t['avg']:.1f} °C, en yüksek {t['max']:.0f} °C".replace(".", ",", 1)
        if fl["temp_n"] >= 2 and avg and t["avg"] > 1.2 * avg:
            add(g, "Son 24 saat", "warn",
                f"{detail}; tahtaların ortalaması {avg:.1f} °C — %{round(100 * t['avg'] / avg - 100)} daha sıcak.".replace(".", ",", 1),
                cause)
        elif t["max"] >= 90:
            add(g, "Son 24 saat", "bad", f"{detail} — tehlikeli düzey.", cause)
        else:
            add(g, "Son 24 saat", "ok",
                detail + (f" (tahtaların ortalaması {avg:.1f} °C)".replace(".", ",", 1) if fl["temp_n"] >= 2 and avg else "") + ".")
    if extra.get("throttle"):
        add(g, "Isıdan yavaşlatma", "warn", f"Son 7 günde {extra['throttle']} kez işlemci aşırı ısındığı için yavaşlatılmış.", cause)

    # 3b) Soğutma ve donanım sensörleri (Super I/O): fan, kasa içi sıcaklık, CMOS pili
    hist = hist or {"fans": {}, "case_max24": None, "cpu15": None}
    sens = extra.get("sensors") or {"superio": False, "fans": {}, "vbat": None, "case": []}
    g = "Soğutma ve kasa"
    no_sio = ("Anakartın donanım izleme yongası (Super I/O) sürücüsü yüklü değil; fan devri ve CMOS pili okunamıyor.",
              "Komut çalıştır → hazır işlemlerden \"Fan/pil/anakart sensörlerini etkinleştir\"i bu tahtaya uygulayın.")
    if not sens["superio"]:
        add(g, "İşlemci fanı", "info", *no_sio)
    else:
        cur_temp = facts.get("cpu_temp_c")
        temp_note = f" İşlemci şu an {cur_temp} °C." if cur_temp else ""
        stopped, running, unknown = [], [], []
        for sensor, rpm in sorted(sens["fans"].items()):
            seen = hist["fans"].get(sensor, 0)
            if rpm > 0:
                running.append(f"{sensor}: {rpm} RPM")
            elif seen > 0:
                stopped.append(f"{sensor}: 0 RPM (daha önce {seen:.0f} RPM dönüyordu)")
            else:
                unknown.append(sensor)   # hiç dönmemiş giriş: büyük olasılıkla fan bağlı değil
        if stopped:
            add(g, "Fan durmuş", "bad", "; ".join(stopped) + "." + temp_note,
                "Fan dönmüyor: işlemci aşırı ısınıp tahta kendini kapatabilir ya da kalıcı hasar görebilir. Tahtayı "
                "kapatın; fanın toz/kıl ile sıkışmadığını ve kablosunun takılı olduğunu kontrol edin, gerekirse fanı değiştirin.")
        elif running:
            add(g, "İşlemci fanı", "ok", ", ".join(running) + ".")
        else:
            add(g, "İşlemci fanı", "info",
                "Hiçbir fan girişinde devir okunmadı ve geçmişte de dönme kaydı yok." + temp_note,
                "Fan bu girişe bağlı olmayabilir (bazı tahtalarda devir sinyali yoktur); emin olmak için fanın döndüğünü "
                "yerinde kontrol edin.")
    case_now = max(sens["case"], key=lambda c: c[1]) if sens["case"] else None
    case_max = hist["case_max24"]
    if case_now or case_max is not None:
        parts = [f"şu an {case_now[1]:.0f} °C ({case_now[0]})" if case_now else None,
                 f"son 24 saatte en yüksek {case_max:.0f} °C" if case_max is not None else None]
        detail = ", ".join(p for p in parts if p) + "."
        peak = max([v for v in (case_now[1] if case_now else None, case_max) if v is not None])
        if peak >= CASE_WARN_C:
            add(g, "Kasa içi sıcaklık", "warn", detail,
                "Kasa içi sıcak: havalandırma ızgaraları tıkalı, fan(lar) zayıf ya da tahta güneş/kalorifer gibi bir ısı "
                "kaynağına yakın olabilir. Arkasındaki hava boşluğunu, toz birikimini ve fanları kontrol edin.")
        else:
            add(g, "Kasa içi sıcaklık", "ok", detail)
    else:
        add(g, "Kasa içi sıcaklık", "info", "Kasa içi sıcaklık sensörü okunamadı.")

    g = "CMOS pili"
    v = sens["vbat"]
    if not sens["superio"]:
        add(g, "Pil gerilimi", "info", *no_sio)
    elif v is None:
        add(g, "Pil gerilimi", "info", "Donanım izleme yongası pil gerilimini (Vbat) vermiyor.")
    else:
        vt = f"{v:.2f} V".replace(".", ",")
        advice = ("CMOS pilini (CR2032) değiştirin. Pil bitince tahta prizden/sigortadan çekildiğinde saat ve BIOS "
                  "ayarları (ör. Wake-on-LAN, açılış sırası) sıfırlanır; saat yanlış olunca HTTPS ve güncellemeler de bozulur.")
        if v < CMOS_BAD_V:
            add(g, "Pil gerilimi düşük", "bad",
                f"{vt} — {CMOS_BAD_V:.1f} V'un altında; RTC yongası en az 2,0 V ister.".replace(".", ",", 1), advice)
        elif v < CMOS_WARN_V:
            add(g, "Pil zayıflıyor", "warn", f"{vt} (yeni pil ~3,0 V).", advice)
        else:
            add(g, "Pil gerilimi", "ok", f"{vt}.")

    # 4) Boş disk alanı — toplamın %15'inin altı
    g = "Boş disk alanı"
    total, free = facts.get("root_total_bytes"), facts.get("root_free_bytes")
    if total and free is not None:
        pct = 100 * free / total
        detail = f"{_gb(free)} boş / {_gb(total)} (%{pct:.0f})."
        advice = ("Gereksiz dosyaları temizleyin: eski çekirdekler ve paketler (apt autoremove, apt clean), kullanıcıların "
                  "İndirilenler/Masaüstü klasörlerindeki büyük dosyalar, çöp kutuları, sistem günlükleri.")
        if pct < 5:
            add(g, "Kök dosya sistemi (/)", "bad", detail + " Sistem güncellemeleri ve oturum açma başarısız olabilir.", advice)
        elif pct < 15:
            add(g, "Kök dosya sistemi (/)", "warn", detail, advice)
        else:
            add(g, "Kök dosya sistemi (/)", "ok", detail)
    else:
        add(g, "Kök dosya sistemi (/)", "info", "Okunamadı.")
    if extra.get("inode_pct") is not None and extra["inode_pct"] >= 90:
        add(g, "Dosya sayısı sınırı (inode)", "warn", f"%{extra['inode_pct']} dolu — yer olsa bile yeni dosya oluşturulamayabilir.",
            "Çok sayıda küçük dosya üreten önbellek/geçici klasörleri temizleyin.")

    # 5) Linux'u zorlayan donanım/yazılım koşulları
    g = "Yazılım güncellemeleri"
    upg = extra.get("upg_count")
    lists_at = extra.get("apt_lists_at")
    lists_days = (int(time.time()) - lists_at) // 86400 if lists_at else None
    stale = (f" Paket listesi en son {lists_days} gün önce yenilenmiş; gerçek sayı daha fazla olabilir."
             if lists_days is not None and lists_days >= APT_LISTS_STALE_DAYS else "")
    if upg:
        sec = extra.get("upg_security") or 0
        names = extra.get("upg_sample") or []
        more = f" ve {upg - len(names)} paket daha" if upg > len(names) else ""
        add(g, "Bekleyen güncellemeler", "warn",
            f"{upg} paketin güncellemesi var" + (f" ({sec} güvenlik güncellemesi)" if sec else "") +
            (f": {', '.join(names)}{more}." if names else ".") + stale,
            "Hazır komutlardaki \"Sistem güncelleme\" ile güncelleyin; güvenlik güncellemelerini bekletmeyin.")
    elif upg == 0:
        add(g, "Paketler güncel", "ok" if not stale else "info",
            "Güncellemesi bekleyen paket yok." + stale,
            "Paket listesini yenilemek için \"Sistem güncelleme\" çalıştırın." if stale else None)

    g = "Sistem çalışma koşulları"
    mem = facts.get("mem_total_bytes")
    if mem and mem < 3.8 * GIB:
        add(g, "Düşük RAM", "warn", f"{_gb(mem)} — güncel tarayıcı ve masaüstü için yetersiz.",
            "En az 8 GB önerilir; geçici çözüm olarak açık sekme/uygulama sayısını sınırlayın.")
    if mem and mem < 8 * GIB and not extra.get("swap"):
        add(g, "Takas alanı yok", "warn", "RAM dolunca uygulamalar uyarısız kapanır.",
            "zram (sıkıştırılmış RAM takası) ya da bir takas dosyası etkinleştirin.")
    if facts.get("disk_rotational") == 1:
        add(g, "Mekanik disk (HDD)", "warn", "Açılış, oturum açma ve uygulama başlatma belirgin biçimde yavaş.",
            "SSD'ye geçiş bu tahtada en büyük hız kazancını sağlar.")
    if extra.get("root_ro"):
        add(g, "Salt-okunur dosya sistemi", "bad", "Kök dosya sistemi salt-okunur bağlı — genellikle disk hatası sonrası koruma.",
            "Tahtayı yeniden başlatıp dosya sistemi denetimi (fsck) yaptırın; tekrarlıyorsa diski değiştirin.")
    if extra.get("oom"):
        add(g, "Bellek yetersizliği (son 7 gün)", "warn", f"{extra['oom']} kez bellek bittiği için çekirdek uygulama sonlandırmış.",
            "RAM yükseltin ya da takas (zram) ayarını gözden geçirin.")
    if extra.get("failed_units"):
        add(g, "Başarısız servisler", "warn", ", ".join(extra["failed_units"]),
            "Gereksizse devre dışı bırakın (systemctl disable), gerekliyse günlüğünü inceleyin (journalctl -u <servis>).")
    if extra.get("dpkg_broken"):
        add(g, "Yarım kalmış paket kurulumu", "warn", f"{extra['dpkg_broken']} paket yarım kalmış — güncellemeler çalışmaz.",
            "Tahtada \"dpkg --configure -a\" çalıştırın.")
    # Açılıştan hemen sonra NTP henüz eşitlememiş olabilir: en az NTP_GRACE_S geçmeden anomali sayılmaz.
    uptime = extra.get("uptime")
    if extra.get("ntp_sync") == "no" and (uptime is None or uptime >= NTP_GRACE_S):
        detail = "Sistem saati internetten eşitlenmiyor."
        if extra.get("epoch") and extra.get("server_epoch"):
            drift = extra["epoch"] - extra["server_epoch"]
            board_time = time.strftime("%d.%m.%Y %H:%M:%S", time.localtime(extra["epoch"]))
            detail += (f" Tahtanın saati {board_time}; Ankamon sunucusuna göre "
                       + (f"{_drift_text(drift)}." if abs(drift) >= 2 else "şimdilik doğru (sapma 2 sn'den az)."))
        add(g, "Saat eşitlenmemiş", "warn", detail,
            "Yanlış saat HTTPS/sertifika hatalarına ve yanlış log zamanlarına yol açar; NTP erişimini (UDP 123) kontrol edin.")
    cores = facts.get("cpu_cores")
    if extra.get("load15") is not None and cores and extra["load15"] > cores:
        add(g, "Sürekli yüksek yük", "warn", f"Son 15 dk yük ortalaması {extra['load15']:.2f} ({cores} iş parçacığı).",
            "Arka planda takılı ya da ağır bir uygulama olabilir; Web terminalden \"top\" ile inceleyin.")
    if hist["cpu15"] is not None and hist["cpu15"] >= CPU_INFO_PCT:
        top = ", ".join(f"{cmd} %{round(float(pct))}" for pct, cmd in extra.get("top") or [] if pct.replace(".", "", 1).isdigit())
        add(g, "Yüksek işlemci kullanımı", "info",
            f"Son 15 dakikada ortalama %{hist['cpu15']:.0f}." + (f" Şu an en çok kullananlar: {top}." if top else ""),
            "Takılı kalmış ya da ağır bir uygulama olabilir; gereksizse kapatın (Web terminal → top).")
    if extra.get("reboot_required"):
        add(g, "Yeniden başlatma bekliyor", "info", "Kurulan güncellemelerin etkinleşmesi için yeniden başlatma gerekiyor.")
    up = facts.get("uptime_seconds")
    if up and up > 30 * 86400:
        add(g, "Uzun süredir açık", "info", f"{up // 86400} gündür yeniden başlatılmamış.",
            "Bellek sızıntılarını ve bekleyen güncellemeleri temizlemek için ara sıra yeniden başlatın.")
    if not any(c["group"] == g for c in checks):
        add(g, "Genel", "ok", "Sistemi zorlayan bir koşul bulunmadı.")
    return checks


def run(conn, board: dict, user: str, password: str) -> dict:
    """Tek tahtayı denetler. Döner: {"status", "rc", "output"} — output bulguların JSON'u (başarılıysa)."""
    res = _ssh(board, user, password)
    if res["status"] != "ok":
        return res
    now = int(time.time())
    facts = hwfacts.parse(res["output"])
    hwfacts.store(conn, board["board_id"], facts, now)
    checks = evaluate(board["board_id"], facts, _extra(res["output"]), fleet(conn), history(conn, board["board_id"]))
    level = max((c["level"] for c in checks), key=LEVELS.index, default="ok")
    return {"status": "ok", "rc": 0,
            "output": json.dumps({"level": level, "checks": checks, "collected_at": now}, ensure_ascii=False)}
