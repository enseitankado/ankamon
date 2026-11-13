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

"""Güç yoklaması: cihazın şu anki açılışı, sistem diskinin SMART güç sayaçları ve ÖNCEKİ açılışın nasıl bittiği.

Elektrik kesintisi anomalileri için (bkz. anomaly/power_loss.py, göç 055). Tek SSH bağlantısı, salt okunur, ~0,5 sn.

  - SMART: açılış sayısı (Power_Cycle_Count / NVMe power_cycles) ve ani güç kaybı sayacı. İşletim sistemi kapatırken
    (menüden, ETAP "Zorla kapat" — sync + reboot(RB_POWER_OFF) —, eta-shutdown otomatik kapanması — poweroff -f) çekirdek
    diski durdurur (libata STANDBY IMMEDIATE); disk bunu güvenli kapanma sayar. Fiş çekilir ya da elektrik kesilirse
    disk hazırlıksız kapanır ve sayaç artar. Ayrımı yalnız bu sayaç yapar: ETAP'ın zorla/otomatik kapatması da journal'da
    iz bırakmaz, loglardan elektrik kesintisinden ayırt edilemez.
  - Önceki açılış: journal kalıcıdır (/var/log/journal); son satır ve kapanış izi (session_end.py ile aynı ölçüt —
    kullanıcı oturumu yöneticisinin "Reached target shutdown.target" satırı sistem kapanışı DEĞİLDİR, sayılmaz).

Ani güç kaybı sayacının özniteliği diskten diske değişir; ad ile seçilir (_UNSAFE). Sahada (2026-11-13) tahtaların 54/55'inde
Samsung MZ7TE256 (PM851): 235 POR_Recovery_Count. Sayacı olmayan disk (ör. TwinMOS) için unsafe_shutdowns None.
"""

from __future__ import annotations

import json
import os
import re
import subprocess

from .session_probe import _SSH_OPTS

SCRIPT = r"""
echo "BOOT_ID=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
echo "NOW=$(date +%s)"
echo "UPTIME=$(cut -d' ' -f1 /proc/uptime)"
src=$(findmnt -no SOURCE / 2>/dev/null)
d=$(lsblk -ndo PKNAME "$src" 2>/dev/null | head -n 1)
[ -n "$d" ] || d=$(lsblk -d -n -o NAME -e 1,2,7,11 2>/dev/null | awk '$1 !~ /^zram/ {print; exit}')
echo "DISK=$d"
if [ -n "$d" ] && command -v smartctl >/dev/null 2>&1; then
  echo "SMART_JSON=$(smartctl -j -i -A "/dev/$d" 2>/dev/null | tr -d '\n')"
fi
if journalctl --list-boots -q --no-pager 2>/dev/null | awk '$1 == -1 {f = 1} END {exit !f}'; then
  echo "PREV_START=$(journalctl -b -1 -o short-unix -q --no-pager 2>/dev/null | head -n 1 | cut -d' ' -f1)"
  echo "PREV_END=$(journalctl -b -1 -n 1 -o short-unix -q --no-pager 2>/dev/null | cut -d' ' -f1)"
  echo "PREV_LAST=$(journalctl -b -1 -n 1 -o cat -q --no-pager 2>/dev/null | tr -d '\n' | cut -c1-200)"
  tail=$(journalctl -b -1 -n 300 -q --no-pager -o cat 2>/dev/null)
  clean=0; printf '%s\n' "$tail" | grep -qE 'Journal stopped|systemd-shutdown|System is powering down|System is rebooting' && clean=1
  kind=poweroff; printf '%s\n' "$tail" | grep -qE 'System is rebooting|Reached target.*Reboot|reboot\.target' && kind=reboot
  echo "PREV_CLEAN=$clean"
  echo "PREV_KIND=$kind"
fi
echo "ETA_SHUTDOWN=$(tr '\n' ';' < /etc/pardus/eta-shutdown.conf 2>/dev/null)"
"""

# Ani güç kaybı sayacı: öznitelik adı (smartctl'nin sürücü veritabanındaki ad) → öncelik. Döner diskte 192
# Power-Off_Retract_Count güç kesilince kafaların acil park edilmesini sayar (aynı anlam).
_UNSAFE = [
    (re.compile(r"POR_Recovery", re.I), 1),
    (re.compile(r"Unexpect\w*_Power_Loss|Unexpected_Power_Loss|Unsafe_Shutdown|Sudden_Power|SPOR", re.I), 2),
    (re.compile(r"Power-Off_Retract", re.I), 3),
]


def parse_smart(raw: str) -> dict:
    """smartctl -j -i -A → {"model", "power_cycles", "unsafe_shutdowns", "unsafe_attr"} (okunamayan alan None)."""
    out = {"model": None, "power_cycles": None, "unsafe_shutdowns": None, "unsafe_attr": None}
    try:
        data = json.loads(raw) if raw.strip() else {}
    except ValueError:
        return out
    out["model"] = data.get("model_name") or data.get("model_family")
    out["power_cycles"] = data.get("power_cycle_count")
    nvme = data.get("nvme_smart_health_information_log")
    if isinstance(nvme, dict) and isinstance(nvme.get("unsafe_shutdowns"), int):
        out["unsafe_shutdowns"], out["unsafe_attr"] = nvme["unsafe_shutdowns"], "NVMe unsafe_shutdowns"
        if out["power_cycles"] is None:
            out["power_cycles"] = nvme.get("power_cycles")
        return out
    best = None
    for a in (data.get("ata_smart_attributes") or {}).get("table", []):
        name = a.get("name") or ""
        value = (a.get("raw") or {}).get("value")
        if a.get("id") == 12 and out["power_cycles"] is None and isinstance(value, int):
            out["power_cycles"] = value
        if not isinstance(value, int):
            continue
        for pattern, rank in _UNSAFE:
            if pattern.search(name) and (best is None or rank < best[0]):
                best = (rank, value, f"{a.get('id')} {name}")
    if best:
        out["unsafe_shutdowns"], out["unsafe_attr"] = best[1], best[2]
    return out


def _epoch(value: str):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _eta_conf(raw: str) -> dict:
    """eta-shutdown.conf (bölümler ';' ile tek satır) → {"AUTO_SHUTDOWN.enabled": "true", ...}."""
    conf, section = {}, ""
    for item in (raw or "").split(";"):
        item = item.strip()
        if item.startswith("[") and item.endswith("]"):
            section = item[1:-1]
        elif "=" in item:
            key, _, value = item.partition("=")
            conf[f"{section}.{key.strip()}"] = value.strip().strip('"').lower()
    return conf


def parse(output: str) -> dict | None:
    """SCRIPT çıktısı → yoklama kaydı (bkz. göç 055); açılış kimliği okunamadıysa None."""
    values = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
    boot_id = (values.get("BOOT_ID") or "").strip()
    now, uptime = _epoch(values.get("NOW")), _epoch(values.get("UPTIME"))
    if not boot_id or now is None or uptime is None:
        return None
    smart = parse_smart(values.get("SMART_JSON", ""))
    clean = values.get("PREV_CLEAN")
    return {
        "boot_id": boot_id,
        "booted_at": now - uptime,
        "disk": (values.get("DISK") or "").strip() or None,
        "disk_model": smart["model"],
        "power_cycles": smart["power_cycles"],
        "unsafe_shutdowns": smart["unsafe_shutdowns"],
        "unsafe_attr": smart["unsafe_attr"],
        "prev_started_at": _epoch(values.get("PREV_START")),
        "prev_ended_at": _epoch(values.get("PREV_END")),
        "prev_clean": None if clean not in ("0", "1") else clean == "1",
        "prev_kind": (values.get("PREV_KIND") or "").strip() or None,
        "prev_last_line": (values.get("PREV_LAST") or "").strip() or None,
        "eta_shutdown": _eta_conf(values.get("ETA_SHUTDOWN", "")),
    }


def probe(device: dict, user: str, password: str, timeout: int = 20) -> dict | None:
    """Cihazı yoklar; başarısızsa None."""
    if not device.get("ip"):
        return None
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, "-o", "ConnectTimeout=6", f"{user}@{device['ip']}", SCRIPT]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None
    if proc.returncode != 0:
        return None
    return parse(proc.stdout.decode("utf-8", "replace"))


def store(conn, device_id: int, rec: dict) -> None:
    """Açılış başına tek satır; aynı açılışta yeniden yoklanırsa sayaçlar ve probed_at tazelenir (ilk okuma zamanı kalır)."""
    conn.execute(
        """INSERT INTO device_power_probes (device_id, boot_id, booted_at, disk, disk_model, power_cycles,
                                           unsafe_shutdowns, unsafe_attr, prev_started_at, prev_ended_at, prev_clean,
                                           prev_kind, prev_last_line, eta_shutdown)
           VALUES (%s, %s, to_timestamp(%s), %s, %s, %s, %s, %s, to_timestamp(%s), to_timestamp(%s), %s, %s, %s, %s::jsonb)
           ON CONFLICT (device_id, boot_id) DO UPDATE SET
             probed_at = now(), power_cycles = COALESCE(EXCLUDED.power_cycles, device_power_probes.power_cycles),
             unsafe_shutdowns = COALESCE(EXCLUDED.unsafe_shutdowns, device_power_probes.unsafe_shutdowns),
             unsafe_attr = COALESCE(EXCLUDED.unsafe_attr, device_power_probes.unsafe_attr),
             disk_model = COALESCE(EXCLUDED.disk_model, device_power_probes.disk_model),
             eta_shutdown = EXCLUDED.eta_shutdown""",
        (device_id, rec["boot_id"], rec["booted_at"], rec["disk"], rec["disk_model"], rec["power_cycles"],
         rec["unsafe_shutdowns"], rec["unsafe_attr"], rec["prev_started_at"], rec["prev_ended_at"], rec["prev_clean"],
         rec["prev_kind"], rec["prev_last_line"], json.dumps(rec["eta_shutdown"], ensure_ascii=False)))
