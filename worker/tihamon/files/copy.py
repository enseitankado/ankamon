"""Tahtadan tahtaya (ya da aynı tahtada) dosya/dizin kopyalama, ilerlemeli.

Kaynak tahtada `tar -c` ile seçilen öğeler akıtılır, hedef tahtada `tar -x` ile açılır; baytlar bu
süreçten geçer (iki SSH borusu arasında), sayılarak ilerleme hesaplanır. Toplam önceden kaynakta
`du -sb` ile ölçülür. Arşiv akışı başlık/dolgu içerdiğinden sayaç toplamı biraz aşabilir; iş bitene
dek ilerleme %99'da tutulur.

Sahiplik: hedef dizin root'a aitse (ör. /home'a bir ev dizini kopyalanıyorsa) özgün sahip/grup korunur
(sayısal; ETAP imajlarında hesapların uid'leri aynıdır). Değilse (ör. /home/ali/Masaüstü) kopyalanan her
şey hedef dizinin sahibine verilir — ali'nin dizinine kopyalanan dosyaları ali açabilsin. İzinler korunur.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import posixpath
import time

from .remote import RemoteError, check_name, check_path, run, ssh_command

log = logging.getLogger("tihamon.files.copy")

CHUNK = 256 * 1024
KEEP = 30  # bellekte tutulan son kopyalama durumu sayısı

_SIZE = 'cd -- "$1" || exit 3; shift; du -sbc -- "$@" | tail -n 1 | cut -f 1'
_PACK = 'cd -- "$1" || exit 3; shift; exec tar -cf - -- "$@"'
_UNPACK = r"""
d=$1; shift
cd -- "$d" || { echo "Hedef dizin açılamadı: $d" >&2; exit 3; }
o=$(stat -c '%u:%g' .)
if [ "$o" = "0:0" ]; then
  tar -xpf - --same-owner --numeric-owner
else
  tar -xpf - --no-same-owner && chown -R -- "$o" "$@"
fi
"""

_ids = itertools.count(1)
jobs: dict[int, dict] = {}


def _prune() -> None:
    for job_id in sorted(jobs)[:-KEEP]:
        if jobs[job_id]["state"] != "running":
            jobs.pop(job_id, None)


def start(src: dict, src_dir: str, names: list[str], dst: dict, dst_dir: str, on_done) -> int:
    """Kopyalamayı arka planda başlatır, iş numarası döner. src/dst: {id, name, ip, user, password}.
    on_done(job) iş bittiğinde (başarılı/başarısız/iptal) çağrılır (kayıt için)."""
    src_dir = check_path(src_dir)
    dst_dir = check_path(dst_dir)
    names = [check_name(n) for n in names]
    if not names:
        raise RemoteError("Kopyalanacak öğe seçilmedi.")
    if src["id"] == dst["id"]:
        if src_dir == dst_dir:
            raise RemoteError("Kaynak ve hedef dizin aynı.")
        for n in names:
            inner = posixpath.join(src_dir, n)
            if dst_dir == inner or dst_dir.startswith(inner + "/"):
                raise RemoteError(f"Bir klasör kendi içine kopyalanamaz: {n}")
    job_id = next(_ids)
    job = {
        "id": job_id, "state": "running", "bytes": 0, "total": 0, "message": "Boyut hesaplanıyor…",
        "started": time.time(), "finished": None, "names": names,
        "src": {"id": src["id"], "name": src["name"], "dir": src_dir},
        "dst": {"id": dst["id"], "name": dst["name"], "dir": dst_dir},
        "_procs": [], "_cancel": False,
    }
    jobs[job_id] = job
    _prune()
    asyncio.ensure_future(_run(job, src, dst, on_done))
    return job_id


def cancel(job_id: int) -> bool:
    job = jobs.get(job_id)
    if not job or job["state"] != "running":
        return False
    job["_cancel"] = True
    for proc in job["_procs"]:
        if proc.returncode is None:
            proc.kill()
    return True


def public(job: dict) -> dict:
    return {k: v for k, v in job.items() if not k.startswith("_")}


async def _run(job: dict, src: dict, dst: dict, on_done) -> None:
    try:
        total = await run(src, _SIZE, job["src"]["dir"], *job["names"], timeout=120)
        job["total"] = int(total.decode().strip() or 0)
        job["message"] = "Kopyalanıyor…"
        await _relay(job, src, dst)
        if job["_cancel"]:
            raise RemoteError("İptal edildi.")
        job["state"] = "done"
        job["bytes"] = max(job["bytes"], job["total"])
        job["message"] = "Tamamlandı."
    except RemoteError as exc:
        job["state"] = "cancelled" if job["_cancel"] else "failed"
        job["message"] = str(exc)
    except Exception as exc:  # beklenmeyen: günlüğe yaz, kullanıcıya kısa ileti
        log.exception("kopyalama #%s", job["id"])
        job["state"] = "failed"
        job["message"] = f"Beklenmeyen hata: {exc}"[:300]
    finally:
        job["finished"] = time.time()
        job["_procs"] = []
        try:
            await asyncio.to_thread(on_done, public(job))
        except Exception:
            log.exception("kopyalama kaydı yazılamadı")


async def _relay(job: dict, src: dict, dst: dict) -> None:
    cmd_out, env_out = ssh_command(src, _PACK, job["src"]["dir"], *job["names"])
    cmd_in, env_in = ssh_command(dst, _UNPACK, job["dst"]["dir"], *job["names"])
    reader = await asyncio.create_subprocess_exec(
        *cmd_out, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, env=env_out)
    writer = await asyncio.create_subprocess_exec(
        *cmd_in, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE, env=env_in)
    job["_procs"] = [reader, writer]
    try:
        while True:
            chunk = await reader.stdout.read(CHUNK)
            if not chunk:
                break
            writer.stdin.write(chunk)
            await writer.stdin.drain()
            job["bytes"] += len(chunk)
    except (BrokenPipeError, ConnectionResetError):
        pass  # hedef erken kapandı: aşağıda çıkış kodundan anlaşılır
    finally:
        if writer.stdin and not writer.stdin.is_closing():
            writer.stdin.close()
    rc_out = await reader.wait()
    rc_in = await writer.wait()
    err_out = (await reader.stderr.read()).decode("utf-8", "replace")
    err_in = (await writer.stderr.read()).decode("utf-8", "replace")
    if job["_cancel"]:
        return
    if rc_in != 0:
        raise _fail("Hedef", rc_in, err_in)
    if rc_out != 0:
        raise _fail("Kaynak", rc_out, err_out)


def _fail(side: str, rc: int, err: str) -> RemoteError:
    if rc == 255:
        return RemoteError(f"{side} tahtaya SSH ile ulaşılamadı.")
    lines = [line for line in err.strip().splitlines() if line.strip()]
    return RemoteError(f"{side}: " + (lines[-1][:250] if lines else f"çıkış {rc}"))
