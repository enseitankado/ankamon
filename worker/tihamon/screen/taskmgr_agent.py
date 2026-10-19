"""Tiha-Mon görev yöneticisi ajanı — TAHTADA root olarak çalışır (bkz. taskmgr.py, SSH ile base64 gönderilir).

Yalnız standart kitaplık (ETAP'ta python3 hazır gelir; kurulum yok). stdout'a satır başına bir JSON çerçeve
basar, stdin'den satır başına bir JSON komut okur; stdin kapanınca (SSH/WebSocket koptu) kendiliğinden çıkar.

Çerçeveler:
  {"t":"static", ...}  bir kez: işlemci/bellek/disk/ağ/GPU donanım bilgisi
  {"t":"snap", ...}    her `interval` sn: süreçler, CPU/bellek/disk/ağ/GPU ölçümleri, pencereler, oturumlar
  {"t":"services"|"startup", "items":[...]}  istenen sekme açıkken (bkz. "want") seyrek
  {"t":"res","id":n,"ok":bool,"msg":"...", ...}  komut yanıtı
Komutlar (op): kill, killtree, renice, affinity, getaffinity, efficiency, svc, startup, logout, lock, run,
props, interval, want.
"""

import glob
import json
import os
import pwd
import re
import select
import shlex
import subprocess
import sys
import time

HZ = os.sysconf("SC_CLK_TCK")
PAGE_KB = os.sysconf("SC_PAGE_SIZE") // 1024
NCPU = os.cpu_count() or 1
SELF = os.getpid()
PF_KTHREAD = 0x00200000
DISK_RE = re.compile(r"^(sd[a-z]+|nvme\d+n\d+|mmcblk\d+|vd[a-z]+|hd[a-z]+|xvd[a-z]+)$")
UNIT_RE = re.compile(r"^[A-Za-z0-9@._:\\-]+\.service$")
DESKTOP_RE = re.compile(r"^[A-Za-z0-9@._+-]+\.desktop$")

state = {"interval": 1.0, "want": set(), "eco": set()}


def emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def read(path, default=""):
    try:
        with open(path, "r", errors="replace") as f:
            return f.read()
    except OSError:
        return default


def run(cmd, timeout=15, env=None):
    try:
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
                           env=env, universal_newlines=True)
        return p.returncode, p.stdout, p.stderr.strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, "", str(e)


_users = {}


def uname(uid):
    if uid not in _users:
        try:
            _users[uid] = pwd.getpwuid(uid).pw_name
        except KeyError:
            _users[uid] = str(uid)
    return _users[uid]


# ---------------------------------------------------------------- oturum / ekran
def session_info():
    """Etkin VT'deki X ekranı + o ekranın oturum kullanıcısı (bkz. executor/cast.py _FIND_DISPLAY)."""
    vt = read("/sys/class/tty/tty0/active").strip().replace("tty", "vt")
    disp, auth = ":0", None
    for d in glob.glob("/proc/[0-9]*/cmdline"):
        args = read(d).split("\0")
        if not args or not os.path.basename(args[0]) in ("Xorg", "X"):
            continue
        if vt and vt not in args:
            continue
        for i, a in enumerate(args):
            if re.match(r"^:\d+$", a):
                disp = a
            if a == "-auth" and i + 1 < len(args):
                auth = args[i + 1]
        break
    user = uid = None
    rc, out, _ = run(["loginctl", "list-sessions", "--no-legend"])
    for line in out.splitlines():
        sid = line.split()[0] if line.split() else None
        if not sid:
            continue
        rc, info, _ = run(["loginctl", "show-session", sid, "-p", "Display", "-p", "Name", "-p", "State", "-p", "User"])
        kv = dict(x.split("=", 1) for x in info.splitlines() if "=" in x)
        if kv.get("Display") != disp:
            continue
        if kv.get("State") == "active" or user is None:
            user, uid = kv.get("Name"), int(kv.get("User") or 0)
            if kv.get("State") == "active":
                break
    return {"display": disp, "auth": auth, "user": user, "uid": uid}


def user_env(sess):
    env = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "DISPLAY": sess["display"]}
    if sess.get("auth"):
        env["XAUTHORITY"] = sess["auth"]
    if sess.get("uid"):
        env["XDG_RUNTIME_DIR"] = "/run/user/%d" % sess["uid"]
        env["DBUS_SESSION_BUS_ADDRESS"] = "unix:path=/run/user/%d/bus" % sess["uid"]
    return env


# ---------------------------------------------------------------- donanım (bir kez)
def static_info():
    info = {"t": "static", "self": SELF, "ncpu": NCPU, "hostname": os.uname().nodename}
    cpuinfo = read("/proc/cpuinfo")
    model = re.search(r"^model name\s*:\s*(.+)$", cpuinfo, re.M)
    info["cpu_model"] = model.group(1).strip() if model else ""
    phys = set(re.findall(r"^physical id\s*:\s*(\d+)", cpuinfo, re.M))
    cores = set(re.findall(r"^core id\s*:\s*(\d+)", cpuinfo, re.M))
    info["sockets"] = max(1, len(phys))
    info["cores"] = max(1, len(cores)) * max(1, len(phys))
    flags = re.search(r"^flags\s*:\s*(.+)$", cpuinfo, re.M)
    fl = flags.group(1).split() if flags else []
    info["virtualization"] = "vmx" in fl or "svm" in fl
    base = read("/sys/devices/system/cpu/cpu0/cpufreq/base_frequency").strip() or \
        read("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq").strip()
    info["base_mhz"] = int(base) // 1000 if base.isdigit() else None
    caches = {}
    for idx in glob.glob("/sys/devices/system/cpu/cpu0/cache/index*"):
        level = read(idx + "/level").strip()
        ctype = read(idx + "/type").strip()
        size = read(idx + "/size").strip()
        key = "L" + level + ("" if ctype == "Unified" else (" (veri)" if ctype == "Data" else " (komut)"))
        caches[key] = size
    info["caches"] = caches
    # Bellek modülleri (dmidecode, root): hız, kullanılan/toplam yuva, biçim.
    rc, out, _ = run(["dmidecode", "-t", "17"])
    slots = used = 0
    speed = form = None
    for block in out.split("\n\n"):
        if "Memory Device" not in block:
            continue
        slots += 1
        size = re.search(r"^\s*Size:\s*(.+)$", block, re.M)
        if size and "No Module" not in size.group(1):
            used += 1
            sp = re.search(r"^\s*(Configured Memory Speed|Speed):\s*(\d+)", block, re.M)
            speed = speed or (sp.group(2) if sp else None)
            ff = re.search(r"^\s*Form Factor:\s*(.+)$", block, re.M)
            form = form or (ff.group(1).strip() if ff else None)
    info["mem_hw"] = {"slots": slots or None, "used": used or None, "speed": speed, "form": form}
    disks = []
    for name in sorted(os.listdir("/sys/block")):
        if not DISK_RE.match(name):
            continue
        sectors = read("/sys/block/%s/size" % name).strip()
        disks.append({"name": name, "model": (read("/sys/block/%s/device/model" % name).strip() or name),
                      "size": int(sectors) * 512 if sectors.isdigit() else None,
                      "ssd": read("/sys/block/%s/queue/rotational" % name).strip() == "0"})
    info["disks"] = disks
    nets = []
    for name in sorted(os.listdir("/sys/class/net")):
        if name == "lo" or not os.path.exists("/sys/class/net/%s/device" % name):
            continue
        drv = os.path.basename(os.path.realpath("/sys/class/net/%s/device/driver" % name))
        nets.append({"name": name, "wireless": os.path.exists("/sys/class/net/%s/wireless" % name), "driver": drv})
    info["nets"] = nets
    gpus = []
    rc, out, _ = run(["lspci", "-mm"])
    for line in out.splitlines():
        if re.search(r'"(VGA compatible controller|3D controller|Display controller)"', line):
            parts = shlex.split(line)
            gpus.append({"name": (parts[2] + " " + parts[3]) if len(parts) > 3 else line})
    cards = sorted(glob.glob("/sys/class/drm/card[0-9]"))
    for i, g in enumerate(gpus):
        if i < len(cards):
            g["card"] = cards[i]
            g["driver"] = os.path.basename(os.path.realpath(cards[i] + "/device/driver"))
            vram = read(cards[i] + "/device/mem_info_vram_total").strip()
            g["vram"] = int(vram) if vram.isdigit() else None
    info["gpus"] = gpus
    return info


# ---------------------------------------------------------------- ölçüm
class Sampler:
    def __init__(self):
        self.prev = None
        self.cmd_cache = {}
        self.tcp_prev = {}
        self.win = {}
        self.win_at = 0
        self.sess = None
        self.sess_at = 0

    @staticmethod
    def _cpu():
        cpus = {}
        for line in read("/proc/stat").splitlines():
            if line.startswith("cpu"):
                p = line.split()
                cpus[p[0]] = [int(x) for x in p[1:9]]
        return cpus

    @staticmethod
    def _busy(prev, cur):
        d = [c - p for p, c in zip(prev, cur)]
        total = sum(d) or 1
        idle = d[3] + d[4]
        return round(100.0 * (total - idle) / total, 1), total

    def _tcp(self):
        """Süreç başına TCP aktarımı (bayt): ss -tinp — soket başına bytes_sent/received toplamı."""
        rc, out, _ = run(["ss", "-tinpH"], timeout=5)
        per = {}
        pids = []
        for line in out.splitlines():
            if not line.startswith((" ", "\t")):
                pids = [int(x) for x in re.findall(r"pid=(\d+)", line)]
                continue
            sent = re.search(r"bytes_sent:(\d+)", line) or re.search(r"bytes_acked:(\d+)", line)
            recv = re.search(r"bytes_received:(\d+)", line)
            total = (int(sent.group(1)) if sent else 0) + (int(recv.group(1)) if recv else 0)
            for pid in set(pids):
                per[pid] = per.get(pid, 0) + total
        return per

    def _windows(self):
        """Pencereli süreçler (Uygulamalar grubu): _NET_CLIENT_LIST → _NET_WM_PID + başlık. 2 sn'de bir."""
        now = time.time()
        if now - self.sess_at > 10 or self.sess is None:
            self.sess = session_info()
            self.sess_at = now
        if now - self.win_at < 2:
            return self.win
        self.win_at = now
        env = user_env(self.sess)
        rc, out, _ = run(["xprop", "-root", "-notype", "_NET_CLIENT_LIST"], timeout=4, env=env)
        win = {}
        for wid in re.findall(r"0x[0-9a-fA-F]+", out):
            rc, props, _ = run(["xprop", "-id", wid, "-notype", "_NET_WM_PID", "_NET_WM_NAME", "WM_NAME",
                                "_NET_WM_WINDOW_TYPE"], timeout=4, env=env)
            pid = re.search(r"_NET_WM_PID = (\d+)", props)
            if not pid or "_NET_WM_WINDOW_TYPE_DOCK" in props or "_NET_WM_WINDOW_TYPE_DESKTOP" in props:
                continue
            title = re.search(r'_NET_WM_NAME = "(.*)"', props) or re.search(r'WM_NAME = "(.*)"', props)
            win.setdefault(int(pid.group(1)), []).append({"id": wid, "title": title.group(1) if title else ""})
        self.win = win
        return win

    def sample(self):
        now = time.time()
        cpus = self._cpu()
        meminfo = {}
        for line in read("/proc/meminfo").splitlines():
            k, _, v = line.partition(":")
            meminfo[k] = int(v.split()[0]) if v.split() else 0
        diskstats = {}
        for line in read("/proc/diskstats").splitlines():
            p = line.split()
            if len(p) >= 14 and DISK_RE.match(p[2]):
                diskstats[p[2]] = [int(x) for x in p[3:14]]
        netdev = {}
        for line in read("/proc/net/dev").splitlines()[2:]:
            name, _, rest = line.partition(":")
            name = name.strip()
            if name and name != "lo":
                p = rest.split()
                netdev[name] = (int(p[0]), int(p[8]))
        procs = {}
        for d in os.listdir("/proc"):
            if not d.isdigit():
                continue
            pid = int(d)
            raw = read("/proc/%d/stat" % pid)
            if not raw:
                continue
            r = raw.rfind(")")
            comm = raw[raw.find("(") + 1:r]
            f = raw[r + 2:].split()
            if len(f) < 37:
                continue
            status = read("/proc/%d/status" % pid)
            uid = re.search(r"^Uid:\s+(\d+)", status, re.M)
            rss = re.search(r"^RssAnon:\s+(\d+)", status, re.M)
            shm = re.search(r"^RssShmem:\s+(\d+)", status, re.M)
            io = read("/proc/%d/io" % pid)
            rb = re.search(r"^read_bytes: (\d+)", io, re.M)
            wb = re.search(r"^write_bytes: (\d+)", io, re.M)
            start = int(f[19])
            key = (pid, start)
            if key not in self.cmd_cache:
                cmd = read("/proc/%d/cmdline" % pid).replace("\0", " ").strip()
                try:
                    exe = os.readlink("/proc/%d/exe" % pid)
                except OSError:
                    exe = ""
                self.cmd_cache[key] = (cmd[:300], exe)
            cmd, exe = self.cmd_cache[key]
            procs[pid] = {
                "comm": comm, "state": f[0], "ppid": int(f[1]), "flags": int(f[6]),
                "ticks": int(f[11]) + int(f[12]), "nice": int(f[16]), "threads": int(f[17]), "start": start,
                "uid": int(uid.group(1)) if uid else 0,
                "mem": (int(rss.group(1)) if rss else 0) + (int(shm.group(1)) if shm else 0),
                "io": (int(rb.group(1)) if rb else 0) + (int(wb.group(1)) if wb else 0),
                "cmd": cmd, "exe": exe,
            }
        alive = {(p, v["start"]) for p, v in procs.items()}
        for k in [k for k in self.cmd_cache if k not in alive]:
            del self.cmd_cache[k]
        tcp = self._tcp()
        win = self._windows()
        cur = {"t": now, "cpus": cpus, "disk": diskstats, "net": netdev, "procs": procs, "tcp": tcp}
        prev, self.prev = self.prev, cur
        if prev is None:
            return None
        dt = max(0.001, now - prev["t"])
        total_busy, total_ticks = self._busy(prev["cpus"]["cpu"], cpus["cpu"])
        cores = [self._busy(prev["cpus"][k], cpus[k])[0]
                 for k in sorted((k for k in cpus if k != "cpu"), key=lambda k: int(k[3:])) if k in prev["cpus"]]
        mhz = [float(x) for x in re.findall(r"^cpu MHz\s*:\s*([\d.]+)", read("/proc/cpuinfo"), re.M)]
        disks = []
        for name, c in diskstats.items():
            p = prev["disk"].get(name)
            if not p:
                continue
            ios = (c[0] - p[0]) + (c[4] - p[4])
            ms = (c[3] - p[3]) + (c[7] - p[7])
            disks.append({"name": name, "busy": min(100.0, round((c[9] - p[9]) / (dt * 10.0), 1)),
                          "r": int((c[2] - p[2]) * 512 / dt), "w": int((c[6] - p[6]) * 512 / dt),
                          "resp": round(ms / ios, 1) if ios else 0.0})
        nets = []
        for name, (rx, tx) in netdev.items():
            p = prev["net"].get(name)
            if p:
                nets.append({"name": name, "rx": int(max(0, rx - p[0]) / dt), "tx": int(max(0, tx - p[1]) / dt),
                             "up": read("/sys/class/net/%s/operstate" % name).strip() == "up",
                             "speed": read("/sys/class/net/%s/speed" % name).strip()})
        rows = []
        for pid, v in procs.items():
            pp = prev["procs"].get(pid)
            same = pp is not None and pp["start"] == v["start"]
            cpu = round(100.0 * max(0, v["ticks"] - pp["ticks"]) / total_ticks, 1) if same else 0.0
            disk = int(max(0, v["io"] - pp["io"]) / dt) if same else 0
            net = int(max(0, tcp.get(pid, 0) - prev["tcp"].get(pid, 0)) / dt) if same else 0
            rows.append([pid, v["ppid"], v["comm"], v["state"], uname(v["uid"]), cpu, v["mem"], disk, net,
                         v["threads"], v["nice"], v["start"], v["ticks"], 1 if v["flags"] & PF_KTHREAD else 0,
                         v["cmd"], v["exe"], 1 if pid in state["eco"] else 0, v["uid"]])
        gpus = []
        for card in sorted(glob.glob("/sys/class/drm/card[0-9]")):
            busy = read(card + "/device/gpu_busy_percent").strip()
            used = read(card + "/device/mem_info_vram_used").strip()
            freq = read(card + "/gt_act_freq_mhz").strip() or read(card + "/gt_cur_freq_mhz").strip()
            gpus.append({"busy": int(busy) if busy.isdigit() else None, "vram_used": int(used) if used.isdigit() else None,
                         "mhz": int(freq) if freq.isdigit() else None})
        m = meminfo
        return {
            "t": "snap", "dt": round(dt, 2), "uptime": int(float(read("/proc/uptime").split()[0] or 0)),
            "cpu": {"total": total_busy, "cores": cores, "mhz": round(sum(mhz) / len(mhz)) if mhz else None},
            "mem": {"total": m.get("MemTotal", 0), "avail": m.get("MemAvailable", 0), "free": m.get("MemFree", 0),
                    "cached": m.get("Cached", 0) + m.get("SReclaimable", 0), "buffers": m.get("Buffers", 0),
                    "committed": m.get("Committed_AS", 0), "commit_limit": m.get("CommitLimit", 0),
                    "paged": m.get("SReclaimable", 0), "nonpaged": m.get("SUnreclaim", 0),
                    "swap_total": m.get("SwapTotal", 0), "swap_free": m.get("SwapFree", 0),
                    "shmem": m.get("Shmem", 0), "dirty": m.get("Dirty", 0)},
            "disks": disks, "nets": nets, "gpus": gpus,
            "handles": int((read("/proc/sys/fs/file-nr").split() or ["0"])[0]),
            "procs": rows, "windows": {str(k): v for k, v in win.items()},
            "session": self.sess,
        }


# ---------------------------------------------------------------- seyrek bölümler
def services():
    items = {}
    rc, out, _ = run(["systemctl", "list-unit-files", "--type=service", "--no-legend", "--no-pager", "--plain"])
    for line in out.splitlines():
        p = line.split()
        if p and p[0].endswith(".service") and "@" not in p[0]:
            items[p[0]] = {"name": p[0], "file_state": p[1] if len(p) > 1 else "", "active": "inactive",
                           "sub": "dead", "pid": 0, "desc": ""}
    rc, out, _ = run(["systemctl", "show", "--no-pager", "-p", "Id", "-p", "MainPID", "-p", "ActiveState",
                      "-p", "SubState", "-p", "Description", "-p", "UnitFileState", "*.service"], timeout=20)
    for block in out.split("\n\n"):
        kv = dict(x.split("=", 1) for x in block.splitlines() if "=" in x)
        name = kv.get("Id")
        if not name:
            continue
        it = items.setdefault(name, {"name": name, "file_state": ""})
        it.update({"active": kv.get("ActiveState", ""), "sub": kv.get("SubState", ""),
                   "pid": int(kv.get("MainPID") or 0), "desc": kv.get("Description", ""),
                   "file_state": kv.get("UnitFileState") or it.get("file_state", "")})
    return sorted(items.values(), key=lambda x: x["name"])


def _desktop(path):
    kv = {}
    section = None
    for line in read(path).splitlines():
        line = line.strip()
        if line.startswith("["):
            section = line
            continue
        if section == "[Desktop Entry]" and "=" in line:
            k, _, v = line.partition("=")
            kv.setdefault(k.strip(), v.strip())
    return kv


def _enabled(kv):
    return kv.get("Hidden", "").lower() != "true" and kv.get("X-GNOME-Autostart-enabled", "true").lower() != "false"


def startup(sess):
    user = sess.get("user") if sess else None
    home = None
    if user and user != "lightdm":
        try:
            home = pwd.getpwnam(user).pw_dir
        except KeyError:
            home = None
    files = {}
    for path in sorted(glob.glob("/etc/xdg/autostart/*.desktop")):
        files[os.path.basename(path)] = {"system": path}
    if home:
        for path in sorted(glob.glob(home + "/.config/autostart/*.desktop")):
            files.setdefault(os.path.basename(path), {})["user"] = path
    owners = {}
    sys_paths = [v["system"] for v in files.values() if "system" in v]
    if sys_paths:
        rc, out, _ = run(["dpkg", "-S"] + sys_paths, timeout=20)
        for line in out.splitlines():
            pkg, _, path = line.partition(": ")
            owners[path.strip()] = pkg.split(":")[0]
    items = []
    for fid, paths in files.items():
        base = _desktop(paths["system"]) if "system" in paths else {}
        over = _desktop(paths["user"]) if "user" in paths else {}
        kv = dict(base, **over)
        if not kv:
            continue
        name = kv.get("Name[tr]") or kv.get("Name") or fid
        items.append({"id": fid, "name": name, "comment": kv.get("Comment[tr]") or kv.get("Comment", ""),
                      "exec": kv.get("Exec", ""), "enabled": _enabled(kv),
                      "publisher": owners.get(paths.get("system", ""), "kullanıcı" if "user" in paths and "system" not in paths else ""),
                      "scope": "user" if "user" in paths and "system" not in paths else "system",
                      "only": kv.get("OnlyShowIn", ""), "not": kv.get("NotShowIn", "")})
    return {"t": "startup", "user": user if home else None, "items": sorted(items, key=lambda x: x["name"].lower())}


def sessions():
    rc, out, _ = run(["loginctl", "list-sessions", "--no-legend"])
    items = []
    for line in out.splitlines():
        p = line.split()
        if not p:
            continue
        rc, info, _ = run(["loginctl", "show-session", p[0], "-p", "Name", "-p", "User", "-p", "State", "-p", "Type",
                           "-p", "Class", "-p", "Remote", "-p", "RemoteHost", "-p", "Display", "-p", "TTY",
                           "-p", "Timestamp", "-p", "Seat"])
        kv = dict(x.split("=", 1) for x in info.splitlines() if "=" in x)
        items.append({"id": p[0], "user": kv.get("Name", ""), "uid": int(kv.get("User") or 0), "state": kv.get("State", ""),
                      "type": kv.get("Type", ""), "class": kv.get("Class", ""), "remote": kv.get("Remote") == "yes",
                      "host": kv.get("RemoteHost", ""), "display": kv.get("Display", ""), "tty": kv.get("TTY", ""),
                      "since": kv.get("Timestamp", ""), "seat": kv.get("Seat", "")})
    return items


# ---------------------------------------------------------------- komutlar
def _tasks(pid):
    return [int(t) for t in os.listdir("/proc/%d/task" % pid)] if os.path.isdir("/proc/%d/task" % pid) else [pid]


def _descendants(pid):
    children = {}
    for d in os.listdir("/proc"):
        if d.isdigit():
            raw = read("/proc/%s/stat" % d)
            if raw:
                ppid = int(raw[raw.rfind(")") + 2:].split()[1])
                children.setdefault(ppid, []).append(int(d))
    out, stack = [], [pid]
    while stack:
        p = stack.pop()
        out.append(p)
        stack.extend(children.get(p, []))
    return out


def _guard(pid):
    if pid in (1, SELF, os.getppid()):
        raise ValueError("Bu süreç sonlandırılamaz/değiştirilemez (sistem ya da görev yöneticisinin kendisi).")


def command(cmd, sampler):
    op = cmd.get("op")
    pid = int(cmd.get("pid") or 0)
    if op == "interval":
        state["interval"] = float(cmd.get("sec", 1))
        return {"ok": True}
    if op == "want":
        state["want"] = set(cmd.get("what") or [])
        return {"ok": True}
    if op == "kill":
        _guard(pid)
        os.kill(pid, 9 if cmd.get("force") else 15)
        return {"ok": True, "msg": "Sonlandırma sinyali gönderildi."}
    if op == "killtree":
        _guard(pid)
        victims = _descendants(pid)
        for p in reversed(victims):
            if p not in (1, SELF, os.getppid()):
                try:
                    os.kill(p, 9)
                except ProcessLookupError:
                    pass
        return {"ok": True, "msg": "%d süreç sonlandırıldı." % len(victims)}
    if op == "renice":
        _guard(pid)
        nice = max(-20, min(19, int(cmd.get("nice", 0))))
        for t in _tasks(pid):
            os.setpriority(os.PRIO_PROCESS, t, nice)
        return {"ok": True, "msg": "Öncelik: nice %d" % nice}
    if op == "getaffinity":
        return {"ok": True, "cpus": sorted(os.sched_getaffinity(pid)), "ncpu": NCPU}
    if op == "affinity":
        _guard(pid)
        cpus = {int(c) for c in cmd.get("cpus") or [] if 0 <= int(c) < NCPU}
        if not cpus:
            raise ValueError("En az bir işlemci seçilmeli.")
        for t in _tasks(pid):
            os.sched_setaffinity(t, cpus)
        return {"ok": True}
    if op == "efficiency":
        _guard(pid)
        on = bool(cmd.get("on"))
        for p in _descendants(pid):
            for t in _tasks(p):
                try:
                    os.setpriority(os.PRIO_PROCESS, t, 19 if on else 0)
                except OSError:
                    pass
            run(["ionice", "-c", "3" if on else "2", "-p", str(p)] + ([] if on else ["-n", "4"]), timeout=5)
            (state["eco"].add if on else state["eco"].discard)(p)
        return {"ok": True, "msg": "Verimlilik modu " + ("açıldı" if on else "kapatıldı")}
    if op == "svc":
        name, action = str(cmd.get("name", "")), cmd.get("action")
        if not UNIT_RE.match(name) or action not in ("start", "stop", "restart"):
            raise ValueError("Geçersiz hizmet/işlem.")
        rc, out, err = run(["systemctl", action, name], timeout=60)
        if rc:
            raise ValueError(err or "systemctl %s başarısız (%d)" % (action, rc))
        return {"ok": True}
    if op == "startup":
        fid, enable = str(cmd.get("id", "")), bool(cmd.get("enable"))
        if not DESKTOP_RE.match(fid):
            raise ValueError("Geçersiz başlangıç girdisi.")
        sess = sampler.sess or session_info()
        user = sess.get("user")
        if not user or user == "lightdm":
            raise ValueError("Tahtada oturum açık değil: başlangıç uygulamaları oturum açan kullanıcıya göre ayarlanır.")
        pw = pwd.getpwnam(user)
        target_dir = pw.pw_dir + "/.config/autostart"
        target = target_dir + "/" + fid
        system = "/etc/xdg/autostart/" + fid
        if os.path.exists(system):
            if enable:
                # Kullanıcı geçersiz kılmasını kaldır → sistem girdisi geçerli olur.
                if os.path.exists(target) and not _enabled(_desktop(target)):
                    os.remove(target)
            else:
                os.makedirs(target_dir, exist_ok=True)
                with open(system) as src:
                    lines = [l for l in src.read().splitlines() if not l.startswith(("Hidden=", "X-GNOME-Autostart-enabled="))]
                out = []
                for l in lines:
                    out.append(l)
                    if l.strip() == "[Desktop Entry]":
                        out.append("Hidden=true")
                with open(target, "w") as f:
                    f.write("\n".join(out) + "\n")
                os.chown(target_dir, pw.pw_uid, pw.pw_gid)
                os.chown(target, pw.pw_uid, pw.pw_gid)
        elif os.path.exists(target):
            with open(target) as src:
                lines = [l for l in src.read().splitlines() if not l.startswith("Hidden=")]
            out = []
            for l in lines:
                out.append(l)
                if l.strip() == "[Desktop Entry]":
                    out.append("Hidden=" + ("false" if enable else "true"))
            with open(target, "w") as f:
                f.write("\n".join(out) + "\n")
        else:
            raise ValueError("Girdi bulunamadı.")
        return {"ok": True, "msg": "%s: %s (%s)" % (fid, "etkin" if enable else "devre dışı", user)}
    if op in ("logout", "lock"):
        sid = str(cmd.get("session", ""))
        if not re.match(r"^[A-Za-z0-9]+$", sid):
            raise ValueError("Geçersiz oturum.")
        if op == "logout":
            rc, out, err = run(["loginctl", "terminate-session", sid])
        else:
            # ETAP kilidi LightDM'in kilit ekranıdır (bkz. executor/accounts.py).
            rc, out, err = run(["busctl", "--system", "call", "org.freedesktop.DisplayManager",
                                "/org/freedesktop/DisplayManager/Seat0", "org.freedesktop.DisplayManager.Seat", "Lock"])
        if rc:
            raise ValueError(err or "başarısız (%d)" % rc)
        return {"ok": True}
    if op == "run":
        line = str(cmd.get("cmd", "")).strip()
        if not line:
            raise ValueError("Komut boş.")
        sess = session_info()
        env = user_env(sess)
        if cmd.get("admin") or not sess.get("user") or sess.get("user") == "lightdm":
            argv = ["setsid", "sh", "-c", line]
            who = "root"
        else:
            argv = ["setsid", "runuser", "-u", sess["user"], "--", "env"] + ["%s=%s" % kv for kv in env.items()] + ["sh", "-c", line]
            who = sess["user"]
        subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         env=env, close_fds=True, start_new_session=True)
        return {"ok": True, "msg": "Başlatıldı (%s olarak)." % who}
    if op == "props":
        status = read("/proc/%d/status" % pid)
        if not status:
            raise ValueError("Süreç artık yok.")
        kv = {}
        for line in status.splitlines():
            k, _, v = line.partition(":")
            kv[k] = v.strip()
        raw = read("/proc/%d/stat" % pid)
        f = raw[raw.rfind(")") + 2:].split()
        boot = time.time() - float(read("/proc/uptime").split()[0])
        def link(n):
            try:
                return os.readlink("/proc/%d/%s" % (pid, n))
            except OSError:
                return ""
        try:
            fds = len(os.listdir("/proc/%d/fd" % pid))
        except OSError:
            fds = None
        rc, ion, _ = run(["ionice", "-p", str(pid)], timeout=3)
        return {"ok": True, "props": {
            "pid": pid, "name": kv.get("Name"), "exe": link("exe"), "cwd": link("cwd"),
            "cmdline": read("/proc/%d/cmdline" % pid).replace("\0", " ").strip(),
            "user": uname(int((kv.get("Uid") or "0").split()[0])), "state": kv.get("State"), "ppid": kv.get("PPid"),
            "threads": kv.get("Threads"), "vm_peak": kv.get("VmPeak"), "vm_size": kv.get("VmSize"),
            "vm_rss": kv.get("VmRSS"), "vm_swap": kv.get("VmSwap"),
            "ctx": [kv.get("voluntary_ctxt_switches"), kv.get("nonvoluntary_ctxt_switches")],
            "started": boot + int(f[19]) / HZ if len(f) > 19 else None, "nice": int(f[16]) if len(f) > 16 else None,
            "cpu_time": (int(f[11]) + int(f[12])) / HZ if len(f) > 12 else None,
            "wchan": read("/proc/%d/wchan" % pid).strip(), "fds": fds, "ionice": ion.strip(),
            "cgroup": read("/proc/%d/cgroup" % pid).strip().splitlines()[-1:] ,
            "affinity": sorted(os.sched_getaffinity(pid)),
        }}
    raise ValueError("Bilinmeyen işlem: %s" % op)


def main():
    emit(static_info())
    sampler = Sampler()
    sampler.sample()
    buf = b""
    next_at = time.time() + 0.5
    slow_at = {"services": 0, "startup": 0, "users": 0}
    while True:
        timeout = max(0.0, next_at - time.time()) if state["interval"] > 0 else 1.0
        r, _, _ = select.select([sys.stdin.buffer], [], [], timeout)
        if r:
            chunk = os.read(sys.stdin.fileno(), 65536)
            if not chunk:
                return  # SSH/WebSocket kapandı
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                if not line.strip():
                    continue
                try:
                    cmd = json.loads(line)
                except ValueError:
                    continue
                try:
                    res = command(cmd, sampler)
                except Exception as e:  # noqa: BLE001 — her hata kullanıcıya iletilir
                    res = {"ok": False, "msg": str(e)}
                res.update({"t": "res", "id": cmd.get("id"), "op": cmd.get("op")})
                emit(res)
                if cmd.get("op") == "want":
                    slow_at = {k: 0 for k in slow_at}
                    next_at = time.time()
            continue
        if state["interval"] <= 0:
            continue
        next_at = time.time() + state["interval"]
        try:
            snap = sampler.sample()
            if snap:
                now = time.time()
                if now - slow_at["users"] >= 2:
                    snap["users"] = sessions()
                    slow_at["users"] = now
                emit(snap)
                if "services" in state["want"] and now - slow_at["services"] >= 5:
                    emit({"t": "services", "items": services()})
                    slow_at["services"] = now
                if "startup" in state["want"] and now - slow_at["startup"] >= 10:
                    emit(startup(sampler.sess))
                    slow_at["startup"] = now
        except Exception as e:  # noqa: BLE001 — bir turdaki hata ajanı düşürmesin
            emit({"t": "error", "msg": "ölçüm hatası: %s" % e})


if __name__ == "__main__":
    try:
        main()
    except (BrokenPipeError, KeyboardInterrupt):
        pass
