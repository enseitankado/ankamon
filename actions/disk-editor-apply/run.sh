# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Disk editörü — kuyruktaki işlemleri uygula (kullanıcı isteği 2026-11-23; arayüz frontend ui/disk/DiskEditor, okuma
# actions/disk-editor). DISK_OPS: base64(JSON) {disk, serial, size, ops:[…]} — işlemler SIRAYLA, ilk hatada durur.
#
# Güvenlik: disk yolu biçim + seri no + boyut eşleşmeli (pencere açıkken disk değişmişse hiçbir şey yapılmaz); her
# işlemden önce bölüm tablosu yeniden okunur, bölüm BAŞLANGIÇ SEKTÖRÜYLE bulunur (numara kaymış olabilir). Bağlı/etkin
# takas bölümünde yalnız çevrimiçi yapılabilenler: büyütme (ext2/3/4 resize2fs, btrfs, xfs_growfs), etiket (ext, btrfs),
# bölüm adı, bayrak, ayır/takası kapat. Silme, biçimlendirme, küçültme, taşıma, denetleme, yeni UUID bağlı değilken.
# Bölüm tablosu yazımı: parted (mkpart/mklabel/set) ve sfdisk --no-reread (resize, taşıma --move-data, silme, ad);
# çekirdek partx ile bilgilendirilir (kullanımdaki diskte de çalışır). GParted kurulmaz: aynı alt araçlar doğrudan.
set -u
command -v python3 >/dev/null 2>&1 || { echo "Bu cihazda python3 yok." >&2; exit 2; }
LC_ALL=C python3 - <<'ANKAMON_DISK_PY'
import base64, contextlib, json, os, re, shutil, subprocess, sys, time

class Fail(Exception):
    pass

def log(msg):
    print(msg, flush=True)

def run(*args, stdin=None, ok=(0,), quiet=False, check=True):
    log("$ " + " ".join(args))
    try:
        r = subprocess.run(args, capture_output=True, text=True, input=stdin, timeout=6000)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise Fail(f"{args[0]} çalıştırılamadı: {e}")
    text = (r.stdout + r.stderr).strip()
    if text and not quiet:
        for line in text.splitlines()[-40:]:
            log("  " + line)
    if check and r.returncode not in ok:
        raise Fail(f"{args[0]} başarısız (çıkış kodu {r.returncode})")
    return r.returncode, r.stdout, r.stderr

def need(tool):
    if not shutil.which(tool):
        raise Fail(f"Cihazda {tool} yok.")

try:
    spec = json.loads(base64.b64decode(os.environ.get("DISK_OPS", "")).decode())
except (ValueError, UnicodeDecodeError):
    print("İşlem listesi okunamadı.", file=sys.stderr)
    sys.exit(2)

DISK = str(spec.get("disk", ""))
if not re.match(r"^/dev/(sd[a-z]+|vd[a-z]+|hd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+|loop\d+)$", DISK):
    print(f"Geçersiz disk: {DISK}", file=sys.stderr)
    sys.exit(2)
DNAME = DISK[5:]
SEP = "p" if DNAME[-1].isdigit() else ""

def sysread(path, default=""):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default

SECTOR = int(sysread(f"/sys/block/{DNAME}/queue/logical_block_size", "512") or 512)
SIZE = int(sysread(f"/sys/block/{DNAME}/size", "0") or 0) * 512

def check_disk():
    if not os.path.exists(DISK):
        raise Fail(f"{DISK} bulunamadı.")
    if spec.get("size") and int(spec["size"]) != SIZE:
        raise Fail(f"{DISK} boyutu değişmiş (beklenen {spec['size']}, şu an {SIZE}) — pencereyi yenileyin.")
    if spec.get("serial"):
        r = subprocess.run(["lsblk", "-dno", "SERIAL", DISK], capture_output=True, text=True)
        serial = (r.stdout or "").strip()
        if serial and serial != spec["serial"]:
            raise Fail(f"{DISK} başka bir disk (seri {serial}) — pencereyi yenileyin.")

def table():
    """{"type": gpt|msdos|none, "parts": {numara: {start, end, fs, flags}}}"""
    r = subprocess.run(["parted", "-m", "-s", DISK, "unit", "s", "print"], capture_output=True, text=True)
    lines = [l.rstrip(";") for l in r.stdout.splitlines()]
    if r.returncode != 0 and "unrecognised disk label" in (r.stdout + r.stderr).lower():
        return {"type": "none", "parts": {}}
    if len(lines) < 2:
        raise Fail("Bölüm tablosu okunamadı: " + (r.stderr or r.stdout).strip()[:200])
    head = lines[1].split(":")
    parts = {}
    for line in lines[2:]:
        f = line.split(":")
        if len(f) >= 4 and f[0].isdigit():
            parts[int(f[0])] = {"start": int(f[1].rstrip("s")), "end": int(f[2].rstrip("s")), "fs": f[4] if len(f) > 4 else "",
                                "flags": [x.strip() for x in (f[6] if len(f) > 6 else "").split(",") if x.strip()]}
    return {"type": head[5] if len(head) > 5 else "unknown", "parts": parts}

def extended_numbers():
    """msdos genişletilmiş bölüm numaraları (sfdisk -J tür kodu 5/f/85)."""
    r = subprocess.run(["sfdisk", "-J", DISK], capture_output=True, text=True)
    try:
        parts = json.loads(r.stdout)["partitiontable"].get("partitions", [])
    except (ValueError, KeyError):
        return set()
    out = set()
    for q in parts:
        m = re.search(r"(\d+)$", q.get("node", ""))
        if m and str(q.get("type", "")).lower() in ("5", "f", "85"):
            out.add(int(m.group(1)))
    return out

def ppath(n):
    return f"{DISK}{SEP}{n}"

def settle(n=None):
    """Çekirdeği bilgilendir (kullanımdaki diskte partprobe başarısız olur; partx tek tek çalışır)."""
    subprocess.run(["partx", "-u", DISK], capture_output=True)
    subprocess.run(["partx", "-a", DISK], capture_output=True)
    if shutil.which("udevadm"):
        subprocess.run(["udevadm", "settle", "-t", "10"], capture_output=True)
    if n is not None:
        ready(ppath(n))

def readd(n):
    """Başlangıcı değişen bölüm: partx -u yalnız boyutu günceller, başlangıcı değil — çekirdekten silip yeniden ekle
    (taşıma yalnız bağlı değilken yapılır)."""
    run("partx", "-d", "--nr", str(n), DISK, check=False, quiet=True)
    run("partx", "-a", "--nr", str(n), DISK)
    if shutil.which("udevadm"):
        subprocess.run(["udevadm", "settle", "-t", "10"], capture_output=True)
    ready(ppath(n))
    time.sleep(1)

def ready(path):
    """Bölüm aygıt düğümü doğru aygıtı gösterip açılabilir olana dek bekle (en çok 15 sn): tablo yeniden okunurken udev
    düğümleri siler/yeniden kurar; bu arada eski düğüm yok ("No such device") ya da BAŞKA bölümün numarasında kalmış
    olabilir — düğümün major:minor'ı /sys/class/block/<ad>/dev ile karşılaştırılır."""
    name = os.path.basename(path)
    for _ in range(75):
        try:
            want = sysread(f"/sys/class/block/{name}/dev")
            st = os.stat(path)
            if want and f"{os.major(st.st_rdev)}:{os.minor(st.st_rdev)}" == want:
                os.close(os.open(path, os.O_RDONLY))
                return True
        except OSError:
            pass
        time.sleep(0.2)
    return False

def mounts_of(path):
    r = subprocess.run(["findmnt", "-rn", "-o", "TARGET", "-S", path], capture_output=True, text=True)
    return [t.replace("\\x20", " ") for t in r.stdout.splitlines() if t.strip()]

def swap_active(path):
    real = os.path.realpath(path)
    for line in sysread("/proc/swaps").splitlines()[1:]:
        if line.split() and os.path.realpath(line.split()[0]) == real:
            return True
    return False

def busy(path):
    return bool(mounts_of(path)) or swap_active(path)

def fstype(path):
    """Önbelleksiz (blkid -p) dosya sistemi türü. Tablo yeniden okunduktan hemen sonra düğüm bir an yok olabilir ya da
    eski kalabilir: "imza yok" yanıtı ancak 2 sn boyunca tutarlıysa kabul edilir."""
    t, empty = "", 0
    ready(path)
    for _ in range(40):
        if os.path.exists(path):
            r = subprocess.run(["blkid", "-p", "-o", "value", "-s", "TYPE", path], capture_output=True, text=True)
            t = r.stdout.strip()
            if r.returncode == 0 and t:
                break
            empty += 1
            if empty >= 10:
                break
        time.sleep(0.2)
    return {"vfat": "fat32", "swap": "linux-swap"}.get(t, t)

def op_fs(op, path):
    """Cihazda okunan dosya sistemi; arayüzün gördüğüyle (op["fs_expect"]) uyuşmuyorsa DUR — yanlış türle küçültme veri
    kaybettirir."""
    fs = fstype(path)
    expect = op.get("fs_expect")
    if expect is not None:
        norm = lambda x: "fat" if x in ("fat16", "fat32", "vfat") else (x or "")
        if norm(expect) != norm(fs):
            raise Fail(f"{path} dosya sistemi beklenenden farklı ({fs or 'yok'} ≠ {expect or 'yok'}) — pencereyi yenileyin.")
    return fs

def find(op):
    """İşlemin bölümü: başlangıç sektörüyle (numara kaymış olabilir)."""
    t = table()
    start = int(op["start"])
    for n, p in t["parts"].items():
        if p["start"] == start:
            return n, p, t
    raise Fail(f"{start}. sektörde başlayan bölüm yok — disk pencere açıldıktan sonra değişmiş olabilir; yenileyin.")

def not_busy(path, what):
    if busy(path):
        raise Fail(f"{path} kullanımda (bağlı ya da etkin takas) — {what} için önce ayırın.")

def write_table(*args):
    """parted ile tablo yazımı; kullanımdaki diskte 'unable to inform the kernel' uyarısı yazımın olduğunu gösterir."""
    rc, out, err = run("parted", "-s", "-a", "none", DISK, *args, check=False)
    if rc != 0:
        if "inform the kernel" in (out + err) or "kernel failed to re-read" in (out + err).lower():
            log("  (bölüm tablosu yazıldı; çekirdek partx ile güncelleniyor)")
        else:
            raise Fail("parted başarısız")
    settle()

def sfdisk(*args, stdin=None):
    run("sfdisk", "--no-reread", *args, stdin=stdin)
    settle(int(args[args.index("-N") + 1]) if "-N" in args else None)

PARTED_FS = {"ext2": "ext2", "ext3": "ext3", "ext4": "ext4", "btrfs": "btrfs", "xfs": "xfs", "f2fs": "ext4",
             "fat16": "fat16", "fat32": "fat32", "ntfs": "ntfs", "exfat": "ntfs", "linux-swap": "linux-swap"}

def mkfs(path, fs, label):
    label = label or ""
    if not ready(path):
        raise Fail(f"{path} aygıtı hazır değil.")
    if fs in ("ext2", "ext3", "ext4"):
        need(f"mkfs.{fs}")
        run(f"mkfs.{fs}", "-F", "-q", *(["-L", label] if label else []), path)
    elif fs in ("fat16", "fat32"):
        need("mkfs.vfat")
        run("mkfs.vfat", "-F", fs[3:], *(["-n", label.upper()[:11]] if label else []), path)
    elif fs == "ntfs":
        need("mkfs.ntfs")
        run("mkfs.ntfs", "-Q", "-F", *(["-L", label] if label else []), path, quiet=True)
    elif fs == "exfat":
        need("mkfs.exfat")
        run("mkfs.exfat", *(["-L", label] if label else []), path)
    elif fs == "btrfs":
        need("mkfs.btrfs")
        run("mkfs.btrfs", "-f", *(["-L", label] if label else []), path)
    elif fs == "xfs":
        need("mkfs.xfs")
        run("mkfs.xfs", "-f", *(["-L", label] if label else []), path)
    elif fs == "f2fs":
        need("mkfs.f2fs")
        run("mkfs.f2fs", "-f", *(["-l", label] if label else []), path)
    elif fs == "linux-swap":
        need("mkswap")
        run("mkswap", *(["-L", label] if label else []), path)
    elif fs in ("none", "", None):
        if shutil.which("wipefs"):
            run("wipefs", "-a", path)
    else:
        raise Fail(f"Desteklenmeyen dosya sistemi: {fs}")

@contextlib.contextmanager
def mounted(path):
    """Bağlıysa bağlama noktası; değilse geçici bağlanır ve iş bitince (hata olsa da) ayrılır."""
    mp = mounts_of(path)
    if mp:
        yield mp[0]
        return
    d = f"/run/ankamon-disk-{os.path.basename(path)}"
    os.makedirs(d, exist_ok=True)
    run("mount", path, d)
    try:
        yield d
    finally:
        run("umount", d, check=False)

def grow_fs(path, fs):
    if fs in ("ext2", "ext3", "ext4"):
        if not busy(path):
            run("e2fsck", "-f", "-y", path, ok=(0, 1))
        run("resize2fs", path)
    elif fs == "btrfs":
        with mounted(path) as d:
            run("btrfs", "filesystem", "resize", "max", d)
    elif fs == "xfs":
        with mounted(path) as d:
            run("xfs_growfs", d)
    elif fs == "ntfs":
        run("ntfsresize", "-f", "-f", path, stdin="y\n")
    elif fs == "linux-swap":
        remake_swap(path)
    elif fs in ("", "none", None):
        pass
    else:
        raise Fail(f"{fs} dosya sistemi büyütülemez.")

def shrink_fs(path, fs, new_bytes):
    if fs in ("ext2", "ext3", "ext4"):
        not_busy(path, "küçültme")
        run("e2fsck", "-f", "-y", path, ok=(0, 1))
        run("resize2fs", path, f"{new_bytes // 1024}K")
    elif fs == "ntfs":
        not_busy(path, "küçültme")
        run("ntfsresize", "-f", "-f", "-s", str(new_bytes), path, stdin="y\n")
    elif fs == "btrfs":
        with mounted(path) as d:
            run("btrfs", "filesystem", "resize", str(new_bytes), d)
    elif fs == "linux-swap":
        if swap_active(path):
            raise Fail(f"{path} etkin takas alanı — küçültmek için önce takası kapatın.")
    elif fs in ("", "none", None):
        pass
    else:
        raise Fail(f"{fs} dosya sistemi küçültülemez.")

def remake_swap(path):
    r = subprocess.run(["blkid", "-o", "export", path], capture_output=True, text=True)
    info = dict(l.split("=", 1) for l in r.stdout.splitlines() if "=" in l)
    was = swap_active(path)
    if was:
        run("swapoff", path)
    run("mkswap", *(["-U", info["UUID"]] if info.get("UUID") else []), *(["-L", info["LABEL"]] if info.get("LABEL") else []), path)
    if was:
        run("swapon", path)

def op_mklabel(op):
    tbl = op.get("table")
    if tbl not in ("gpt", "msdos"):
        raise Fail("Geçersiz bölüm tablosu türü.")
    for n in table()["parts"]:
        not_busy(ppath(n), "yeni bölüm tablosu")
    write_table("mklabel", tbl)

def op_create(op):
    t = table()
    start, end = int(op["start"]), int(op["end"])
    if start < 34 or end <= start or (end + 1) * SECTOR > SIZE:
        raise Fail("Geçersiz bölüm sınırları.")
    ext = extended_numbers() if t["type"] == "msdos" else set()
    for n, p in t["parts"].items():
        if not (end < p["start"] or start > p["end"]):
            # mantıksal bölüm genişletilmiş bölümün içinde olur — yalnız onunla (tamamen içinde) çakışabilir
            if not (op.get("kind") == "logical" and n in ext and p["start"] < start and end <= p["end"]):
                raise Fail(f"Yeni bölüm {n}. bölümle çakışıyor.")
    if op.get("kind") == "logical" and not any(t["parts"][n]["start"] < start and end <= t["parts"][n]["end"] for n in ext):
        raise Fail("Mantıksal bölüm genişletilmiş bölümün içinde olmalı.")
    fs = op.get("fs") or "none"
    if t["type"] == "gpt":
        name = re.sub(r"[^\w .-]", "", op.get("name") or "") or "primary"
        args = ["mkpart", name]
    elif t["type"] == "msdos":
        kind = op.get("kind") or "primary"
        if kind not in ("primary", "logical", "extended"):
            raise Fail("Geçersiz bölüm türü.")
        args = ["mkpart", kind]
    else:
        raise Fail("Diskte bölüm tablosu yok — önce bölüm tablosu oluşturun.")
    if op.get("kind") != "extended" and PARTED_FS.get(fs):
        args.append(PARTED_FS[fs])
    write_table("unit", "s", *args, f"{start}s", f"{end}s")
    t2 = table()
    new = [n for n, p in t2["parts"].items() if p["start"] == start]
    if not new:
        raise Fail("Yeni bölüm tabloda görünmüyor.")
    n = new[0]
    settle(n)
    log(f"  yeni bölüm: {ppath(n)}")
    if op.get("kind") != "extended" and fs != "none":
        mkfs(ppath(n), fs, op.get("label"))

def op_delete(op):
    n, p, t = find(op)
    not_busy(ppath(n), "silme")
    if n in (extended_numbers() if t["type"] == "msdos" else set()) and any(
            q["start"] >= p["start"] and q["end"] <= p["end"] for m, q in t["parts"].items() if m >= 5):
        raise Fail("Genişletilmiş bölümün içinde mantıksal bölümler var — önce onları silin.")
    write_table("rm", str(n))
    subprocess.run(["partx", "-d", "--nr", str(n), DISK], capture_output=True)

def op_format(op):
    n, p, t = find(op)
    path = ppath(n)
    not_busy(path, "biçimlendirme")
    fs = op.get("fs") or "none"
    if fs not in PARTED_FS and fs != "none":
        raise Fail(f"Desteklenmeyen dosya sistemi: {fs}")
    if shutil.which("wipefs"):
        run("wipefs", "-a", path)
    mkfs(path, fs, op.get("label"))
    # Bölüm türü kodunu dosya sistemine uydur (msdos: 83/7/c/82; gpt: Linux/Basic data/swap) — en iyi çaba.
    code = {"gpt": {"linux-swap": "0657FD6D-A4AB-43C4-84E5-0933C84B4F4F", "fat16": "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7",
                    "fat32": "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7", "ntfs": "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7",
                    "exfat": "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7"},
            "msdos": {"linux-swap": "82", "fat16": "e", "fat32": "c", "ntfs": "7", "exfat": "7"}}.get(t["type"], {})
    default = {"gpt": "0FC63DAF-8483-4772-8E79-3D69D8477DE4", "msdos": "83"}.get(t["type"])
    if default and fs != "none" and "esp" not in p["flags"] and "boot" not in p["flags"]:
        subprocess.run(["sfdisk", "--no-reread", "--part-type", DISK, str(n), code.get(fs, default)], capture_output=True)

def op_resize(op):
    n, p, t = find(op)
    path = ppath(n)
    new_start, new_end = int(op["new_start"]), int(op["new_end"])
    old_start, old_end = p["start"], p["end"]
    if new_end <= new_start or (new_end + 1) * SECTOR > SIZE:
        raise Fail("Geçersiz yeni sınırlar.")
    for m, q in t["parts"].items():
        if m == n or (t["type"] == "msdos" and m <= 4 and n >= 5 and q["start"] <= old_start and old_end <= q["end"]):
            continue   # kendisi ya da içinde bulunduğu genişletilmiş bölüm
        if t["type"] == "msdos" and n <= 4 and m >= 5 and old_start <= q["start"] and q["end"] <= old_end:
            continue
        if not (new_end < q["start"] or new_start > q["end"]):
            raise Fail(f"Yeni sınırlar {m}. bölümle çakışıyor.")
    fs = op_fs(op, path)
    old_size, new_size = old_end - old_start + 1, new_end - new_start + 1
    moving = new_start != old_start
    if moving:
        not_busy(path, "taşıma")
    if n in extended_numbers() and t["type"] == "msdos":
        raise Fail("Genişletilmiş bölüm bu sürümde yeniden boyutlandırılamaz.")
    if new_size < old_size:
        if fs == "xfs":
            raise Fail("XFS küçültülemez.")
        if fs in ("vfat", "fat16", "fat32", "exfat"):
            raise Fail(f"{fs} küçültülemez (cihazda fatresize yok).")
        shrink_fs(path, fs, new_size * SECTOR)
        sfdisk("-N", str(n), DISK, stdin=f"{old_start},{new_size}\n")
        if moving:
            sfdisk("--move-data", "-N", str(n), DISK, stdin=f"{new_start},{new_size}\n")
            readd(n)
        if fs == "linux-swap":
            remake_swap(path)
    else:
        if fs in ("vfat", "fat16", "fat32", "exfat") and new_size > old_size:
            raise Fail(f"{fs} büyütülemez (cihazda fatresize yok).")
        if moving:
            sfdisk("--move-data", "-N", str(n), DISK, stdin=f"{new_start},{old_size}\n")
            readd(n)
        if new_size > old_size:
            sfdisk("-N", str(n), DISK, stdin=f"{new_start},{new_size}\n")
            grow_fs(path, fs)
    settle(n)

def op_label(op):
    n, p, t = find(op)
    path, label = ppath(n), op.get("label") or ""
    fs = op_fs(op, path)
    if fs.startswith("ext"):
        run("e2label", path, label)
    elif fs == "fat32":
        not_busy(path, "etiket")
        run("fatlabel", path, label.upper()[:11]) if label else run("fatlabel", "-r", path)
    elif fs == "ntfs":
        not_busy(path, "etiket")
        run("ntfslabel", "-f", path, label)
    elif fs == "exfat":
        not_busy(path, "etiket")
        run("exfatlabel", path, label)
    elif fs == "linux-swap":
        run("swaplabel", "-L", label, path)
    elif fs == "btrfs":
        mp = mounts_of(path)
        run("btrfs", "filesystem", "label", mp[0] if mp else path, label)
    elif fs == "xfs":
        not_busy(path, "etiket")
        run("xfs_admin", "-L", label or "--", path)
    else:
        raise Fail(f"{fs or 'bilinmeyen'} dosya sisteminde etiket değiştirilemez.")

def op_name(op):
    n, p, t = find(op)
    if t["type"] != "gpt":
        raise Fail("Bölüm adı yalnız GPT'de.")
    sfdisk("--part-label", DISK, str(n), re.sub(r"[^\w .-]", "", op.get("name") or ""))

FLAGS = {"boot", "esp", "bios_grub", "legacy_boot", "msftdata", "msftres", "hidden", "diag", "lvm", "raid", "swap",
         "lba", "prep", "irst", "chromeos_kernel", "bls_boot", "linux-home", "no_automount"}

def op_flag(op):
    n, p, t = find(op)
    flag = op.get("flag")
    if flag not in FLAGS:
        raise Fail(f"Geçersiz bayrak: {flag}")
    write_table("set", str(n), flag, "on" if op.get("on") else "off")

def op_check(op):
    n, p, t = find(op)
    path = ppath(n)
    not_busy(path, "denetleme")
    fs = op_fs(op, path)
    if fs.startswith("ext"):
        run("e2fsck", "-f", "-y", "-v", path, ok=(0, 1))
        run("resize2fs", path)   # GParted gibi: dosya sistemini bölümü dolduracak kadar büyüt
    elif fs == "fat32":
        run("fsck.vfat", "-a", "-w", "-v", path, ok=(0, 1))
    elif fs == "ntfs":
        run("ntfsfix", path)
    elif fs == "exfat":
        run("fsck.exfat", "-y", path, ok=(0, 1))
    elif fs == "btrfs":
        run("btrfs", "check", "--readonly", path)
    elif fs == "xfs":
        run("xfs_repair", path)
    elif fs == "linux-swap":
        log("  takas alanında denetlenecek bir şey yok")
    else:
        raise Fail(f"{fs or 'bilinmeyen'} dosya sistemi denetlenemez.")

def op_mount(op):
    n, p, t = find(op)
    path = ppath(n)
    fs = op_fs(op, path)
    if fs == "linux-swap":
        run("swapon", path)
        return
    if mounts_of(path):
        log("  zaten bağlı")
        return
    r = subprocess.run(["blkid", "-o", "value", "-s", "LABEL", path], capture_output=True, text=True)
    name = re.sub(r"[^\w.-]", "_", r.stdout.strip()) or os.path.basename(path)
    d = f"/media/ankamon/{name}"
    os.makedirs(d, exist_ok=True)
    run("mount", path, d)

def op_umount(op):
    n, p, t = find(op)
    path = ppath(n)
    if swap_active(path):
        run("swapoff", path)
    for target in reversed(mounts_of(path)):
        if target in ("/", "/boot", "/boot/efi", "/usr", "/var", "/home"):
            raise Fail(f"{target} sistem bağlama noktası — ayrılamaz.")
        run("umount", target)
        if target.startswith("/media/ankamon/"):
            # Bağla'nın açtığı boş dizin kalmasın (doluysa rmdir zaten dokunmaz).
            for d in (target, "/media/ankamon"):
                try:
                    os.rmdir(d)
                except OSError:
                    break

def op_uuid(op):
    n, p, t = find(op)
    path = ppath(n)
    not_busy(path, "yeni UUID")
    fs = op_fs(op, path)
    if fs.startswith("ext"):
        run("e2fsck", "-f", "-y", path, ok=(0, 1))
        run("tune2fs", "-U", "random", path)
    elif fs == "fat32":
        run("fatlabel", "-i", "-r", path)
    elif fs == "ntfs":
        run("ntfslabel", "-f", "--new-serial", path)
    elif fs == "linux-swap":
        run("swaplabel", "-U", sysread("/proc/sys/kernel/random/uuid"), path)
    elif fs == "btrfs":
        need("btrfstune")
        run("btrfstune", "-f", "-u", path, stdin="y\n")
    elif fs == "xfs":
        run("xfs_admin", "-U", "generate", path)
    else:
        raise Fail(f"{fs or 'bilinmeyen'} dosya sisteminde UUID değiştirilemez.")

OPS = {"mklabel": op_mklabel, "create": op_create, "delete": op_delete, "format": op_format, "resize": op_resize,
       "label": op_label, "name": op_name, "flag": op_flag, "check": op_check, "mount": op_mount, "umount": op_umount,
       "uuid": op_uuid}

try:
    need("parted")
    need("sfdisk")
    check_disk()
    ops = spec.get("ops") or []
    if not ops:
        raise Fail("Uygulanacak işlem yok.")
    for i, op in enumerate(ops, 1):
        fn = OPS.get(op.get("op"))
        if fn is None:
            raise Fail(f"Bilinmeyen işlem: {op.get('op')}")
        log(f"▸ {i}/{len(ops)}: {op.get('title') or op.get('op')}")
        fn(op)
        log("  ✓ tamam")
    settle()
    log(f"Bütün işlemler uygulandı ({len(ops)}).")
except Fail as e:
    log(f"✗ {e}")
    log("Kalan işlemler uygulanmadı.")
    sys.exit(1)
ANKAMON_DISK_PY
