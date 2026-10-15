"""Cihaz türü ve model tahmini.

Kanıtlar, güvenilirlik sırasıyla:
  1. Sunucunun kendisi / Tiha-Mon'da kayıtlı tahta (MAC eşleşmesi) / ağ geçidi IP'si
  2. nmap servis taramasının cihaz türü (service devicetype, osclass type) ve açık portlar
  3. MAC üreticisi (Wireshark manuf) — tek başına çoğu zaman yeterli (yazıcı, kamera, ağ cihazı…)
  4. Rastgele (yerel yönetimli) MAC → telefon/tablet (Android/iOS "özel Wi-Fi adresi")
Hiçbiri yoksa boş bırakılır; kullanıcı arayüzden elle türü seçebilir (net_devices.device_type).
"""

from __future__ import annotations

# Arayüzdeki "Cihaz türü" seçim listesiyle aynı adlar (bkz. frontend page/Network.js TYPES).
PC = "Bilgisayar"
SERVER = "Sunucu"
BOARD = "Akıllı tahta"
PRINTER = "Yazıcı"
CAMERA = "IP kamera"
NETWORK = "Ağ cihazı"
ROUTER = "Ağ geçidi / yönlendirici"
AP = "Kablosuz erişim noktası"
PHONE = "Telefon / tablet"
TV = "TV / medya"
NAS = "Depolama (NAS)"
IOT = "IoT cihazı"
VM = "Sanal makine"
SELF = "Tiha-Mon sunucusu"

# (anahtar sözcük, tür) — üretici adı küçük harfle içerir mi diye bakılır; ilk eşleşme kazanır.
_VENDOR_RULES: list[tuple[tuple[str, ...], str]] = [
    (("vmware", "qemu", "xensource", "parallels", "pcs systemtechnik", "microsoft corporation"), VM),
    (("canon", "epson", "seiko epson", "brother", "kyocera", "lexmark", "ricoh", "konica", "xerox",
      "sharp corporation", "oki electric", "zebra technologies", "pantum", "toshiba tec"), PRINTER),
    (("hikvision", "dahua", "axis communications", "uniview", "zhejiang uniview", "reolink", "hanwha",
      "vivotek", "mobotix", "provision-isr", "foscam", "amcrest", "ezviz"), CAMERA),
    (("ubiquiti", "ruckus", "aruba", "cambium", "engenius", "meraki", "aerohive", "extreme networks"), AP),
    (("cisco", "juniper", "mikrotik", "routerboard", "tp-link", "netgear", "d-link", "zyxel", "fortinet",
      "sophos", "h3c", "ruijie", "allied telesis", "hewlett packard enterprise", "huawei technologies",
      "edgecore", "dell emc networking", "netis", "tenda", "airties", "keenetic", "draytek", "palo alto",
      "checkpoint", "watchguard", "brocade", "arista"), NETWORK),
    (("synology", "qnap", "western digital", "buffalo", "asustor", "netapp"), NAS),
    (("apple",), "Apple cihazı"),
    (("samsung", "xiaomi", "oppo", "vivo mobile", "oneplus", "realme", "honor device", "motorola mobility",
      "huawei device", "nokia", "zte", "tecno", "infinix", "general mobile", "google"), PHONE),
    # MEB okullarındaki ETAP akıllı tahtaların ana kartı Vestel (00:09:df…) — Tiha-Mon'a henüz
    # kaydolmamış (log göndermeyen) tahtalar da böyle tanınır.
    (("vestel",), BOARD),
    (("arcelik", "arçelik", "lg electronics", "sony", "tcl", "hisense", "philips", "roku",
      "amazon technologies", "chromecast"), TV),
    (("raspberry pi",), "Raspberry Pi"),
    (("espressif", "tuya", "shelly", "sonoff", "itead", "particle", "arduino", "silicon labs", "texas instruments",
      "nordic semiconductor", "murata"), IOT),
    (("supermicro", "super micro"), SERVER),
    (("intel", "realtek", "dell", "lenovo", "asustek", "giga-byte", "gigabyte", "micro-star", "asrock",
      "acer", "foxconn", "hon hai", "pegatron", "liteon", "lite-on", "azurewave", "hp inc", "hewlett packard",
      "fujitsu", "toshiba", "elitegroup", "msi", "casper", "monster", "quanta", "wistron", "compal",
      "intel corporate", "broadcom", "atheros", "qualcomm", "mediatek", "ralink"), PC),
]

# nmap'in cihaz türü sınıfları (osclass type / service devicetype) → tür
_NMAP_TYPES = {
    "printer": PRINTER, "print server": PRINTER,
    "webcam": CAMERA, "security-misc": CAMERA,
    "router": ROUTER, "broadband router": ROUTER, "firewall": NETWORK, "switch": NETWORK,
    "load balancer": NETWORK, "bridge": NETWORK, "wap": AP, "phone": PHONE, "pda": PHONE,
    "media device": TV, "game console": TV, "storage-misc": NAS, "specialized": IOT,
    "terminal": PC, "power-device": IOT, "voip phone": "IP telefon", "voip adapter": "IP telefon",
}

# 9100 tek başına yazıcı kanıtı değildir: tahtalardaki node_exporter (sensör) de 9100'dedir ve nmap
# onu "jetdirect" sanar — SSH'ı olmayan cihazda 9100 yazıcı sayılır.
_PRINTER_PORTS = {515, 631}
_OS_TYPES_TRUSTED = {"printer", "print server", "webcam", "phone", "pda", "media device", "game console",
                     "storage-misc", "voip phone", "voip adapter"}
_CAMERA_PORTS = {554, 8554, 37777, 34567}
_WINDOWS_PORTS = {135, 139, 445, 3389}


def guess_type(*, vendor: str, mac_random: bool, is_board: bool, is_gateway: bool, is_self: bool,
               scan: dict | None) -> str:
    if is_self:
        return SELF
    if is_board:
        return BOARD
    if is_gateway:
        return ROUTER
    low = vendor.lower()
    if "vestel" in low:  # bkz. _VENDOR_RULES — porttan önce: tahtanın 9100'ü yazıcı sanılmasın
        return BOARD
    ports = {p["port"] for p in (scan or {}).get("ports", [])}
    # nmap'in kendi cihaz türü (servis bazlı daha kesin, sonra OS sınıfı) — "general purpose" türsüzdür.
    for p in (scan or {}).get("ports", []):
        t = _NMAP_TYPES.get((p.get("devicetype") or "").lower())
        if t and not (t == PRINTER and p["port"] == 9100 and 22 in ports):
            return t
    if ports & _PRINTER_PORTS or (9100 in ports and 22 not in ports):
        return PRINTER
    if ports & _CAMERA_PORTS:
        return CAMERA
    # OS parmak izi sınıfı yalnız ayırt edici türlerde kullanılır: "router/switch/firewall" eşleşmeleri
    # sıradan Linux'larda da çıkıyor (ör. ETAP: "Linux 4.X|5.X, MikroTik RouterOS").
    os_type = ((scan or {}).get("os_type") or "").lower()
    if os_type in _OS_TYPES_TRUSTED:
        return _NMAP_TYPES[os_type]
    for words, kind in _VENDOR_RULES:
        if any(w in low for w in words):
            return kind
    if mac_random:
        return PHONE
    if ports & _WINDOWS_PORTS:
        return PC
    if os_type == "general purpose":
        return PC
    return ""


def guess_model(scan: dict | None, board_model: str = "") -> str:
    """Tahtada Tiha-Mon'un donanım bilgisi; yoksa nmap'in en belirgin ürün adı ya da OS eşleşmesi."""
    if board_model:
        return board_model
    if not scan:
        return ""
    # Cihaz türü belirten servis ürünü (ör. "HP LaserJet M402dn http config") en iyi model ipucudur.
    for p in scan.get("ports", []):
        if p.get("devicetype") and p.get("product"):
            return p["product"]
    os_name = scan.get("os") or ""
    if os_name and (scan.get("os_type") or "").lower() not in ("general purpose", ""):
        return os_name
    return ""
