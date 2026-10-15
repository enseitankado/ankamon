"""Tahtanın donanım/sistem bilgisini (disk, RAM, işlemci, wifi, ağ, ekran, işletim sistemi…) SSH ile toplar.

İki yol bu modülü paylaşır:
  - board_identity.py: tahta ilk kez tanınırken (MAC öğrenilirken) aynı SSH turunda bir kez toplar.
  - runner "facts" görev türü (Tahtalar/Ekranlar sağ menüsü "Bilgi kartı"): istenince CANLI toplar;
    aynı tahtaya CACHE_SECONDS içinde tekrar bağlanmaz, boards.facts'teki son değeri döner.

Sonuç boards.facts (jsonb) içinde _FIELDS'in değerleri + hw_collected_at (unix saniye) olarak saklanır.
Durum bilgileri (boş disk, wifi bağlantısı, açık kalma süresi, sıcaklık) toplandığı ANA aittir —
kart bunları toplanma zamanıyla birlikte gösterir.
"""

from __future__ import annotations

import json
import os
import subprocess

CACHE_SECONDS = 3600  # "Bilgi kartı" aynı tahtaya bu süre içinde tekrar bağlanmaz.

# Kurallar (gerçek ETAP tahtalarında gözlenenler):
# - awk'ta "print" yerine "printf %.0f": tahtalardaki awk büyük sayıları (GB mertebesi bayt) üstel
#   gösterimde (ör. "2,59942e+11", yerel ayara göre VİRGÜLLÜ) basıyordu; "%.0f" düz tamsayı zorlar.
# - Yerel ayar Türkçe: df başlıkları, nmcli'nin ACTIVE sütunu ("hayır") vb. çevriliyor — ayrıştırılan
#   komutlar LC_ALL=C ile çalışır.
# - lsblk -e 1,2,7,11: ram/floppy/loop/sr hariç; zram (RAM'de sıkıştırılmış takas, ETAP'ta varsayılan)
#   dinamik majör numaralı olduğundan ADINDAN ayıklanır — yoksa disk kapasitesine eklenir.
# - Satır başına bir "ANAHTAR=değer"; board_identity.py bu betiğin önüne kendi HOSTNAME/MAC satırlarını
#   ekler — buradaki anahtarlar onlarla çakışmamalı.
SCRIPT = r"""
export LC_ALL=C
echo "DISK_TOTAL=$(lsblk -b -d -n -o NAME,SIZE -e 1,2,7,11 2>/dev/null | awk '$1 !~ /^zram/ {s+=$2} END{printf "%.0f", s}')"
lsblk -d -n -o NAME,ROTA,TRAN,MODEL -e 1,2,7,11 2>/dev/null | awk '$1 !~ /^zram/ {
    r=$2; t=$3; $1=$2=$3=""; sub(/^ +/, ""); print "DISK_MODEL=" $0; print "DISK_ROTA=" r; print "DISK_TRAN=" t; exit}'
df -B1 -P / 2>/dev/null | awk 'NR==2{printf "ROOT_TOTAL=%.0f\nROOT_USED=%.0f\nROOT_FREE=%.0f\n", $2, $3, $4}'
awk '/^MemTotal/{printf "MEM_TOTAL=%.0f\n", $2*1024} /^MemAvailable/{printf "MEM_AVAILABLE=%.0f\n", $2*1024}
     /^SwapTotal/{printf "SWAP_TOTAL=%.0f\n", $2*1024}' /proc/meminfo
echo "BIOS_VERSION=$(cat /sys/class/dmi/id/bios_version 2>/dev/null)"
echo "BIOS_DATE=$(cat /sys/class/dmi/id/bios_date 2>/dev/null)"
echo "KERNEL_VERSION=$(uname -r)"
echo "ARCH=$(uname -m)"
echo "OS_NAME=$(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"
echo "UPTIME=$(awk '{printf "%.0f", $1}' /proc/uptime)"
echo "BOARD_MODEL=$(cat /sys/class/dmi/id/board_vendor 2>/dev/null) $(cat /sys/class/dmi/id/board_name 2>/dev/null)"
echo "PRODUCT=$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null) $(cat /sys/class/dmi/id/product_name 2>/dev/null)"
echo "SERIAL=$(cat /sys/class/dmi/id/product_serial 2>/dev/null)"
echo "CPU_VENDOR=$(awk -F: '/vendor_id/{gsub(/^ +/,"",$2); print $2; exit}' /proc/cpuinfo)"
echo "CPU_MODEL=$(awk -F: '/model name/{gsub(/^ +/,"",$2); print $2; exit}' /proc/cpuinfo)"
echo "CPU_CORES=$(nproc 2>/dev/null)"
lscpu 2>/dev/null | awk -F: '/^Core\(s\) per socket/{c=$2} /^Socket\(s\)/{s=$2} END{if (c && s) printf "CPU_PHYS_CORES=%.0f\n", c*s}'
echo "CPU_MAX_MHZ=$(awk '{printf "%.0f", $1/1000}' /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq 2>/dev/null)"
echo "CPU_TEMP=$(cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | awk '$1>m{m=$1} END{if (m) printf "%.0f", m/1000}')"
echo "GPU=$(lspci 2>/dev/null | awk -F': ' '/VGA|3D controller|Display controller/{print $2; exit}')"
screens=""
for c in /sys/class/drm/card*-*; do
    [ "$(cat "$c/status" 2>/dev/null)" = connected ] || continue
    screens="$screens${screens:+, }${c##*/card?-} $(head -n 1 "$c/modes" 2>/dev/null)"
done
echo "SCREENS=$screens"
echo "TOUCH=$(awk -F'"' '/^N: Name=/ && tolower($2) ~ /touch|ilitek|egalax|goodix|elan/ {print $2; exit}' /proc/bus/input/devices)"
echo "TIHA_VERSION=$(sed -n 's/.*"tiha_version": *"\([^"]*\)".*/\1/p' /etc/tiha-image-info.json 2>/dev/null | head -n 1)"
echo "TIHA_PREPARED_AT=$(sed -n 's/.*"prepared_at": *"\([^"]*\)".*/\1/p' /etc/tiha-image-info.json 2>/dev/null | head -n 1)"
eth=""; wifi=""
for d in /sys/class/net/*; do
    [ -e "$d/device" ] || continue
    if [ -e "$d/wireless" ] || [ -e "$d/phy80211" ]; then [ -n "$wifi" ] || wifi=${d##*/}; else [ -n "$eth" ] || eth=${d##*/}; fi
done
if [ -n "$eth" ]; then
    echo "ETH_IFACE=$eth"
    echo "ETH_STATE=$(cat /sys/class/net/$eth/operstate 2>/dev/null)"
    echo "ETH_SPEED=$(cat /sys/class/net/$eth/speed 2>/dev/null | awk '$1>0{printf "%.0f", $1}')"
    echo "ETH_IP=$(ip -o -4 addr show dev $eth 2>/dev/null | awk '{print $4; exit}')"
    echo "ETH_CHIP=$(lspci -s "$(basename "$(readlink -f /sys/class/net/$eth/device)")" 2>/dev/null | sed 's/^[^ ]* [^:]*: //')"
fi
if [ -n "$wifi" ]; then
    echo "WIFI_IFACE=$wifi"
    echo "WIFI_MAC=$(cat /sys/class/net/$wifi/address 2>/dev/null)"
    echo "WIFI_DRIVER=$(basename "$(readlink /sys/class/net/$wifi/device/driver 2>/dev/null)" 2>/dev/null)"
    dev=$(readlink -f /sys/class/net/$wifi/device)
    chip=$(lspci -s "$(basename "$dev")" 2>/dev/null | sed 's/^[^ ]* [^:]*: //')
    [ -n "$chip" ] || chip="$(cat "$dev/../manufacturer" 2>/dev/null) $(cat "$dev/../product" 2>/dev/null)"  # USB wifi
    echo "WIFI_CHIP=$chip"
    echo "WIFI_RADIO=$(nmcli radio wifi 2>/dev/null)"
    echo "WIFI_STATE=$(nmcli -t -f DEVICE,STATE device 2>/dev/null | awk -F: -v d="$wifi" '$1==d{print $2; exit}')"
    for r in /sys/class/rfkill/rfkill*; do
        [ "$(cat "$r/type" 2>/dev/null)" = wlan ] || continue
        echo "WIFI_BLOCKED=$([ "$(cat "$r/hard")" = 1 ] && echo hard || { [ "$(cat "$r/soft")" = 1 ] && echo soft || echo no; })"
        break
    done
    # SSID son sütunda: içinde ":" geçebilir (nmcli -t onu "\:" diye kaçırır) — kalan alanlar birleştirilir.
    nmcli -t -f ACTIVE,SIGNAL,FREQ,SSID device wifi list ifname "$wifi" --rescan no 2>/dev/null | awk -F: '
        {n++} $1=="yes"{ssid=$4; for (i=5; i<=NF; i++) ssid=ssid ":" $i; gsub(/\\/, "", ssid)
                        printf "WIFI_SSID=%s\nWIFI_SIGNAL=%s\nWIFI_FREQ=%s\n", ssid, $2, $3}
        END{printf "WIFI_VISIBLE=%.0f\n", n}'
    echo "WIFI_IP=$(ip -o -4 addr show dev $wifi 2>/dev/null | awk '{print $4; exit}')"
fi
# SMART: ilk (sistem) diskinin sağlık özeti ve öznitelikleri, smartctl'nin JSON çıktısı tek satır
# olarak (ayrıştırma Python'da — SATA ve NVMe aynı yoldan; bkz. _smart). ETAP imajında smartmontools kurulu.
sdev=$(lsblk -d -n -o NAME -e 1,2,7,11 2>/dev/null | awk '$1 !~ /^zram/ {print; exit}')
if [ -n "$sdev" ] && command -v smartctl >/dev/null 2>&1; then
    echo "SMART_JSON=$(smartctl -j -H -A "/dev/$sdev" 2>/dev/null | tr -d '\n')"
fi
"""

_FIELDS = {
    "DISK_TOTAL": "disk_total_bytes",
    "DISK_MODEL": "disk_model",
    "DISK_ROTA": "disk_rotational",
    "DISK_TRAN": "disk_transport",
    "ROOT_TOTAL": "root_total_bytes",
    "ROOT_USED": "root_used_bytes",
    "ROOT_FREE": "root_free_bytes",
    "MEM_TOTAL": "mem_total_bytes",
    "MEM_AVAILABLE": "mem_available_bytes",
    "SWAP_TOTAL": "swap_total_bytes",
    "BIOS_VERSION": "bios_version",
    "BIOS_DATE": "bios_date",
    "KERNEL_VERSION": "kernel_version",
    "ARCH": "arch",
    "OS_NAME": "os_name",
    "UPTIME": "uptime_seconds",
    "BOARD_MODEL": "motherboard_model",
    "PRODUCT": "product",
    "SERIAL": "serial",
    "CPU_VENDOR": "cpu_vendor",
    "CPU_MODEL": "cpu_model",
    "CPU_CORES": "cpu_cores",
    "CPU_PHYS_CORES": "cpu_phys_cores",
    "CPU_MAX_MHZ": "cpu_max_mhz",
    "CPU_TEMP": "cpu_temp_c",
    "GPU": "gpu",
    "SCREENS": "screens",
    "TOUCH": "touch",
    "TIHA_VERSION": "tiha_version",
    "TIHA_PREPARED_AT": "tiha_prepared_at",
    "ETH_IFACE": "eth_iface",
    "ETH_STATE": "eth_state",
    "ETH_SPEED": "eth_speed_mbps",
    "ETH_IP": "eth_ip",
    "ETH_CHIP": "eth_chip",
    "WIFI_IFACE": "wifi_iface",
    "WIFI_MAC": "wifi_mac",
    "WIFI_DRIVER": "wifi_driver",
    "WIFI_CHIP": "wifi_chip",
    "WIFI_RADIO": "wifi_radio",
    "WIFI_STATE": "wifi_state",
    "WIFI_BLOCKED": "wifi_blocked",
    "WIFI_SSID": "wifi_ssid",
    "WIFI_SIGNAL": "wifi_signal",
    "WIFI_FREQ": "wifi_freq",
    "WIFI_VISIBLE": "wifi_visible",
    "WIFI_IP": "wifi_ip",
}

# Tam sayıya ayrıştırılacak (metin değil) alanlar. wifi_visible ve disk_rotational 0 olabilir —
# _ZERO_OK'takiler için 0 geçerli bir değerdir, diğerlerinde 0 "okunamadı" (None) sayılır.
_NUMERIC_FIELDS = {
    "disk_total_bytes", "root_total_bytes", "root_used_bytes", "root_free_bytes", "mem_total_bytes",
    "mem_available_bytes", "swap_total_bytes", "uptime_seconds", "cpu_cores", "cpu_phys_cores",
    "cpu_max_mhz", "cpu_temp_c", "eth_speed_mbps", "wifi_signal", "wifi_visible", "disk_rotational",
}
_ZERO_OK = {"wifi_visible", "disk_rotational", "swap_total_bytes", "root_used_bytes"}

# SMART_JSON satırından türetilen alanlar (bkz. _smart). Değeri 0 olan sayaçlar geçerlidir (sağlıklı disk).
_SMART_FIELDS = [
    "smart_health",          # "passed" | "failed" | None (SMART yok/okunamadı)
    "smart_power_on_hours",
    "smart_power_cycles",
    "smart_temp_c",
    "smart_life_left_pct",   # SSD kalan ömür (%), üreticinin bildirdiği; bilinmiyorsa None
    "smart_reallocated",     # yeniden atanmış sektör (ATA 5)
    "smart_pending",         # okunamayan, atanmayı bekleyen sektör (ATA 197)
    "smart_uncorrectable",   # düzeltilemeyen hata (ATA 187/198, NVMe media_errors)
    "smart_failing",         # eşiğin altına düşmüş öznitelik adları (virgüllü) ya da None
]
_ALL_FIELDS = list(_FIELDS.values()) + _SMART_FIELDS

# /proc/cpuinfo vendor_id → okunur üretici adı.
_CPU_VENDORS = {"GenuineIntel": "Intel", "AuthenticAMD": "AMD", "CentaurHauls": "VIA", "HygonGenuine": "Hygon"}


def parse(output: str) -> dict:
    """SCRIPT çıktısını facts sözlüğüne çevirir. Sayısal alanlar int (okunamadıysa None), metinler
    trim edilmiş string (boşsa None — ör. BIOS bilgisi olmayan bir sanal makine)."""
    values = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
    facts: dict = {}
    for key, field in _FIELDS.items():
        raw = (values.get(key) or "").strip()
        if field in _NUMERIC_FIELDS:
            ok = raw.isdigit() and (int(raw) > 0 or field in _ZERO_OK)
            facts[field] = int(raw) if ok else None
        else:
            facts[field] = raw or None
    if facts["cpu_vendor"]:
        facts["cpu_vendor"] = _CPU_VENDORS.get(facts["cpu_vendor"], facts["cpu_vendor"])
    if facts["wifi_freq"]:
        facts["wifi_freq"] = facts["wifi_freq"].replace(" MHz", "")
    facts.update(_smart(values.get("SMART_JSON", "")))
    return facts


def _smart(raw: str) -> dict:
    """smartctl -j -H -A çıktısından özet alanlar (bkz. _SMART_FIELDS). SATA'da öznitelik tablosu,
    NVMe'de sağlık günlüğü okunur; ortak alanlar (çalışma saati, sıcaklık) smartctl'nin normalleştirdiği
    üst düzey anahtarlardan gelir."""
    out: dict = {f: None for f in _SMART_FIELDS}
    try:
        data = json.loads(raw) if raw.strip() else {}
    except ValueError:
        return out
    status = data.get("smart_status")
    if isinstance(status, dict) and "passed" in status:
        out["smart_health"] = "passed" if status["passed"] else "failed"
    out["smart_power_on_hours"] = (data.get("power_on_time") or {}).get("hours")
    out["smart_power_cycles"] = data.get("power_cycle_count")
    out["smart_temp_c"] = (data.get("temperature") or {}).get("current")

    attrs = {a.get("id"): a for a in (data.get("ata_smart_attributes") or {}).get("table", [])}
    raw_of = lambda i: (attrs[i].get("raw") or {}).get("value") if i in attrs else None  # noqa: E731
    if attrs:
        out["smart_reallocated"] = raw_of(5)
        out["smart_pending"] = raw_of(197)
        out["smart_uncorrectable"] = raw_of(187) if 187 in attrs else raw_of(198)
        # Kalan ömür: SSD_Life_Left (231) > Media_Wearout_Indicator (233) > Wear_Leveling_Count (177),
        # normalleştirilmiş VALUE (100 = yeni). Hiçbiri yoksa (döner disk ya da bilinmeyen SSD) None.
        for i in (231, 233, 177):
            if i in attrs and isinstance(attrs[i].get("value"), int):
                out["smart_life_left_pct"] = min(100, attrs[i]["value"])
                break
        failing = [a.get("name", str(i)) for i, a in attrs.items() if a.get("when_failed")]
        out["smart_failing"] = ", ".join(failing) or None
    nvme = data.get("nvme_smart_health_information_log")
    if isinstance(nvme, dict):
        if isinstance(nvme.get("percentage_used"), int):
            out["smart_life_left_pct"] = max(0, 100 - nvme["percentage_used"])
        out["smart_uncorrectable"] = nvme.get("media_errors")
    return out


_SSH_OPTS = [
    "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
]


def query(board: dict, user: str, password: str, timeout: int = 10) -> dict:
    """Tek tahtaya bağlanıp donanım bilgisini okur (whoami.query ile aynı hafif ssh+sshpass deseni —
    tek, sabit betik olduğundan ansible gerekmez). Döner: {"status","rc","output"} — başarılıysa
    output, ayrıştırılmış facts'in JSON metni (job_targets.output, frontend bunu ayrıştırır)."""
    if not board.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    target = f"{user}@{board['ip']}"
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, "-o", f"ConnectTimeout={min(timeout, 8)}", target, SCRIPT]
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
    facts = parse(proc.stdout.decode("utf-8", "replace"))
    return {"status": "ok", "rc": 0, "output": json.dumps(facts, ensure_ascii=False)}


def cached(conn, board_id: int, cutoff_ts: int) -> dict | None:
    """boards.facts'te CACHE_SECONDS içinde toplanmış donanım bilgisi varsa döner, yoksa None
    (hiç toplanmamış ya da bayatlamış — çağıran bu durumda query() ile canlı toplar)."""
    row = conn.execute("SELECT facts FROM boards WHERE id = %s", (board_id,)).fetchone()
    facts = (row or {}).get("facts") or {}
    collected_at = facts.get("hw_collected_at")
    # Alanlardan biri hiç yoksa kayıt eski bir sürümle toplanmıştır: bayat sayılır, canlı toplanır.
    if not collected_at or collected_at < cutoff_ts or any(f not in facts for f in _ALL_FIELDS):
        return None
    return {field: facts.get(field) for field in _ALL_FIELDS}


def store(conn, board_id: int, facts: dict, ts: int) -> None:
    """Toplanan facts'i boards.facts'e (mevcut diğer anahtarları — ör. identity_failed_at — KORUYARAK)
    yazar. Yalnız _FIELDS alanları yazılır; eski sürümden kalan, artık toplanmayan anahtar yoktur."""
    data = {field: facts.get(field) for field in _ALL_FIELDS}
    data["hw_collected_at"] = ts
    conn.execute("UPDATE boards SET facts = facts || %s::jsonb WHERE id = %s",
                 (json.dumps(data, ensure_ascii=False), board_id))


# Wi-Fi radyosunu değiştiren hazır işlemler (actions/<id>) → işlemden sonraki radyo durumu.
WIFI_ACTIONS = {"wifi-on": "enabled", "wifi-off": "disabled"}


def mark_wifi_radio(conn, board_id: int, radio: str) -> None:
    """wifi-on/wifi-off işlemi bir tahtada başarıyla bitince boards.facts'teki Wi-Fi durumunu hemen
    günceller: grid ve önbellekli "Bilgi kartı" bir sonraki tam toplamaya (CACHE_SECONDS) kadar eski
    durumu göstermesin. Kapatınca bağlantı bilgileri de silinir; açınca bağlantı birkaç saniye sonra
    kurulacağından durum bilinmiyor (None) sayılır. Kartı olmayan tahtada (wifi_iface yok) dokunulmaz."""
    conn.execute(
        """UPDATE boards SET facts = facts || jsonb_build_object(
               'wifi_radio', %s::text, 'wifi_state', %s::text, 'wifi_ssid', NULL, 'wifi_signal', NULL,
               'wifi_freq', NULL, 'wifi_ip', NULL)
           WHERE id = %s AND facts->>'wifi_iface' IS NOT NULL""",
        (radio, "unavailable" if radio == "disabled" else None, board_id))
