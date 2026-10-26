"""Ağ yoklamaları: varlık (arp-scan) ve servis/işletim sistemi (nmap).

Varlık için ARP kullanılır (ICMP değil): aynı L2 ağdaki her IPv4 cihazı, güvenlik duvarı ping'i
engellese bile ARP'ye yanıt vermek zorundadır — "cihaz orada mı" sorusunun en güvenilir cevabı.
Çekirdeğin komşu tablosu (/proc/net/arp) da bedava bir ek kaynaktır: sunucunun o an konuştuğu
cihazlar (ör. log gönderen tahtalar) tarama arasında da "görüldü" sayılır.

İki araç da `nice -n 19` + `ionice -c3` ile en düşük öncelikte çalışır (bkz. load.py).
"""

from __future__ import annotations

import ipaddress
import logging
import os
import re
import select
import socket
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
import xml.etree.ElementTree as ET

log = logging.getLogger("ankamon.netscan")

_LOW = ["nice", "-n", "19", "ionice", "-c3"]
_MAC = re.compile(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$")


def _run(cmd: list[str], timeout: int) -> str:
    try:
        proc = subprocess.run(_LOW + cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        log.warning("zaman aşımı: %s", " ".join(cmd[:3]))
        return ""
    except OSError as exc:
        log.error("çalıştırılamadı: %s (%s)", cmd[0], exc)
        return ""
    if proc.returncode != 0:
        log.warning("%s çıkış kodu %s: %s", cmd[0], proc.returncode, (proc.stderr or "").strip()[:300])
        return ""  # yarım çıktı kullanılmaz (ör. nmap başlayamadıysa cihaz "0 port" sayılmasın)
    return proc.stdout


def estimate_seconds(cidr: str) -> float:
    """İlk tarama için süre tahmini: arp-scan varsayılan 256 kbit/sn'de ~2 ms/paket, 2 deneme + bekleme."""
    hosts = max(1, ipaddress.ip_network(cidr, strict=False).num_addresses - 2)
    return hosts * 2 * 0.002 + 1.5


def arp_sweep(iface: str, cidr: str, on_progress=None, expected: float | None = None) -> dict[str, str]:
    """{mac: ip} — alt ağdaki ARP'ye yanıt veren bütün cihazlar (2 deneme).

    arp-scan ilerleme bildirmez ama hızı sabittir: ilerleme = geçen süre / beklenen süre (ağın önceki
    tarama süresi, yoksa estimate_seconds), bitene dek en çok %99. on_progress(oran, bulunan) ~0,5 sn'de bir.
    "bulunan" yalnız bitişte kesindir: arp-scan boruya yazarken çıktısını tamponlar (stdbuf imajda yok).
    """
    expected = expected or estimate_seconds(cidr)
    cmd = _LOW + ["arp-scan", "-I", iface, "-q", "-x", "-g", "-r", "2", cidr]
    found: dict[str, str] = {}
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except OSError as exc:
        log.error("çalıştırılamadı: arp-scan (%s)", exc)
        return found
    started = time.monotonic()
    last_report = 0.0
    buf = ""
    fd = proc.stdout.fileno()
    while True:
        ready, _, _ = select.select([fd], [], [], 0.5)
        if ready:
            chunk = os.read(fd, 65536).decode(errors="replace")
            if not chunk:
                break
            buf += chunk
            *lines, buf = buf.split("\n")
            for line in lines:
                parts = line.split("\t")
                if len(parts) >= 2 and _MAC.match(parts[1].lower()):
                    found.setdefault(parts[1].lower(), parts[0])
        elapsed = time.monotonic() - started
        if elapsed > 600:
            proc.kill()
            log.warning("zaman aşımı: arp-scan %s", cidr)
            break
        if on_progress and elapsed - last_report >= 0.5:
            last_report = elapsed
            on_progress(min(0.99, elapsed / expected), len(found))
    proc.wait()
    if proc.returncode not in (0, None, -9):
        log.warning("arp-scan çıkış kodu %s: %s", proc.returncode, (proc.stderr.read() or "").strip()[:300])
    if on_progress:
        on_progress(1.0, len(found))
    return found


def neighbors(iface_names: list[str]) -> dict[str, str]:
    """{mac: ip} — çekirdeğin ARP tablosunda TAMAMLANMIŞ (flags 0x2) girdiler."""
    found: dict[str, str] = {}
    try:
        with open("/proc/net/arp") as fh:
            lines = fh.read().splitlines()[1:]
    except OSError:
        return found
    for line in lines:
        parts = line.split()
        if len(parts) >= 6 and parts[2] == "0x2" and parts[5] in iface_names and parts[3] != "00:00:00:00:00:00":
            found[parts[3].lower()] = parts[0]
    return found


def service_scan(ip: str, top_ports: int) -> dict | None:
    """nmap -sV -O ile tek cihazı tarar. Hata/zaman aşımında None.

    top_ports: taranacak en yaygın port sayısı (bkz. NETSCAN_TOP_PORTS, vars. 1000). 1000, bilgisayar
    servislerinin (uzaktan masaüstü, NetSupport/sınıf yönetimi 5405, WinRM 5985/5986, MSSQL 1433,
    PostgreSQL 5432, alt-HTTP 8080/8443, VNC…) neredeyse tamamını kapsar; eski 100 bunların çoğunu
    kaçırıyordu. Çok yüksek portlardaki geçici (ephemeral) RPC portları yalnız gürültü olduğundan tüm
    portlar (-p-) taranmaz.
    --version-light kaldırıldı: varsayılan yoğunluk (7) servisleri belirgin biçimde daha iyi tanır.
    Elenen (Windows güvenlik duvarı) hostlarda açık portları kaçırmamak için 2 deneme.

    Dönüş: {hostname, os, os_type, os_vendor, ports:[{proto, port, service, product, version, extra, devicetype}]}
    """
    out = _run([
        "nmap", "-sS", "-sV", "-O", "--osscan-limit", "-Pn", "-T3",
        "--top-ports", str(top_ports), "--max-retries", "2", "--host-timeout", "240s",
        "-oX", "-", ip,
    ], timeout=300)
    if not out:
        return None
    try:
        root = ET.fromstring(out)
    except ET.ParseError:
        return None
    host = root.find("host")
    if host is None:
        return {"hostname": "", "os": "", "os_type": "", "os_vendor": "", "ports": []}
    result = {"hostname": "", "os": "", "os_type": "", "os_vendor": "", "ports": []}
    name = host.find("hostnames/hostname")
    if name is not None:
        result["hostname"] = name.get("name", "")
    match = host.find("os/osmatch")
    if match is not None and int(match.get("accuracy", "0")) >= 85:
        result["os"] = match.get("name", "")
        cls = match.find("osclass")
        if cls is not None:
            result["os_type"] = cls.get("type", "")
            result["os_vendor"] = cls.get("vendor", "")
    for port in host.findall("ports/port"):
        state = port.find("state")
        if state is None or state.get("state") != "open":
            continue
        svc = port.find("service")
        get = (lambda k: svc.get(k, "") if svc is not None else "")
        result["ports"].append({
            "proto": port.get("protocol", "tcp"),
            "port": int(port.get("portid", "0")),
            "service": get("name"),
            "product": get("product"),
            "version": get("version"),
            "extra": " ".join(x for x in (get("extrainfo"), get("ostype")) if x),
            "devicetype": get("devicetype"),
        })
    return result


_dns_pool = ThreadPoolExecutor(max_workers=4)


def reverse_dns(ip: str) -> str:
    """Ters DNS (okul DNS'i bilgisayar adlarını çoğu zaman bilir). gethostbyaddr soket zaman aşımına
    uymadığından ayrı iş parçacığında 3 sn beklenir; yanıt gelmezse boş döner (iş parçacığı arka planda biter)."""
    future = _dns_pool.submit(socket.gethostbyaddr, ip)
    try:
        name = future.result(timeout=3)[0]
    except (OSError, UnicodeError, FutureTimeout):
        return ""
    return "" if name == ip else name  # musl, PTR kaydı yokken adresin kendisini döndürür


def netbios_name(ip: str) -> str:
    """NetBIOS ad sorgusu (nmblookup -A): DNS PTR kaydı OLMAYAN Windows PC'lerin bilgisayar adı. Yoksa ''.

    Çıktıda her NetBIOS adı 'AD   <tür> - [<GROUP>] B <ACTIVE>' satırıyla gelir. İş istasyonu adı,
    GROUP olmayan (benzersiz) <00> kayıttır; çalışma grubu ad(lar)ı <GROUP> ile işaretlidir, atlanır.
    """
    out = _run(["nmblookup", "-A", ip], timeout=8)
    for line in out.splitlines():
        if "<00>" in line and "<GROUP>" not in line:
            name = line.split()[0].strip()
            if name and name not in ("MAC", "Looking"):
                return name
    return ""


# ---------------------------------------------------------------- SMB/NetBIOS paylaşımları
# NT_STATUS_... metninden sonucu çıkarırız. ACCESS_DENIED/LOGON_FAILURE = kimlik gerekiyor,
# diğerleri (HOST_UNREACHABLE, CONNECTION_REFUSED…) erişilemez.
_SMB_DENIED = ("ACCESS_DENIED", "LOGON_FAILURE", "ACCOUNT_", "PASSWORD_")


def _smb_list(ip, user, password):
    """smbclient -L çıktısını ayrıştırır. (paylaşımlar, hata) — hata None ise başarılı.

    Kimlik verilmezse anonim (guest). `-g` makine-okunur biçim: her satır 'Tur|Ad|Aciklama'
    (Tur: Disk | Printer | IPC). IPC$ ve yonetimsel '$' sonlu paylasimlar atlanir (gezilemez).
    """
    cmd = ["smbclient", "-g", "-L", "//" + ip, "-t", "8"]
    if user:
        cmd += ["-U", user + "%" + (password or "")]
    else:
        cmd.append("-N")
    # smbclient oturum/bağlantı hatalarını (NT_STATUS_...) stderr'e yazar; birleştirilir.
    try:
        proc = subprocess.run(_LOW + cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, timeout=25)
        out = proc.stdout
    except subprocess.TimeoutExpired:
        return [], "unreachable"
    except OSError as exc:
        log.error("smbclient çalıştırılamadı: %s", exc)
        return [], "error"
    shares = []
    error = None
    for line in out.splitlines():
        up = line.upper()
        if "NT_STATUS_" in up:
            token = up.split("NT_STATUS_", 1)[1].split()[0].rstrip(".")
            error = "denied" if any(token.startswith(d) for d in _SMB_DENIED) else "unreachable"
            continue
        parts = line.split("|")
        if len(parts) < 2 or parts[0] not in ("Disk", "Printer"):
            continue
        name = parts[1].strip()
        if not name or name.endswith("$"):  # IPC$, ADMIN$, C$ … (yonetimsel/gizli)
            continue
        shares.append({"name": name, "stype": "printer" if parts[0] == "Printer" else "disk",
                       "comment": parts[2].strip() if len(parts) > 2 else ""})
    if shares:
        return shares, None
    return [], error or ("empty" if out else "unreachable")


def smb_shares(ip, hostname, creds):
    """Bir cihazin gezilebilir paylasimlarini bulur. Once anonim; reddedilirse kayitli Samba kimligi.

    creds: (user, password) ya da None. Donus: {shares:[{name, stype, comment, path}], auth}.
    auth: guest | creds | denied | unreachable | empty | error. path = \\\\<ad>\\<paylasim>.
    """
    host = hostname or ip
    try:
        shares, error = _smb_list(ip, None, None)
        auth = "guest"
        if not shares and error == "denied" and creds and creds[1]:
            shares, error2 = _smb_list(ip, creds[0], creds[1])
            auth = "creds" if shares else (error2 or error)
        elif not shares:
            auth = error
    except Exception:
        log.exception("smbclient hatasi: %s", ip)
        return {"shares": [], "auth": "error"}
    for s in shares:
        s["path"] = "\\\\" + host + "\\" + s["name"]
    return {"shares": shares, "auth": auth}
