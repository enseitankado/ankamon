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
import re
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
# Takılı bellek (SMBIOS tür 17): MemTotal, çekirdek/firmware/tümleşik grafiğin ayırdığı kısım düşülmüş
# hâlidir (8 GB modülde ~7.2 GB) — kullanıcıya "8 GB" görünmeli. Boş yuvalar ("No Module Installed")
# sayılmaz; eski dmidecode "8192 MB", yenisi "8 GB" yazar.
dmidecode -t 17 2>/dev/null | awk -F': ' '
    /^\tSize: [0-9]+ (MB|GB|TB)/ { split($2, a, " "); s += (a[2] == "TB" ? a[1] * 1048576 : a[2] == "GB" ? a[1] * 1024 : a[1]); n++ }
    /^\tType: / && $2 != "Unknown" && $2 != "Other" && t == "" { t = $2 }
    /^\tConfigured (Memory|Clock) Speed: [0-9]/ && cs == "" { cs = $2 }
    /^\tSpeed: [0-9]/ && sp == "" { sp = $2 }
    END { if (s) { printf "MEM_INSTALLED=%.0f\nMEM_MODULES=%d\n", s * 1048576, n
                   if (t != "") print "MEM_TYPE=" t
                   if (cs != "" || sp != "") print "MEM_SPEED=" (cs != "" ? cs : sp) } }'
# Paylaşımlı ekran belleği: yalnız TÜMLEŞİK grafikte (PCI veriyolu 00 — ayrı kart 01+ ve kendi belleği
# var) takılı RAM'den ayrılan kısım. Intel (i915): /proc/iomem "Graphics Stolen Memory" aralığı;
# AMD amdgpu: sysfs mem_info_vram_total; radeon: açılış iletisi "radeon: 512M of VRAM memory ready".
gpu_slot=$(lspci -D 2>/dev/null | awk '/VGA|Display|3D controller/ {print $1; exit}')
case "$gpu_slot" in
0000:00:*)
    r=$(grep -m1 "Graphics Stolen Memory" /proc/iomem 2>/dev/null | awk '{print $1}')
    v=""
    if [ -n "$r" ]; then
        v=$((0x${r#*-} - 0x${r%-*} + 1))
    else
        v=$(cat /sys/class/drm/card[0-9]/device/mem_info_vram_total 2>/dev/null | head -1)
        if [ -z "$v" ]; then
            m=$( { dmesg 2>/dev/null; journalctl -k -b -o cat 2>/dev/null; } | sed -n 's/.*\(radeon\|amdgpu\): \([0-9][0-9]*\)M of VRAM memory ready.*/\2/p' | head -1)
            [ -n "$m" ] && v=$((m * 1048576))
        fi
    fi
    [ -n "$v" ] && [ "$v" -gt 0 ] && echo "GPU_SHARED_MEM=$v"
    ;;
esac
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
# --- Bilgi kartı "Diskler ve bölümler", "UEFI / önyükleme", "UEFI değişkenleri" (ayrıştırma: _disk_layout,
# _firmware_boot, _uefi_vars). Tümü salt okunur; gerçek ETAP tahtasında bu blok ~1,5 sn sürüyor.
# Disk ağacı (bölümler, GUID'ler, dosya sistemi boyut/boş alanı) lsblk JSON'u; bölüm tablosunun kendi
# kaydı (disk kimliği, ilk/son LBA, bölüm öznitelikleri, MBR'de etkin bölüm) sfdisk JSON'u. Bölümlenmemiş
# alan sfdisk -F'nin ilk satırındaki bayt; GPT'de sgdisk -v başlık/yedek tablo/çakışma denetimi yapar.
# MBR'nin ilk 440 baytı açılış kodudur: hepsi sıfır = boş, "GRUB" geçiyorsa GRUB (legacy açılış).
echo "DISK_LAYOUT_JSON=$(lsblk -J -b -e 1,2,7,11 -o NAME,PATH,TYPE,SIZE,FSTYPE,FSVER,LABEL,UUID,PARTUUID,PARTLABEL,PARTTYPE,PARTTYPENAME,PARTFLAGS,PTUUID,PTTYPE,MOUNTPOINT,FSSIZE,FSAVAIL,FSUSED,MODEL,SERIAL,REV,WWN,ROTA,TRAN,LOG-SEC,PHY-SEC,RO,RM 2>/dev/null | tr -d '\n')"
for d in $(lsblk -d -n -o NAME -e 1,2,7,11 2>/dev/null | grep -v '^zram'); do
    echo "DISK_PTABLE_JSON=$(sfdisk -J "/dev/$d" 2>/dev/null | tr -d '\n')"
    free=$(sfdisk -F "/dev/$d" 2>/dev/null | sed -n '1s/.*, \([0-9][0-9]*\) bytes, .*/\1/p')
    check=""
    if [ "$(lsblk -d -n -o PTTYPE "/dev/$d" 2>/dev/null)" = gpt ] && command -v sgdisk >/dev/null 2>&1; then
        check=$(sgdisk -v "/dev/$d" 2>/dev/null | grep -oE 'No problems found|Identified [0-9]+ problems?' | head -n 1)
    fi
    code=other
    [ "$(head -c 440 "/dev/$d" 2>/dev/null | tr -d '\000' | wc -c)" -eq 0 ] && code=empty
    head -c 440 "/dev/$d" 2>/dev/null | grep -aq GRUB && code=grub
    echo "DISK_EXTRA=$d|$free|$code|$check"
done
# Firmware: UEFI mi legacy (BIOS/CSM) mi — /sys/firmware/efi yalnız UEFI açılışta var. EFI sürümü ve
# üreticisi çekirdeğin açılış iletisinden ("efi: EFI v2.3.1 by American Megatrends"); değişken deposunun
# toplam/dolu/boş alanı efivarfs'in df'i (firmware QueryVariableInfo). Değişkenlerin her biri: ad-GUID,
# boyut, değiştirilemez (chattr +i, çekirdek bilinmeyen üretici değişkenlerini böyle korur) ve içeriğin
# ilk baytları onaltılık (ilk 4 bayt öznitelik). Açılış girdileri (Boot####) tam okunur (açıklama +
# aygıt yolu), diğerleri yalnız önizleme kadar — büyük ikili kayıtlar (MemContextNv 4 KB…) taşınmaz.
echo "BIOS_VENDOR=$(cat /sys/class/dmi/id/bios_vendor 2>/dev/null)"
echo "BIOS_RELEASE=$(cat /sys/class/dmi/id/bios_release 2>/dev/null)"
echo "BOARD_VERSION=$(cat /sys/class/dmi/id/board_version 2>/dev/null)"
echo "BOARD_SERIAL=$(cat /sys/class/dmi/id/board_serial 2>/dev/null)"
echo "PRODUCT_VERSION=$(cat /sys/class/dmi/id/product_version 2>/dev/null)"
echo "PRODUCT_UUID=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null)"
echo "KERNEL_CMDLINE=$(cat /proc/cmdline 2>/dev/null)"
if [ -d /sys/firmware/efi ]; then
    echo "FW_MODE=uefi"
    echo "FW_BITS=$(cat /sys/firmware/efi/fw_platform_size 2>/dev/null)"
    echo "FW_EFI=$( { dmesg 2>/dev/null; journalctl -k -b -o cat 2>/dev/null; } | sed -n 's/.*efi: EFI v\([^ ]*\) by \(.*\)$/\1|\2/p' | head -n 1)"
    df -B1 -P /sys/firmware/efi/efivars 2>/dev/null | awk 'NR==2{printf "FW_VARSTORE=%.0f|%.0f|%.0f\n", $2, $3, $4}'
    echo "FW_ESP_DIRS=$(ls -1 /boot/efi/EFI 2>/dev/null | tr '\n' ' ')"
    efibootmgr -v 2>/dev/null | sed 's/^/FW_BOOTMGR=/'
    lsattr /sys/firmware/efi/efivars 2>/dev/null | awk '$1 ~ /i/ {n=$2; sub(/.*\//, "", n); print "UEFI_IMMUTABLE=" n}'
    for v in /sys/firmware/efi/efivars/*; do
        [ -f "$v" ] || continue
        n=${v##*/}
        case "$n" in Boot[0-9A-F][0-9A-F][0-9A-F][0-9A-F]-*|Driver[0-9A-F][0-9A-F][0-9A-F][0-9A-F]-*) lim=1028 ;; *) lim=68 ;; esac
        echo "UEFI_VAR=$n|$(stat -c %s "$v" 2>/dev/null)|$(od -An -tx1 -v -N "$lim" "$v" 2>/dev/null | tr -d ' \n')"
    done
else
    echo "FW_MODE=legacy"
fi
# TPM: sürüm (1 = TPM 1.2, 2 = TPM 2.0); 1.2'de etkin/aktif/sahipli bayrakları ve üretici/firmware (caps).
for t in /sys/class/tpm/tpm[0-9]*; do
    [ -e "$t" ] || continue
    echo "TPM_INFO=$(cat "$t/tpm_version_major" 2>/dev/null)|$(cat "$t/device/enabled" 2>/dev/null)|$(cat "$t/device/active" 2>/dev/null)|$(cat "$t/device/owned" 2>/dev/null)|$(sed -n 's/^Manufacturer: *//p' "$t/device/caps" 2>/dev/null)|$(sed -n 's/^Firmware version: *//p' "$t/device/caps" 2>/dev/null)"
    break
done
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
    "MEM_INSTALLED": "mem_installed_bytes",
    "MEM_MODULES": "mem_modules",
    "MEM_TYPE": "mem_type",
    "MEM_SPEED": "mem_speed",
    "GPU_SHARED_MEM": "gpu_shared_bytes",
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
    "PRODUCT_VERSION": "product_version",
    "PRODUCT_UUID": "product_uuid",
    "BOARD_VERSION": "board_version",
    "BOARD_SERIAL": "board_serial",
    "BIOS_VENDOR": "bios_vendor",
    "BIOS_RELEASE": "bios_release",
    "KERNEL_CMDLINE": "kernel_cmdline",
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
    "mem_installed_bytes", "mem_modules", "gpu_shared_bytes",
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
# Çok değerli/yapılı alanlar (bkz. _disk_layout, _firmware_boot, _uefi_vars). Tahta başına ~10-15 KB:
# Tahtalar listesi (backend BoardsApi::COLUMNS) bunları facts'ten çıkarır, yalnız Bilgi kartı ("facts"
# görevinin çıktısı) taşır.
_DETAIL_FIELDS = ["disk_layout", "firmware_boot", "uefi_vars"]
_ALL_FIELDS = list(_FIELDS.values()) + _SMART_FIELDS + _DETAIL_FIELDS

# SMBIOS'ta doldurulmamış alanların üretici yer tutucuları — boş sayılır.
_DMI_PLACEHOLDERS = {"to be filled by o.e.m.", "default string", "not specified", "system serial number",
                     "none", "n/a", "0", "123456789", "03000200-0400-0500-0006-000700080009"}

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
    for field in ("serial", "product_version", "product_uuid", "board_version", "board_serial"):
        if facts[field] and facts[field].lower() in _DMI_PLACEHOLDERS:
            facts[field] = None
    facts.update(_smart(values.get("SMART_JSON", "")))
    lines = output.splitlines()
    facts["disk_layout"] = _disk_layout(values.get("DISK_LAYOUT_JSON", ""), _multi(lines, "DISK_PTABLE_JSON"),
                                        _multi(lines, "DISK_EXTRA"))
    facts["uefi_vars"] = _uefi_vars(_multi(lines, "UEFI_VAR"), set(_multi(lines, "UEFI_IMMUTABLE")))
    facts["firmware_boot"] = _firmware_boot(values, _multi(lines, "FW_BOOTMGR"), facts["disk_layout"],
                                            facts["uefi_vars"])
    return facts


def _multi(lines: list, key: str) -> list:
    """Aynı anahtarla birden çok kez basılan satırların değerleri (disk başına, değişken başına…)."""
    prefix = key + "="
    return [line[len(prefix):] for line in lines if line.startswith(prefix)]


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _disk_layout(tree_raw: str, ptables_raw: list, extras_raw: list) -> list:
    """Disk başına: kimlik (model/seri/firmware/WWN), bölüm tablosu (GPT/MBR, disk GUID'i ya da MBR
    imzası, ilk/son LBA), bölümlenmemiş alan, GPT denetimi, MBR açılış kodu ve bölümler (bölüm GUID'i,
    tür GUID'i + adı, etiket, öznitelikler, dosya sistemi türü/UUID'si/etiketi, bağlama noktası, boyut,
    dolu/boş). lsblk ağacı ile sfdisk tablosu bölüm aygıt yolundan (/dev/sda1) birleştirilir."""
    try:
        tree = (json.loads(tree_raw) if tree_raw.strip() else {}).get("blockdevices") or []
    except ValueError:
        tree = []
    ptables = {}
    for raw in ptables_raw:
        try:
            pt = json.loads(raw).get("partitiontable") or {}
        except ValueError:
            continue
        if pt.get("device"):
            ptables[pt["device"]] = pt
    extras = {}
    for raw in extras_raw:
        name, free, code, check = (raw.split("|", 3) + ["", "", "", ""])[:4]
        extras[name] = {"free": _int(free), "code": code or None, "check": check.strip() or None}

    def fs(node: dict) -> dict:
        return {"fstype": node.get("fstype"), "fsver": node.get("fsver"), "label": node.get("label"),
                "uuid": node.get("uuid"), "mount": node.get("mountpoint"), "fs_size": node.get("fssize"),
                "fs_used": node.get("fsused"), "fs_avail": node.get("fsavail")}

    disks = []
    for d in tree:
        if d.get("type") != "disk" or str(d.get("name", "")).startswith("zram"):
            continue
        pt = ptables.get(d.get("path"), {})
        rows = {p.get("node"): p for p in pt.get("partitions") or []}
        ex = extras.get(d.get("name"), {})
        parts = []
        for p in d.get("children") or []:
            if p.get("type") != "part":
                continue
            row = rows.get(p.get("path"), {})
            part = {"name": p.get("name"), "path": p.get("path"), "size": p.get("size"),
                    "start": row.get("start"), "sectors": row.get("size"),
                    "type_guid": p.get("parttype"), "type_name": p.get("parttypename"),
                    "part_uuid": p.get("partuuid"), "part_label": p.get("partlabel"),
                    "flags": p.get("partflags"), "attrs": row.get("attrs"), "bootable": row.get("bootable"),
                    **fs(p)}
            # Bölümün içindeki katmanlar (LVM, LUKS…): ad + dosya sistemi + bağlama noktası.
            part["holders"] = [{"name": c.get("name"), "type": c.get("type"), **fs(c)}
                               for c in p.get("children") or []] or None
            parts.append(part)
        disks.append({
            "name": d.get("name"), "path": d.get("path"), "size": d.get("size"),
            "model": (d.get("model") or "").strip() or None, "serial": d.get("serial"),
            "rev": (d.get("rev") or "").strip() or None, "wwn": d.get("wwn"),
            "rota": d.get("rota"), "tran": d.get("tran"), "ro": d.get("ro"), "rm": d.get("rm"),
            "log_sec": d.get("log-sec"), "phy_sec": d.get("phy-sec"),
            "pttype": d.get("pttype") or pt.get("label"),
            # GPT'de disk GUID'i, MBR'de 32 bit disk imzası (0x…).
            "ptuuid": (pt.get("id") or d.get("ptuuid") or None),
            "first_lba": pt.get("firstlba"), "last_lba": pt.get("lastlba"),
            "free_bytes": ex.get("free"), "gpt_check": ex.get("check"), "mbr_code": ex.get("code"),
            # Bölüm tablosu olmadan doğrudan dosya sistemi taşıyan disk (ör. bölümsüz USB bellek).
            **({"fs": fs(d)} if d.get("fstype") else {}),
            "partitions": parts,
        })
    return disks


# UEFI değişken öznitelik bitleri (UEFI spec 8.2, EFI_VARIABLE_*).
_UEFI_ATTRS = [(0x1, "NV"), (0x2, "BS"), (0x4, "RT"), (0x8, "HW_ERR"), (0x10, "AUTH"), (0x20, "TIME_AUTH"),
               (0x40, "APPEND")]
# Bilinen üretici GUID'leri → okunur ad (kart, GUID'in yanında gösterir).
UEFI_GUIDS = {
    "8be4df61-93ca-11d2-aa0d-00e098032b8c": "EFI Global",
    "d719b2cb-3d3a-4596-a3bc-dad00e67656f": "Secure Boot imza veritabanı",
    "605dab50-e046-4300-abb6-3dd810dd8b23": "shim",
    "4a67b082-0a4c-41cf-b6c7-440b29bb8c4f": "systemd-boot",
    "77fa9abd-0359-4d32-bd60-28f4e78f784b": "Microsoft",
    "e20939be-32d4-41be-a150-897f85d49829": "TCG (MOR)",
    "4c19049f-4137-4dd3-9c10-8b97a83ffdfa": "EDK2 bellek türleri",
}
_GLOBAL_GUID = "8be4df61-93ca-11d2-aa0d-00e098032b8c"
_U8_FLAGS = {"SecureBoot", "SetupMode", "AuditMode", "DeployedMode", "VendorKeys"}
_ASCII_VARS = {"Lang", "PlatformLang", "LangCodes", "PlatformLangCodes"}
# u16 Boot#### numarası listesi olan değişkenler (AMI'nin LegacyDevOrder'ı gibi "…Order"lar başka yapıda).
_ORDER_VARS = {"BootOrder", "DriverOrder", "SysPrepOrder", "DefaultBootOrder"}
# TCG TPM üretici kimlikleri (caps "Manufacturer: 0x57454300" → "WEC").
_TPM_VENDORS = {"WEC": "Winbond", "IFX": "Infineon", "STM": "STMicroelectronics", "NTC": "Nuvoton",
                "ATML": "Atmel", "INTC": "Intel", "AMD": "AMD", "BRCM": "Broadcom", "NSM": "National Semi"}
_LOAD_OPTION_NAME = re.compile(r"^(Boot|Driver|SysPrep)[0-9A-F]{4}$")


def _load_option(data: bytes) -> tuple:
    """EFI_LOAD_OPTION (Boot####): (etkin mi, açıklama). Yapı: öznitelik u32, yol uzunluğu u16,
    UTF-16LE açıklama (sıfırla biter), aygıt yolu…"""
    if len(data) < 8:
        return None, None
    end = 6
    while end + 1 < len(data) and data[end:end + 2] != b"\0\0":
        end += 2
    desc = data[6:end].decode("utf-16-le", "replace").strip()
    return bool(int.from_bytes(data[:4], "little") & 1), desc


def _uefi_value(name: str, data: bytes, truncated: bool) -> str | None:
    """Değişken içeriğinin okunur hâli: bilinen standart değişkenler çözülür; ötekiler kısa metin,
    küçük tamsayı ya da ilk baytların onaltılık önizlemesi."""
    if not data:
        return None
    if name in _ORDER_VARS and len(data) % 2 == 0 and not truncated:
        return ", ".join(f"{int.from_bytes(data[i:i + 2], 'little'):04X}" for i in range(0, len(data), 2))
    if name in ("BootCurrent", "BootNext") and len(data) == 2:
        return f"Boot{int.from_bytes(data, 'little'):04X}"
    if name == "Timeout" and len(data) == 2:
        return f"{int.from_bytes(data, 'little')} sn"
    if name in _U8_FLAGS and len(data) == 1:
        return "Evet (1)" if data[0] else "Hayır (0)"
    if _LOAD_OPTION_NAME.match(name):
        active, desc = _load_option(data)
        if desc is not None:
            return f'"{desc}"' + ("" if active else " (devre dışı)")
    text = data.rstrip(b"\0")
    if name in _ASCII_VARS or (len(text) >= 3 and all(32 <= c < 127 for c in text)):
        return '"' + text.decode("ascii", "replace") + '"'
    if len(data) <= 8 and not truncated:
        return "0x" + data[::-1].hex().upper()
    preview = " ".join(f"{c:02X}" for c in data[:16])
    return preview + (" …" if truncated or len(data) > 16 else "")


def _uefi_vars(rows: list, immutable: set) -> list:
    """efivarfs dosyaları → [{name, guid, vendor, size, attrs, immutable, value}]. efivarfs dosyasının
    ilk 4 baytı öznitelik, kalanı veridir (size = yalnız veri). EFI Global GUID'liler önce, sonra GUID'e
    ve ada göre sıralanır."""
    out = []
    for raw in rows:
        fname, size, hexdata = (raw.split("|", 2) + ["", ""])[:3]
        if len(fname) < 38 or fname[-37] != "-":
            continue
        name, guid = fname[:-37], fname[-36:].lower()
        try:
            blob = bytes.fromhex(hexdata)
        except ValueError:
            blob = b""
        total = _int(size)
        attrs = int.from_bytes(blob[:4], "little") if len(blob) >= 4 else None
        data = blob[4:]
        data_size = total - 4 if total and total >= 4 else None
        truncated = data_size is not None and len(data) < data_size
        out.append({
            "name": name, "guid": guid, "vendor": UEFI_GUIDS.get(guid),
            "size": data_size,
            "attrs": " ".join(n for bit, n in _UEFI_ATTRS if attrs is not None and attrs & bit) or None,
            "immutable": fname in immutable,
            "value": _uefi_value(name, data, truncated),
        })
    out.sort(key=lambda v: (v["guid"] != _GLOBAL_GUID, v["guid"], v["name"].lower()))
    return out


def _efi_path(rest: str) -> str:
    """efibootmgr -v satırındaki aygıt yolu: yalnız düğümler ("HD(…)/File(…)"); ardından gelen
    üreticiye özgü ek veri (AMI'de "AMGOAMNO….") atılır."""
    m = re.match(r"\s*((?:[A-Za-z][A-Za-z0-9_]*\([^)]*\)/?)+)", rest)
    return m.group(1).rstrip("/") if m else rest.strip()[:120]


def _firmware_boot(values: dict, bootmgr: list, disks: list, uefi_vars: list) -> dict:
    """Firmware kipi, EFI sürüm/üretici, Secure Boot, değişken deposu, açılış sırası ve girdileri
    (aygıt yolundaki GPT bölüm GUID'i tahtadaki bölüme eşlenir), EFI bölümündeki önyükleyici dizinleri,
    TPM."""
    mode = (values.get("FW_MODE") or "").strip() or None
    fw: dict = {"mode": mode}
    tpm = (values.get("TPM_INFO") or "").strip()
    if tpm:
        ver, enabled, active, owned, maker, fwver = (tpm.split("|") + [""] * 6)[:6]
        name = None
        if maker.startswith("0x"):
            try:
                name = bytes.fromhex(maker[2:].zfill(8)).rstrip(b"\0").decode("ascii") or None
            except ValueError:
                name = None
        if name in _TPM_VENDORS:
            name = f"{_TPM_VENDORS[name]} ({name})"
        flag = lambda v: None if v.strip() == "" else v.strip() == "1"  # noqa: E731
        fw["tpm"] = {"version": {"2": "2.0", "1": "1.2"}.get(ver.strip(), ver.strip() or None),
                     "enabled": flag(enabled), "active": flag(active), "owned": flag(owned),
                     "maker": name or maker.strip() or None, "firmware": fwver.strip() or None}
    if mode != "uefi":
        return fw
    fw["bits"] = _int((values.get("FW_BITS") or "").strip())
    efi = (values.get("FW_EFI") or "").strip()
    if "|" in efi:
        fw["efi_version"], fw["efi_vendor"] = (x.strip() for x in efi.split("|", 1))
    store = [_int(x) for x in (values.get("FW_VARSTORE") or "").split("|")]
    if len(store) == 3:
        fw["store_total"], fw["store_used"], fw["store_free"] = store
    fw["esp_dirs"] = (values.get("FW_ESP_DIRS") or "").split() or None
    by_name = {v["name"]: v for v in uefi_vars if v["guid"] == _GLOBAL_GUID}
    sb = by_name.get("SecureBoot", {}).get("value")
    fw["secure_boot"] = None if sb is None else sb.startswith("Evet")
    sm = by_name.get("SetupMode", {}).get("value")
    fw["setup_mode"] = None if sm is None else sm.startswith("Evet")

    part_by_uuid = {(p.get("part_uuid") or "").lower(): p for d in disks for p in d["partitions"] if p.get("part_uuid")}
    entries = []
    for line in bootmgr:
        line = line.rstrip()
        key, _, val = line.partition(":")
        if key == "BootCurrent":
            fw["boot_current"] = val.strip()
        elif key == "BootNext":
            fw["boot_next"] = val.strip()
        elif key == "Timeout":
            fw["timeout"] = _int((val.split() or [""])[0])
        elif key == "BootOrder":
            fw["boot_order"] = [x for x in val.strip().split(",") if x]
        else:
            m = re.match(r"Boot([0-9A-Fa-f]{4})(\*?)\s+(.*)$", line)
            if not m:
                continue
            desc, _, rest = m.group(3).partition("\t")
            path = _efi_path(rest) if rest else None
            entry = {"num": m.group(1).upper(), "active": m.group(2) == "*", "desc": desc.strip(), "path": path}
            g = re.search(r"HD\(\d+,GPT,([0-9a-fA-F-]{36})", path or "")
            if g and g.group(1).lower() in part_by_uuid:
                p = part_by_uuid[g.group(1).lower()]
                entry["part"] = p["path"]
                entry["part_type"] = p.get("type_name")
            entries.append(entry)
    fw["boot_entries"] = entries
    return fw


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


def query(board: dict, user: str, password: str, timeout: int = 25) -> dict:
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
