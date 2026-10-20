"""Toplu dosya dağıtma ve toplama (sağ menü → Dosyalar ▸ Dosyaları dağıt / Dosyaları topla).

Dağıtma: tarayıcıdan yüklenen dosyalar/dizinler (STAGE/u-<jeton>/files) bir kez tar arşivine paketlenir,
her tahtaya tek SSH bağlantısıyla bir kez gönderilir; tahta arşivi geçici dosyaya alıp seçilen her hedef
dizine (kullanıcının Masaüstü'sü vb.) açar ve kopyalananları o kullanıcıya verir.

Toplama: her tahtada seçilen kullanıcıların konum dizinindeki öğeler (isteğe bağlı ad deseniyle süzülür)
`tar -c` ile akıtılır, burada STAGE/c-<iş>/data/<tahta>/<kullanıcı>/ altına açılır (tarfile "data"
süzgeciyle — yol dışına çıkan/aygıt girdileri reddedilir). "Taşı" seçiliyse yalnız buraya sağ salim
alınan öğeler tahtadan silinir. Tarayıcıya teslim: ZIP ya da tar.gz akışı (diske ikinci kopya yazılmaz)
veya tek tek dosya (tarayıcının "klasöre kaydet" kipi).

Paralellik: tahta başına bir iş; aynı anda yürüyen iş sayısı her boşalan yuvada konteynerin işlemci
kotasına, yüküne (loadavg) ve kullanılabilir belleğine göre yeniden hesaplanır (bkz. parallel_limit).
İşler bellekte tutulur (servis yeniden başlarsa durum kaybolur; ara dosyalar açılışta temizlenir).
"""

from __future__ import annotations

import concurrent.futures
import fnmatch
import itertools
import logging
import os
import posixpath
import queue
import re
import secrets
import shutil
import subprocess
import tarfile
import threading
import time
import zipfile

from .remote import RemoteError, check_name, check_path, ssh_command

log = logging.getLogger("tihamon.files.bulk")

STAGE = os.environ.get("FILES_BULK_DIR", "/data/files/bulk")
TTL = int(os.environ.get("FILES_BULK_TTL", "7200"))   # biten işin/yüklemenin ara dosyaları bu kadar saniye tutulur
MAX_PARALLEL = int(os.environ.get("FILES_BULK_MAX_PARALLEL", "16"))
DISK_RESERVE = 1 << 30   # toplamada diskte en az bu kadar boş yer bırakılır
CHUNK = 256 * 1024
KEEP = 20

LOCATIONS = {"desktop": "Masaüstü", "documents": "Belgeler", "downloads": "İndirilenler", "home": "Ev dizini"}

_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=MAX_PARALLEL + 4, thread_name_prefix="bulk")
_ids = itertools.count(1)
jobs: dict[int, dict] = {}
uploads: dict[str, dict] = {}
_reserved = 0
_lock = threading.Lock()


# ---------------------------------------------------------------- kaynak durumuna göre paralellik

def _cpu_quota() -> float:
    try:
        quota, period = open("/sys/fs/cgroup/cpu.max").read().split()
        if quota != "max":
            return max(1.0, int(quota) / int(period))
    except (OSError, ValueError):
        pass
    return float(os.cpu_count() or 1)


def _mem_available() -> int:
    avail = 0
    try:
        for line in open("/proc/meminfo"):
            if line.startswith("MemAvailable:"):
                avail = int(line.split()[1]) * 1024
                break
    except OSError:
        return 512 << 20
    try:  # konteynere bellek sınırı verilmişse onun kalanı da hesaba katılır
        limit = open("/sys/fs/cgroup/memory.max").read().strip()
        if limit != "max":
            used = int(open("/sys/fs/cgroup/memory.current").read())
            avail = min(avail, int(limit) - used)
    except (OSError, ValueError):
        pass
    return avail


def parallel_limit() -> int:
    """Aynı anda yürütülecek tahta işi sayısı: işlemci başına 3 (iş çoğunlukla ağ beklemesi), her iş
    için ~48 MB bellek payı (ssh + sshpass + tar tamponları), 256 MB güvenlik payı; yük işlemci
    sayısını aşmışsa oranla azaltılır. En az 1, en çok MAX_PARALLEL."""
    cpus = _cpu_quota()
    by_mem = (_mem_available() - (256 << 20)) // (48 << 20)
    limit = min(MAX_PARALLEL, int(cpus * 3), int(by_mem))
    try:
        load = os.getloadavg()[0]
        if load > cpus:
            limit = int(limit * cpus / load)
    except OSError:
        pass
    return max(1, limit)


# ---------------------------------------------------------------- tahta betikleri

# Kullanıcılar: insan hesapları (uid 1000–59999, ev dizini var, kabuğu nologin değil). XDG dizinleri
# kullanıcının user-dirs.dirs dosyasından; yoksa Türkçe/İngilizce varsayılan. Son sütun: seat0'da oturumu
# açık mı (greeter "lightdm" sayılmaz; kilitli oturum da açık sayılır).
_USERS = r"""
xdg() {
  v=""
  [ -f "$h/.config/user-dirs.dirs" ] && v=$(sed -n "s/^XDG_$1_DIR=\"\(.*\)\"\$/\1/p" "$h/.config/user-dirs.dirs" | head -n 1)
  case "$v" in
    '$HOME'/*) v="$h/${v#\$HOME/}" ;;
    /*) ;;
    *) v="" ;;
  esac
  if [ -z "$v" ]; then
    v="$h/$2"; [ -d "$v" ] || { [ -d "$h/$3" ] && v="$h/$3"; }
  fi
  printf '%s' "$v"
}
logged=" $(loginctl list-sessions --no-legend 2>/dev/null | awk '$4 == "seat0" && $3 != "lightdm" {printf "%s ", $3}')"
getent passwd | while IFS=: read -r u x uid gid g h s; do
  [ "$uid" -ge 1000 ] 2>/dev/null && [ "$uid" -lt 60000 ] && [ -d "$h" ] || continue
  case "$s" in */nologin|*/false) continue ;; esac
  case "$logged" in *" $u "*) l=1 ;; *) l=0 ;; esac
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$u" "$h" "$(xdg DESKTOP Masaüstü Desktop)" "$(xdg DOCUMENTS Belgeler Documents)" "$(xdg DOWNLOAD İndirilenler Downloads)" "$l"
done
"""

# Dağıtma: stdin'deki arşiv bir kez geçici dosyaya alınır, sonra her "sahip dizin" çiftine açılır.
# Sahip verilmişse (kullanıcı hedefi) dizin yoksa oluşturulup ona verilir; açılan üst düzey öğeler
# dizinin sahibine geçer (dizin root'unsa sahiplik root kalır). Her hedef için tek satır sonuç yazar.
_DISTRIBUTE = r"""
k=$1; shift
t=$(mktemp /tmp/tihamon-dagit-XXXXXX) || exit 3
trap 'rm -f "$t"' EXIT
cat > "$t" || { echo "Arşiv alınamadı (tahtada /tmp dolu olabilir)." >&2; exit 3; }
names=$(tar -tf "$t" | sed 's,/.*,,' | sort -u)
while [ $# -ge 2 ]; do
  o=$1; d=$2; shift 2
  if [ ! -d "$d" ]; then
    if [ -n "$o" ]; then
      e=$(mkdir -p -- "$d" 2>&1 && chown -- "$o:" "$d" 2>&1) || { printf 'ERR\t%s\t%s\n' "$d" "$e"; continue; }
    else
      e=$(mkdir -p -- "$d" 2>&1) || { printf 'ERR\t%s\t%s\n' "$d" "$e"; continue; }
    fi
  fi
  if [ "$k" = skip ]; then
    e=$(tar -xf "$t" -C "$d" --no-same-owner --skip-old-files 2>&1)
  else
    e=$(tar -xf "$t" -C "$d" --no-same-owner --overwrite 2>&1)
  fi
  [ $? -eq 0 ] || { printf 'ERR\t%s\t%s\n' "$d" "$(printf '%s' "$e" | tail -n 1)"; continue; }
  own=$(stat -c '%u:%g' "$d")
  if [ "$own" != "0:0" ]; then
    printf '%s\n' "$names" | while IFS= read -r n; do [ -n "$n" ] && chown -R -- "$own" "$d/$n"; done
  fi
  printf 'OK\t%s\n' "$d"
done
"""

# Toplama 1: verilen dizinlerin üst düzey girdileri ve boyutları ("D\t<dizin>" başlığı, ardından
# "<bayt>\t./<ad>" — hepsi NUL ile ayrılmış). Olmayan dizin "M\t<dizin>".
_LIST = r"""
for d; do
  if [ ! -d "$d" ]; then printf 'M\t%s\0' "$d"; continue; fi
  printf 'D\t%s\0' "$d"
  (cd -- "$d" && find . -mindepth 1 -maxdepth 1 -print0 | xargs -0r du -0sb --)
done
exit 0
"""

# Toplama 2: stdin'deki NUL ayrılmış (köke göre) yolların arşivi.
_PACK = 'exec tar -cf - -C / --null -T -'

# Taşıma: alınan öğeleri sil (stdin NUL ayrılmış mutlak yollar).
_REMOVE = 'xargs -0r rm -rf --'


# ---------------------------------------------------------------- yardımcılar

def _ssh(access: dict, script: str, *args: str, data: bytes | None = None, timeout: float = 120) -> bytes:
    cmd, env = ssh_command(access, script, *args)
    try:
        proc = subprocess.run(cmd, input=data, stdin=None if data is not None else subprocess.DEVNULL,
                              capture_output=True, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RemoteError(f"Zaman aşımı ({int(timeout)} sn).")
    if proc.returncode != 0:
        raise _ssh_error(proc.returncode, proc.stderr.decode("utf-8", "replace"))
    return proc.stdout


def _ssh_error(rc: int, err: str) -> RemoteError:
    if rc == 5:
        return RemoteError("SSH parolası reddedildi.")
    if rc == 255:
        return RemoteError("Tahtaya SSH ile ulaşılamadı.")
    lines = [line for line in err.strip().splitlines() if line.strip()]
    return RemoteError(lines[-1][:300] if lines else f"İşlem başarısız (çıkış {rc}).")


def board_users(access: dict) -> list[dict]:
    out = _ssh(access, _USERS, timeout=40).decode("utf-8", "replace")
    users = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) == 6:
            users.append({"name": parts[0], "home": parts[1], "desktop": parts[2], "documents": parts[3],
                          "downloads": parts[4], "logged": parts[5] == "1"})
    return users


def check_rel(path: str) -> str:
    """Göreli alt yol (ör. "Masaüstü/Ödevler" ya da yüklenen dosyanın "klasör/dosya.pdf" yolu)."""
    if not isinstance(path, str):
        raise RemoteError("Geçersiz yol.")
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    if not parts or len(path) > 4000 or any("\n" in p for p in parts):
        raise RemoteError("Geçersiz yol.")
    return "/".join(check_name(p) for p in parts)


def check_location(loc) -> dict:
    if not isinstance(loc, dict):
        raise RemoteError("Konum seçilmedi.")
    kind = loc.get("kind")
    if kind in LOCATIONS:
        return {"kind": kind}
    if kind == "sub":
        return {"kind": kind, "path": check_rel(loc.get("path") or "")}
    if kind == "abs":
        path = check_path(loc.get("path") or "")
        if path == "/":
            raise RemoteError("Kök dizin seçilemez.")
        return {"kind": kind, "path": path}
    raise RemoteError("Geçersiz konum.")


def location_text(loc: dict) -> str:
    if loc["kind"] in LOCATIONS:
        return LOCATIONS[loc["kind"]]
    return ("~/" if loc["kind"] == "sub" else "") + loc["path"]


def check_selection(sel) -> dict:
    if not isinstance(sel, dict):
        raise RemoteError("Kullanıcı seçilmedi.")
    names = sel.get("names") or []
    if not isinstance(names, list) or len(names) > 500:
        raise RemoteError("Geçersiz kullanıcı seçimi.")
    names = [check_name(n) for n in names]
    logged = bool(sel.get("logged"))
    return {"logged": logged, "names": names}


def _targets(users: list[dict], sel: dict, loc: dict) -> list[dict]:
    """Bir tahtadaki hedefler: [{user, owner, dir}]. Mutlak yolda kullanıcıdan bağımsız tek hedef."""
    if loc["kind"] == "abs":
        return [{"user": "", "owner": "", "dir": loc["path"]}]
    out = []
    for u in users:
        if not ((sel["logged"] and u["logged"]) or u["name"] in sel["names"]):
            continue
        if loc["kind"] == "home":
            d = u["home"]
        elif loc["kind"] == "sub":
            d = posixpath.join(u["home"], loc["path"])
        else:
            d = u[loc["kind"]]
        out.append({"user": u["name"], "owner": u["name"], "dir": d})
    return out


def _event(job: dict, level: str, text: str) -> None:
    job["events"].append({"t": time.time(), "level": level, "text": text})
    if len(job["events"]) > 1000:
        del job["events"][:200]


def public(job: dict) -> dict:
    out = {k: v for k, v in job.items() if not k.startswith("_")}
    out["bytes"] = sum(b["bytes"] for b in job["boards"])
    out["total"] = sum(b["total"] for b in job["boards"])
    return out


def _safe_dirname(text: str) -> str:
    text = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", text).strip(" .")
    return text[:120] or "_"


def _rmtree(path: str) -> None:
    shutil.rmtree(path, ignore_errors=True)
    try:
        os.unlink(path)
    except OSError:
        pass


def cleanup(startup: bool = False) -> None:
    """Süresi dolan (ya da açılışta: hepsi — bellekteki durum kayboldu) ara dosyaları siler."""
    now = time.time()
    if startup:
        if os.path.isdir(STAGE):
            for name in os.listdir(STAGE):
                _rmtree(os.path.join(STAGE, name))
        return
    for token, up in list(uploads.items()):
        if not up.get("job") and now - up["created"] > TTL:
            _rmtree(up["dir"])
            uploads.pop(token, None)
    for job_id, job in list(jobs.items()):
        if job["state"] != "running" and job["finished"] and now - job["finished"] > TTL:
            _rmtree(job["_dir"])
            job["delivered"] = None
    finished = [j for j in sorted(jobs) if jobs[j]["state"] != "running"]
    for job_id in finished[:-KEEP]:
        _rmtree(jobs[job_id]["_dir"])
        jobs.pop(job_id, None)


# ---------------------------------------------------------------- yükleme (dağıtma kaynağı)

def new_upload(owner: str) -> str:
    cleanup()
    token = secrets.token_hex(12)
    path = os.path.join(STAGE, "u-" + token)
    os.makedirs(os.path.join(path, "files"), mode=0o700)
    uploads[token] = {"owner": owner, "dir": path, "created": time.time(), "job": None, "bytes": 0}
    return token


def upload_file(token: str, owner: str, rel: str) -> str:
    """Yüklenen dosyanın yazılacağı yerel yol (dizinleri oluşturulmuş)."""
    up = uploads.get(token)
    if not up or up["owner"] != owner or up["job"]:
        raise RemoteError("Yükleme oturumu bulunamadı ya da süresi doldu.")
    rel = check_rel(rel)
    path = os.path.join(up["dir"], "files", rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if shutil.disk_usage(STAGE).free < DISK_RESERVE:
        raise RemoteError("Sunucuda yeterli boş disk alanı yok.")
    return path


def _pack_upload(up: dict) -> tuple[str, list[str]]:
    """Yüklenenleri tek arşivde toplar (sahip root, izinler korunur). (arşiv yolu, üst düzey adlar)."""
    src = os.path.join(up["dir"], "files")
    names = sorted(os.listdir(src))
    if not names:
        raise RemoteError("Dağıtılacak dosya yüklenmedi.")
    archive = os.path.join(up["dir"], "files.tar")

    def owner_root(info: tarfile.TarInfo) -> tarfile.TarInfo:
        info.uid = info.gid = 0
        info.uname = info.gname = "root"
        if info.isfile():
            info.mode = 0o644 | (info.mode & 0o111)
        elif info.isdir():
            info.mode = 0o755
        return info

    with tarfile.open(archive, "w", format=tarfile.GNU_FORMAT) as tar:
        for name in names:
            tar.add(os.path.join(src, name), arcname=name, filter=owner_root)
    return archive, names


# ---------------------------------------------------------------- iş yürütme

def _new_job(kind: str, owner: str, boards: list[dict], options: dict) -> dict:
    job_id = next(_ids)
    path = os.path.join(STAGE, f"{kind[0]}-{job_id}-{secrets.token_hex(4)}")
    os.makedirs(path, mode=0o700, exist_ok=True)
    job = {
        "id": job_id, "kind": kind, "owner": owner, "state": "running", "started": time.time(),
        "finished": None, "limit": 0, "running": 0, "options": options, "events": [], "delivered": None,
        "boards": [{"id": b["id"], "name": b["name"], "state": "queued", "message": "Sırada", "bytes": 0,
                    "total": 0, "targets": []} for b in boards],
        "_access": {b["id"]: b for b in boards}, "_dir": path, "_cancel": False, "_procs": set(),
    }
    jobs[job_id] = job
    return job


def cancel(job_id: int, owner: str) -> bool:
    job = jobs.get(job_id)
    if not job or job["owner"] != owner or job["state"] != "running":
        return False
    job["_cancel"] = True
    for proc in list(job["_procs"]):
        if proc.poll() is None:
            proc.kill()
    _event(job, "warn", "İptal istendi; yürüyen aktarımlar durduruluyor.")
    return True


def get(job_id: int, owner: str) -> dict | None:
    job = jobs.get(job_id)
    return job if job and job["owner"] == owner else None


async def _schedule(job: dict, work, on_done) -> None:
    """Tahta işlerini kaynak durumuna göre değişen bir sınırla paralel yürütür."""
    import asyncio
    loop = asyncio.get_running_loop()
    pending = list(job["boards"])
    running: set = set()
    try:
        while pending or running:
            job["limit"] = parallel_limit()
            while pending and len(running) < job["limit"] and not job["_cancel"]:
                row = pending.pop(0)
                row["state"] = "running"
                row["message"] = "Başladı"
                running.add(loop.run_in_executor(_POOL, _guard, job, row, work))
            job["running"] = len(running)
            if job["_cancel"]:
                for row in pending:
                    row["state"] = "cancelled"
                    row["message"] = "İptal edildi (başlamadan)"
                pending = []
            if running:
                _, running = await asyncio.wait(running, timeout=1, return_when=asyncio.FIRST_COMPLETED)
        failed = sum(1 for b in job["boards"] if b["state"] == "failed")
        partial = sum(1 for b in job["boards"] if b["state"] == "partial")
        if job["_cancel"]:
            job["state"] = "cancelled"
        else:
            job["state"] = "done" if not failed and not partial else "partial"
        _event(job, "info" if job["state"] == "done" else "warn", _summary(job))
    except Exception:
        log.exception("toplu iş #%s", job["id"])
        job["state"] = "failed"
        _event(job, "error", "Beklenmeyen hata; ayrıntı servis günlüğünde.")
    finally:
        job["running"] = 0
        job["finished"] = time.time()
        global _reserved
        with _lock:
            _reserved -= job.pop("_reserve", 0)
        try:
            await asyncio.to_thread(on_done, public(job))
        except Exception:
            log.exception("toplu iş kaydı yazılamadı")


def _summary(job: dict) -> str:
    counts = {}
    for b in job["boards"]:
        counts[b["state"]] = counts.get(b["state"], 0) + 1
    names = {"done": "başarılı", "partial": "kısmen", "failed": "başarısız", "skipped": "atlandı",
             "cancelled": "iptal"}
    parts = [f"{counts[s]} {names[s]}" for s in names if counts.get(s)]
    verb = "Dağıtma" if job["kind"] == "distribute" else "Toplama"
    return f"{verb} bitti: {len(job['boards'])} tahta — " + ", ".join(parts) + "."


def _guard(job: dict, row: dict, work) -> None:
    try:
        _work(job, row, work)
    finally:
        for t in row["targets"]:
            if t["state"] in ("queued", "running"):
                t["state"] = "cancelled" if job["_cancel"] else "failed"
                t["message"] = t["message"] or row["message"]


def _work(job: dict, row: dict, work) -> None:
    try:
        work(job, row, job["_access"][row["id"]])
    except RemoteError as exc:
        if job["_cancel"]:
            row["state"], row["message"] = "cancelled", "İptal edildi"
        else:
            row["state"], row["message"] = "failed", str(exc)
            _event(job, "error", f"{row['name']}: {exc}")
    except Exception as exc:
        log.exception("toplu iş #%s tahta %s", job["id"], row["id"])
        row["state"], row["message"] = "failed", f"Beklenmeyen hata: {exc}"[:300]
        _event(job, "error", f"{row['name']}: {row['message']}")


def _finish_row(job: dict, row: dict, noun: str) -> None:
    ok = sum(1 for t in row["targets"] if t["state"] == "ok")
    bad = sum(1 for t in row["targets"] if t["state"] == "failed")
    if job["_cancel"] and row["state"] == "running":
        row["state"], row["message"] = "cancelled", "İptal edildi"
    elif bad and ok:
        row["state"], row["message"] = "partial", f"{ok} {noun} tamam, {bad} hata"
    elif bad:
        row["state"], row["message"] = "failed", f"{bad} {noun} hata"
    else:
        row["state"], row["message"] = "done", f"{ok} {noun} tamam"
    _event(job, {"done": "info", "partial": "warn"}.get(row["state"], "error"), f"{row['name']}: {row['message']}")


def _resolve(job: dict, row: dict, access: dict) -> list[dict] | None:
    opts = job["options"]
    row["message"] = "Kullanıcılar okunuyor…"
    users = board_users(access) if opts["location"]["kind"] != "abs" else []
    targets = _targets(users, opts["users"], opts["location"])
    if not targets:
        why = ("oturumu açık kullanıcı yok" if opts["users"]["logged"] and not opts["users"]["names"]
               else "seçilen kullanıcılar bu tahtada yok ya da oturumu açık değil")
        row["state"], row["message"] = "skipped", "Atlandı: " + why
        _event(job, "info", f"{row['name']}: atlandı — {why}.")
        return None
    row["targets"] = [{"user": t["user"], "dir": t["dir"], "state": "queued", "message": "", "bytes": 0,
                       "items": 0} for t in targets]
    return targets


def _popen(job: dict, cmd: list[str], env: dict, stdin) -> subprocess.Popen:
    proc = subprocess.Popen(cmd, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    job["_procs"].add(proc)
    return proc


# ---- dağıtma

def prepare_distribute(owner: str, token: str) -> dict:
    """Yüklemeyi arşive paketler (iş parçacığında çağrılır — büyük yüklemede saniyeler sürebilir)."""
    up = uploads.get(token)
    if not up or up["owner"] != owner or up["job"]:
        raise RemoteError("Yükleme bulunamadı ya da süresi doldu; dosyaları yeniden seçin.")
    up["job"] = "packing"
    try:
        archive, names = _pack_upload(up)
    except Exception:
        up["job"] = None
        raise
    return {"token": token, "archive": archive, "names": names}


def start_distribute(owner: str, prepared: dict, boards: list[dict], users: dict, location: dict,
                     conflict: str, on_done) -> int:
    import asyncio
    if not boards:
        raise RemoteError("Tahta seçilmedi.")
    up = uploads.pop(prepared["token"], None)
    names = prepared["names"]
    options = {"users": users, "location": location, "location_text": location_text(location),
               "conflict": "skip" if conflict == "skip" else "overwrite", "names": names,
               "size": os.path.getsize(prepared["archive"])}
    job = _new_job("distribute", owner, boards, options)
    os.replace(prepared["archive"], os.path.join(job["_dir"], "files.tar"))
    if up:
        _rmtree(up["dir"])
    _event(job, "info", f"{len(names)} öğe {len(boards)} tahtaya dağıtılıyor; konum: {options['location_text']}"
                        + (", var olanlar atlanır." if options["conflict"] == "skip" else ", aynı adlıların üzerine yazılır."))
    asyncio.ensure_future(_schedule(job, _distribute_board, on_done))
    return job["id"]


def _distribute_board(job: dict, row: dict, access: dict) -> None:
    targets = _resolve(job, row, access)
    if targets is None or job["_cancel"]:
        return
    archive = os.path.join(job["_dir"], "files.tar")
    row["total"] = os.path.getsize(archive)
    row["message"] = f"Gönderiliyor ({len(targets)} hedef)…"
    for t in row["targets"]:
        t["state"] = "running"
    args = [job["options"]["conflict"]]
    for t in targets:
        args += [t["owner"], t["dir"]]
    cmd, env = ssh_command(access, _DISTRIBUTE, *args)
    proc = _popen(job, cmd, env, subprocess.PIPE)
    try:
        with open(archive, "rb") as fh:
            while not job["_cancel"]:
                chunk = fh.read(CHUNK)
                if not chunk:
                    break
                proc.stdin.write(chunk)
                row["bytes"] += len(chunk)
        proc.stdin.close()
    except (BrokenPipeError, ConnectionResetError, ValueError):
        pass
    proc.stdin = None   # kapatıldı; communicate() yeniden flush etmeye çalışmasın
    out, err = proc.communicate(timeout=600)
    job["_procs"].discard(proc)
    if job["_cancel"]:
        raise RemoteError("İptal edildi.")
    results = {}
    for line in out.decode("utf-8", "replace").splitlines():
        parts = line.split("\t", 2)
        if len(parts) >= 2 and parts[0] in ("OK", "ERR"):
            results[parts[1]] = (parts[0] == "OK", parts[2] if len(parts) > 2 else "")
    if proc.returncode != 0 and not results:
        raise _ssh_error(proc.returncode, err.decode("utf-8", "replace"))
    for t in row["targets"]:
        ok, msg = results.get(t["dir"], (False, "Sonuç alınamadı."))
        t["state"], t["message"] = ("ok", "Kopyalandı") if ok else ("failed", msg or "Hata")
        t["bytes"] = row["total"] if ok else 0
        t["items"] = len(job["options"]["names"]) if ok else 0
        if not ok:
            _event(job, "error", f"{row['name']}: {t['user'] or t['dir']} — {t['message']}")
    _finish_row(job, row, "hedef")


# ---- toplama

def start_collect(owner: str, boards: list[dict], users: dict, location: dict, patterns: list[str],
                  move: bool, on_done) -> int:
    import asyncio
    if not boards:
        raise RemoteError("Tahta seçilmedi.")
    patterns = [p.strip() for p in patterns if isinstance(p, str) and p.strip()][:50]
    options = {"users": users, "location": location, "location_text": location_text(location),
               "patterns": patterns, "move": bool(move)}
    job = _new_job("collect", owner, boards, options)
    os.makedirs(os.path.join(job["_dir"], "data"), exist_ok=True)
    _event(job, "info", f"{len(boards)} tahtadan toplanıyor; konum: {options['location_text']}"
                        + (f", desen: {' '.join(patterns)}" if patterns else "")
                        + (" — TAŞIMA: alınan öğeler tahtadan silinecek." if move else "."))
    asyncio.ensure_future(_schedule(job, _collect_board, on_done))
    return job["id"]


def _match(name: str, patterns: list[str]) -> bool:
    return not patterns or any(fnmatch.fnmatch(name.lower(), p.lower()) for p in patterns)


def _collect_board(job: dict, row: dict, access: dict) -> None:
    global _reserved
    targets = _resolve(job, row, access)
    if targets is None or job["_cancel"]:
        return
    row["message"] = "Öğeler listeleniyor…"
    out = _ssh(access, _LIST, *[t["dir"] for t in targets], timeout=300)
    listing: dict[str, list[tuple[str, int]]] = {}
    current = None
    for rec in out.split(b"\0"):
        text = rec.decode("utf-8", "replace")
        if text.startswith("D\t"):
            current = text[2:]
            listing[current] = []
        elif text.startswith("M\t"):
            listing[text[2:]] = None
            current = None
        elif current is not None and "\t./" in text:
            size, name = text.split("\t./", 1)
            if "/" not in name and _match(name, job["options"]["patterns"]):
                listing[current].append((name, int(size) if size.isdigit() else 0))
    paths: list[str] = []
    for t in row["targets"]:
        entries = listing.get(t["dir"])
        if entries is None:
            t["state"], t["message"] = "skipped", "Dizin yok"
            continue
        if not entries:
            t["state"], t["message"] = "skipped", "Eşleşen öğe yok"
            continue
        t["items"] = len(entries)
        t["total"] = sum(s for _, s in entries)
        t["_paths"] = [posixpath.join(t["dir"], n) for n, _ in entries]
        paths += t["_paths"]
        row["total"] += t["total"]
    if not paths:
        row["state"], row["message"] = "skipped", "Atlandı: alınacak öğe yok"
        _event(job, "info", f"{row['name']}: alınacak öğe yok.")
        return
    with _lock:
        free = shutil.disk_usage(STAGE).free - DISK_RESERVE - _reserved
        if row["total"] > free:
            raise RemoteError(f"Sunucuda yer yok: {row['total'] >> 20} MB gerekli, {max(0, free) >> 20} MB boş.")
        _reserved += row["total"]
        job["_reserve"] = job.get("_reserve", 0) + row["total"]
    for t in row["targets"]:
        if t.get("_paths"):
            t["state"] = "running"
    row["message"] = f"Alınıyor ({len(paths)} öğe)…"
    dest = os.path.join(job["_dir"], "data", _safe_dirname(row["name"]) + f" #{row['id']}")
    prefixes = []
    for t in row["targets"]:
        if t.get("_paths"):
            sub = _safe_dirname(t["user"]) if t["user"] else _safe_dirname(posixpath.basename(t["dir"]) or "kok")
            prefixes.append((t["dir"].lstrip("/") + "/", sub, t))
    prefixes.sort(key=lambda p: -len(p[0]))
    cmd, env = ssh_command(access, _PACK)
    proc = _popen(job, cmd, env, subprocess.PIPE)
    listed = b"".join(p.lstrip("/").encode() + b"\0" for p in paths)
    feeder = threading.Thread(target=_feed, args=(proc, listed), daemon=True)
    feeder.start()
    errors: list[str] = []
    try:
        with tarfile.open(fileobj=_Counter(proc.stdout, row, job), mode="r|") as tar:
            for member in tar:
                name = member.name.lstrip("/")
                for prefix, sub, t in prefixes:
                    if name.startswith(prefix) or name + "/" == prefix:
                        rest = name[len(prefix):] if name.startswith(prefix) else ""
                        member.name = posixpath.join(sub, rest) if rest else sub
                        break
                else:
                    continue
                try:
                    tar.extract(member, dest, filter="data", set_attrs=True)
                except (tarfile.FilterError, OSError) as exc:
                    errors.append(f"{name}: {exc}")
    except (tarfile.TarError, OSError) as exc:
        if not job["_cancel"]:
            errors.append(f"Arşiv akışı bozuldu: {exc}")
    proc.wait(timeout=120)
    err = proc.stderr.read().decode("utf-8", "replace")
    job["_procs"].discard(proc)
    if job["_cancel"]:
        raise RemoteError("İptal edildi.")
    # GNU tar okunamayan bir dosyada 2 ile biter ama okunabilenleri yine akıtır: o öğeler hata sayılır.
    failed_paths = set()
    if proc.returncode not in (0, None):
        for line in err.splitlines():
            m = re.match(r"tar: (/?[^:]+): ", line)
            if m:
                failed_paths.add("/" + m.group(1).lstrip("/"))
            if line.strip():
                errors.append(line.strip())
        if proc.returncode not in (1, 2):
            raise _ssh_error(proc.returncode, err)
    for t in row["targets"]:
        if not t.get("_paths"):
            continue
        bad = [p for p in t["_paths"] if any(p == f or f.startswith(p + "/") for f in failed_paths)]
        t["state"], t["message"] = ("failed", f"{len(bad)} öğe alınamadı") if bad else ("ok", "Alındı")
        t["bytes"] = t["total"]
        t["_ok_paths"] = [p for p in t["_paths"] if p not in bad]
    for line in errors[:20]:
        _event(job, "warn", f"{row['name']}: {line[:300]}")
    if job["options"]["move"] and not job["_cancel"]:
        remove = [p for t in row["targets"] for p in t.get("_ok_paths", [])]
        if remove:
            row["message"] = "Kaynaklar siliniyor (taşıma)…"
            try:
                _ssh(access, _REMOVE, data=b"".join(p.encode() + b"\0" for p in remove), timeout=300)
                for t in row["targets"]:
                    if t.get("_ok_paths"):
                        t["message"] = "Taşındı"
            except RemoteError as exc:
                _event(job, "error", f"{row['name']}: alındı ama tahtadan silinemedi — {exc}")
                for t in row["targets"]:
                    if t.get("_ok_paths"):
                        t["message"] = "Alındı (silinemedi)"
    row["bytes"] = max(row["bytes"], row["total"])
    for t in row["targets"]:
        for key in ("_paths", "_ok_paths"):
            t.pop(key, None)
    _finish_row(job, row, "kullanıcı" if job["options"]["location"]["kind"] != "abs" else "dizin")


def _feed(proc: subprocess.Popen, data: bytes) -> None:
    try:
        proc.stdin.write(data)
        proc.stdin.close()
    except (BrokenPipeError, ValueError, OSError):
        pass


class _Counter:
    """Okunan baytları tahta satırına ekleyen, iptalde akışı kesen okuyucu."""

    def __init__(self, raw, row: dict, job: dict):
        self.raw, self.row, self.job = raw, row, job

    def read(self, size: int = -1) -> bytes:
        if self.job["_cancel"]:
            raise OSError("iptal")
        data = self.raw.read(size)
        self.row["bytes"] += len(data)
        return data


# ---------------------------------------------------------------- teslim (toplanan → tarayıcı)

def manifest(job: dict) -> list[dict]:
    root = os.path.join(job["_dir"], "data")
    files = []
    for base, dirs, names in os.walk(root):
        dirs.sort()
        for name in sorted(names):
            path = os.path.join(base, name)
            if os.path.isfile(path) and not os.path.islink(path):
                files.append({"path": os.path.relpath(path, root), "size": os.path.getsize(path)})
    return files


def local_file(job: dict, rel: str) -> str:
    root = os.path.realpath(os.path.join(job["_dir"], "data"))
    path = os.path.realpath(os.path.join(root, check_rel(rel)))
    if not path.startswith(root + "/") or not os.path.isfile(path):
        raise RemoteError("Dosya bulunamadı.")
    return path


class _QueueWriter:
    """zipfile/tarfile'ın yazdığını sınırlı kuyruğa parça parça aktarır (akış; geri basınçlı)."""

    def __init__(self, q: queue.Queue, stop: threading.Event):
        self.q, self.stop, self.buf, self.pos = q, stop, bytearray(), 0

    def write(self, data) -> int:
        if self.stop.is_set():
            raise OSError("istemci bağlantıyı kapattı")
        self.buf += data
        self.pos += len(data)
        if len(self.buf) >= CHUNK:
            self._put(bytes(self.buf))
            self.buf.clear()
        return len(data)

    def tell(self) -> int:
        return self.pos

    def flush(self) -> None:
        pass

    def _put(self, data: bytes) -> None:
        while not self.stop.is_set():
            try:
                self.q.put(data, timeout=1)
                return
            except queue.Full:
                continue
        raise OSError("istemci bağlantıyı kapattı")

    def close(self) -> None:
        if self.buf:
            self._put(bytes(self.buf))
            self.buf.clear()


def archive_producer(job: dict, fmt: str, q: queue.Queue, stop: threading.Event) -> None:
    """Toplananları ZIP (deflate, düşük sıkıştırma — işlemci tasarrufu) ya da tar.gz olarak akıtır.
    Bitişte kuyruğa None, hatada istisna nesnesi konur."""
    root = os.path.join(job["_dir"], "data")
    out = _QueueWriter(q, stop)
    try:
        if fmt == "zip":
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as zf:
                for base, dirs, names in os.walk(root):
                    dirs.sort()
                    rel_base = os.path.relpath(base, root)
                    if rel_base != "." and not names and not dirs:
                        zf.writestr(rel_base + "/", b"")
                    for name in sorted(names):
                        path = os.path.join(base, name)
                        if os.path.isfile(path) and not os.path.islink(path):
                            zf.write(path, os.path.relpath(path, root))
        else:
            with tarfile.open(fileobj=out, mode="w|gz", compresslevel=1) as tar:
                for name in sorted(os.listdir(root)):
                    tar.add(os.path.join(root, name), arcname=name)
        out.close()
        q.put(None)
    except Exception as exc:  # istemci koptu ya da disk hatası: tüketiciye bildir
        if not stop.is_set():
            log.exception("arşiv akışı #%s", job["id"])
        try:
            q.put(exc, timeout=1)
        except queue.Full:
            pass


def discard(job: dict) -> None:
    """Toplanan verileri siler (pencere kapatıldı / teslim tamamlandı)."""
    if job["state"] != "running":
        _rmtree(job["_dir"])
        job["delivered"] = None
        job["discarded"] = True
