# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Disk editörü — okuma (kullanıcı isteği 2026-11-23; arayüz frontend ui/disk/DiskEditor, uygulama actions/disk-editor-apply).
# Cihazdaki diskleri, bölüm tablolarını (parted -m … print free, msdos'ta sfdisk -J ile genişletilmiş/mantıksal ayrımı),
# dosya sistemlerini (lsblk), bağlama noktalarını (findmnt), etkin takas alanlarını ve kullanılan alanı okur. Sonuç JSON →
# gzip → base64, görev çıktısının satır sınırına (2000) sığsın diye parça parça "ANKAMON_DISK:" satırları; son satır
# "ANKAMON_DISK_END". Hiçbir şeyi değiştirmez. ANKAMON_DISK_LOOP=1 ortamında loop aygıtları da listelenir (yalnız sınama).
set -u
command -v python3 >/dev/null 2>&1 || { echo "Bu cihazda python3 yok; disk editörü çalışamaz." >&2; exit 2; }
command -v parted >/dev/null 2>&1 || { echo "Bu cihazda parted yok; disk editörü çalışamaz." >&2; exit 2; }
LC_ALL=C python3 - <<'ANKAMON_DISK_PY'
import base64, gzip, json, os, re, shutil, socket, subprocess

def sh(*args, stdin=None):
    try:
        r = subprocess.run(args, capture_output=True, text=True, input=stdin, timeout=60)
        return r.returncode, r.stdout, r.stderr
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, "", str(e)

def num(s):
    s = (s or "").strip().rstrip("s")
    return int(s) if s.isdigit() else None

def lsblk():
    rc, out, _ = sh("lsblk", "-J", "-b", "-o",
                    "NAME,PATH,TYPE,TRAN,RM,RO,SIZE,MODEL,SERIAL,VENDOR,LABEL,PARTLABEL,UUID,FSTYPE,FSAVAIL,FSUSED,PTTYPE,HOTPLUG")
    try:
        return json.loads(out).get("blockdevices", []) if rc == 0 else []
    except ValueError:
        return []

def mounts():
    m = {}
    rc, out, _ = sh("findmnt", "-rn", "-o", "SOURCE,TARGET")
    for line in out.splitlines():
        src, _, tgt = line.partition(" ")
        src = re.sub(r"\[.*\]$", "", src)
        tgt = tgt.replace("\\x20", " ")
        m.setdefault(src, []).append(tgt)
    return m

def swaps():
    try:
        with open("/proc/swaps") as f:
            return {line.split()[0] for line in f.read().splitlines()[1:] if line.strip()}
    except OSError:
        return set()

def part_numbers(name):
    """/sys/block/<disk>/<bölüm>/partition → {numara: (ad, başlangıç)}"""
    res = {}
    base = f"/sys/block/{name}"
    try:
        for child in os.listdir(base):
            p = os.path.join(base, child, "partition")
            if os.path.isfile(p):
                with open(p) as f:
                    n = int(f.read().strip())
                res[n] = child
    except OSError:
        pass
    return res

def ext_used(path):
    rc, out, _ = sh("dumpe2fs", "-h", path)
    if rc != 0:
        return None
    v = {}
    for line in out.splitlines():
        k, _, val = line.partition(":")
        v[k.strip()] = val.strip()
    try:
        bs = int(v["Block size"])
        return (int(v["Block count"]) - int(v["Free blocks"])) * bs
    except (KeyError, ValueError):
        return None

SYSTEM_MOUNTS = {"/", "/boot", "/boot/efi", "/usr", "/var", "/home"}
TOOLS = ["mkfs.ext2", "mkfs.ext3", "mkfs.ext4", "mkfs.vfat", "mkfs.ntfs", "mkfs.exfat", "mkfs.btrfs", "mkfs.xfs", "mkfs.f2fs",
         "mkswap", "resize2fs", "e2fsck", "ntfsresize", "ntfsfix", "fsck.vfat", "fsck.exfat", "btrfs", "xfs_growfs",
         "xfs_repair", "xfs_admin", "e2label", "fatlabel", "ntfslabel", "exfatlabel", "swaplabel", "tune2fs", "btrfstune",
         "sfdisk", "partx", "wipefs", "parted"]

def scan():
    mnt, sw = mounts(), swaps()
    loop_ok = os.environ.get("ANKAMON_DISK_LOOP") == "1"
    disks = []
    for d in lsblk():
        name = d.get("name") or ""
        if d.get("type") != "disk" and not (loop_ok and d.get("type") == "loop"):
            continue
        if re.match(r"^(zram|ram|sr|fd)\d*", name) or (name.startswith("loop") and not loop_ok):
            continue
        path = d.get("path") or "/dev/" + name
        try:
            with open(f"/sys/block/{name}/queue/logical_block_size") as f:
                sector = int(f.read().strip())
        except (OSError, ValueError):
            sector = 512
        size = int(d.get("size") or 0)
        total = size // sector
        disk = {"path": path, "name": name, "model": " ".join(filter(None, [(d.get("vendor") or "").strip(), (d.get("model") or "").strip()])),
                "serial": (d.get("serial") or "").strip(), "size": size, "sector": sector, "sectors": total,
                "transport": d.get("tran") or "", "removable": bool(d.get("rm")) or bool(d.get("hotplug")), "readonly": bool(d.get("ro")),
                "table": None, "parts": [], "error": None}
        rc, out, err = sh("parted", "-m", "-s", path, "unit", "s", "print", "free")
        lines = [l.rstrip(";") for l in out.splitlines()]
        if rc != 0 and "unrecognised disk label" in (err + out).lower():
            disk["table"] = "none"
        elif rc != 0 and len(lines) < 2:
            disk["error"] = (err or out).strip()[:300] or "parted okuyamadı"
        if len(lines) >= 2:
            head = lines[1].split(":")
            disk["table"] = head[5] if len(head) > 5 and head[5] else (disk["table"] or "unknown")
        children = {c.get("name"): c for c in d.get("children") or []}
        numbers = part_numbers(name)
        extended = set()
        if disk["table"] == "msdos":
            rc2, out2, _ = sh("sfdisk", "-J", path)
            try:
                for p in json.loads(out2)["partitiontable"].get("partitions", []):
                    m = re.search(r"(\d+)$", p.get("node", ""))
                    if m and str(p.get("type", "")).lower() in ("5", "f", "85"):
                        extended.add(int(m.group(1)))
            except (ValueError, KeyError):
                pass
        for line in lines[2:]:
            f = line.split(":")
            if len(f) < 5:
                continue
            start, end, length = num(f[1]), num(f[2]), num(f[3])
            if start is None or end is None:
                continue
            if f[4] == "free":
                if length and length * sector >= 1024 * 1024:   # 1 MiB'tan küçük boşluk (hizalama artığı) gösterilmez
                    disk["parts"].append({"kind": "free", "start": start, "end": end})
                continue
            n = int(f[0])
            child = children.get(numbers.get(n)) or {}
            ppath = child.get("path") or ("/dev/" + numbers[n] if n in numbers else None)
            fs = child.get("fstype") or (f[4] or None)
            if fs == "swap":
                fs = "linux-swap"
            if fs == "vfat":
                fs = "fat32" if (f[4] or "").startswith("fat32") or not (f[4] or "").startswith("fat16") else "fat16"
            targets = mnt.get(ppath, []) if ppath else []
            kind = "extended" if n in extended else ("logical" if disk["table"] == "msdos" and n >= 5 else "primary")
            part = {"kind": kind, "number": n, "path": ppath, "start": start, "end": end, "fs": None if kind == "extended" else fs,
                    "label": child.get("label") or "", "name": (f[5] if disk["table"] == "gpt" and len(f) > 5 else "") or child.get("partlabel") or "",
                    "flags": [x.strip() for x in (f[6] if len(f) > 6 else "").split(",") if x.strip()],
                    "uuid": child.get("uuid") or "", "mounts": targets, "swap": bool(ppath and ppath in sw),
                    "used": None, "avail": None}
            if child.get("fsused") is not None and targets:
                part["used"] = int(child["fsused"])
                part["avail"] = int(child.get("fsavail") or 0)
            elif fs and fs.startswith("ext") and ppath:
                part["used"] = ext_used(ppath)
            elif fs == "linux-swap":
                part["used"] = (end - start + 1) * sector
            part["busy"] = bool(targets) or part["swap"]
            part["system"] = any(t in SYSTEM_MOUNTS for t in targets) or part["swap"]
            disk["parts"].append(part)
        # Genişletilmiş bölümün içindeki boşluk yalnız mantıksal bölüme açılır.
        for ext in [p for p in disk["parts"] if p["kind"] == "extended"]:
            for p in disk["parts"]:
                if p["kind"] == "free" and ext["start"] <= p["start"] and p["end"] <= ext["end"]:
                    p["logical"] = True
        if disk["table"] == "none":
            disk["parts"] = [{"kind": "free", "start": 2048 * 512 // sector, "end": total - 1}]
        disk["busy"] = any(p.get("busy") for p in disk["parts"])
        disk["system"] = any(p.get("system") for p in disk["parts"])
        disks.append(disk)
    rc, ver, _ = sh("parted", "-v")
    return {"host": socket.gethostname(), "disks": disks, "tools": {t: bool(shutil.which(t)) for t in TOOLS},
            "parted": (ver.splitlines() or [""])[0]}

data = scan()
for d in data["disks"]:
    print(f"{d['path']}: {d['model'] or 'disk'} · {d['size'] / 1e9:.1f} GB · tablo {d['table']} · {sum(1 for p in d['parts'] if p['kind'] != 'free')} bölüm")
blob = base64.b64encode(gzip.compress(json.dumps(data, ensure_ascii=False).encode())).decode()
for i in range(0, len(blob), 1500):
    print("ANKAMON_DISK:" + blob[i:i + 1500])
print("ANKAMON_DISK_END")
ANKAMON_DISK_PY
