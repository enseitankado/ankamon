"""Tahtalara taşınan dış araçlar (ör. eta-112): sunucuda önbellek + günlük sürüm denetimi + SFTP ile kopyalama.

Bir hazır işlem action.json'da "tools": ["eta-112"] derse runner işlemden ÖNCE:
  1. ensure(): aracın sunucudaki kopyasını hazırlar (/data/tools/<ad>/). Günün ilk kullanımında
     (TOOLS'ta "check_every_run" ise her kullanımda) GitHub'da yeni sürüm (son commit) var mı bakar,
     varsa indirir. Tahta her seferinde internetten
     indirmez — kopya ana makinede durur.
  2. upload(): her tahtada uzak kopyanın sha256'sını karşılaştırır; farklıysa (ya da yoksa) SSH
     üzerinden SFTP ile kopyalar (geçici ad → atomik yeniden adlandırma), aynıysa atlar.
Her adım görev olayına yazılır (kullanıcı canlı çıktı penceresinde görür).

GitHub erişimi: MEB filtresi github.com / api.github.com / raw.githubusercontent.com HTTPS'ini kendi
sertifikasıyla (CN=MEB-CERT-ACI) kesiyor. İndirme api.github.com üzerinden yapılır ve TLS doğrulamasına
sistem CA'larına EK olarak yalnız bu bağlantıda MEB kök sertifikası eklenir (bkz. MEB_CA) — konteynerin
genel güven deposuna eklenmez. GitHub'a ulaşılamazsa sunucudaki son kopya kullanılır (uyarıyla).
"""

from __future__ import annotations

import ast
import base64
import datetime as _dt
import hashlib
import json
import os
import ssl
import subprocess
import urllib.request

BASE_DIR = "/data/tools"
MEB_CA = "/opt/tiha-mon/certs/meb-ca.crt"
_HTTP_TIMEOUT = 20

# ad → kaynak depo, taşınacak dosya ve tahtadaki yeri. remote_dir: tahtada kalıcı, yerel olarak
# yönetilen yazılımlar için FHS'nin öngördüğü /opt/<paket> (aracın kendi başlatıcısı baslat.sh her
# çalıştırmada /tmp'ye geçici kopya açar; biz kalıcı tutup yalnız sürüm değişince yeniden kopyalarız).
TOOLS = {
    "eta-112": {
        "title": "ETA-112",
        "repo": "enseitankado/eta-112",
        "branch": "main",
        "file": "eta-112.py",
        "remote_dir": "/opt/eta-112",
    },
    # Ahenk kayıt/bağlantı teşhis aracı (hazır işlem "Ahenk kontrol", actions/ahenk-check). Sık güncellendiği
    # için GitHub'daki son commit HER çalıştırmada denetlenir (tek küçük API isteği); dosya yalnız commit
    # değişince indirilir, tahtaya da yalnız sha256 farklıysa kopyalanır.
    "ahenk-debug": {
        "title": "ahenk-debug",
        "repo": "enseitankado/ahenk-debug",
        "branch": "main",
        "file": "ahenk_debug.py",
        "remote_dir": "/opt/ahenk-debug",
        "check_every_run": True,
    },
}

_SSH_OPTS = [
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "ConnectTimeout=10", "-o", "PubkeyAuthentication=no",
    "-o", "PreferredAuthentications=password,keyboard-interactive",
]


class ToolError(RuntimeError):
    pass


def remote_path(name: str) -> str:
    t = TOOLS[name]
    return f"{t['remote_dir']}/{t['file']}"


def _local_dir(name: str) -> str:
    return os.path.join(BASE_DIR, name)


def _state(name: str) -> dict:
    try:
        with open(os.path.join(_local_dir(name), "state.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_state(name: str, state: dict) -> None:
    path = os.path.join(_local_dir(name), "state.json")
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(path + ".tmp", path)


def _ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if os.path.exists(MEB_CA):
        ctx.load_verify_locations(MEB_CA)
    return ctx


def _api(path: str, accept: str = "application/vnd.github+json") -> bytes:
    req = urllib.request.Request(f"https://api.github.com{path}",
                                 headers={"Accept": accept, "User-Agent": "tiha-mon"})
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT, context=_ssl_context()) as r:
        return r.read()


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure(name: str, events) -> dict:
    """Aracın sunucudaki kopyasını hazırlar. Döner: {"path", "commit", "sha256"}.
    Günün ilk kullanımında (yerel tarih) GitHub'daki son commit denetlenir; değişmişse dosya indirilir,
    Python sözdizimi denetlenip atomik olarak yerine konur. Hata olursa eldeki kopya kullanılır;
    hiç kopya yoksa ToolError."""
    tool = TOOLS[name]
    os.makedirs(_local_dir(name), mode=0o755, exist_ok=True)
    local = os.path.join(_local_dir(name), tool["file"])
    state = _state(name)
    today = _dt.date.today().isoformat()
    have = os.path.exists(local) and state.get("sha256") == _sha256(local)

    if have and state.get("checked") == today and not tool.get("check_every_run"):
        events.add("info", f"{tool['title']}: sunucudaki kopya kullanılıyor (sürüm {state['commit'][:7]}, "
                           f"bugün denetlendi)")
        events.flush()  # genel olay tahta olaylarından önce görünsün
        _write_version(name, state)
        return {"path": local, "commit": state["commit"], "sha256": state["sha256"]}

    events.add("info", f"{tool['title']}: {'' if tool.get('check_every_run') else 'günün ilk kullanımı — '}"
                       f"GitHub'da yeni sürüm denetleniyor "
                       f"({tool['repo']}, {tool['branch']})…")
    events.flush()
    try:
        commit = _api(f"/repos/{tool['repo']}/commits/{tool['branch']}", "application/vnd.github.sha").decode().strip()
        if not commit or len(commit) < 7:
            raise ToolError("son commit okunamadı")
        if have and commit == state.get("commit"):
            events.add("info", f"{tool['title']}: sunucudaki kopya güncel (sürüm {commit[:7]})")
        else:
            meta = json.loads(_api(f"/repos/{tool['repo']}/contents/{tool['file']}?ref={commit}"))
            if meta.get("encoding") == "base64" and meta.get("content"):
                data = base64.b64decode(meta["content"])
            elif meta.get("download_url"):
                raise ToolError("dosya API'den doğrudan gelmedi (1 MB sınırı aşılmış olabilir)")
            else:
                raise ToolError("dosya içeriği alınamadı")
            ast.parse(data.decode("utf-8"))  # yarım/bozuk indirme tahtaya gitmesin
            with open(local + ".tmp", "wb") as f:
                f.write(data)
            os.chmod(local + ".tmp", 0o755)
            os.replace(local + ".tmp", local)
            old = state.get("commit")
            events.add("info", f"{tool['title']}: {'yeni sürüm indirildi' if old else 'indirildi'} — "
                               f"{commit[:7]}{f' (önceki {old[:7]})' if old else ''}, {len(data) // 1024} KB")
        state = {"commit": commit, "sha256": _sha256(local), "checked": today,
                 "updated_at": state.get("updated_at") if have and commit == state.get("commit")
                 else _dt.datetime.now().isoformat(timespec="seconds")}
        _save_state(name, state)
    except Exception as e:  # ağ, TLS, API sınırı, sözdizimi…
        if not have:
            raise ToolError(f"{tool['title']} indirilemedi ve sunucuda kopyası yok: {e}") from e
        events.add("err", f"{tool['title']}: sürüm denetlenemedi ({e}); sunucudaki kopya kullanılıyor "
                          f"(sürüm {state['commit'][:7]})")
    events.flush()
    _write_version(name, state)
    return {"path": local, "commit": state["commit"], "sha256": state["sha256"]}


def _write_version(name: str, state: dict) -> None:
    """Tahtaya araçla birlikte giden VERSION dosyası: hangi commit'in kurulu olduğu tahtada da okunsun."""
    tool = TOOLS[name]
    with open(os.path.join(_local_dir(name), "VERSION"), "w", encoding="utf-8") as f:
        f.write(f"{tool['repo']} {state['commit']} {state.get('updated_at') or ''}\n")


def upload(board: dict, user: str, password: str, name: str, local: dict, events, timeout: int = 60) -> None:
    """Aracı tahtaya kopyalar (yalnız gerekiyorsa). Hata olursa ToolError."""
    tool = TOOLS[name]
    dst = remote_path(name)
    target = f"{user}@{board['ip']}"
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    probe = subprocess.run(
        ["sshpass", "-e", "ssh", "-T", *_SSH_OPTS, target, f"sha256sum {dst} 2>/dev/null | cut -d' ' -f1"],
        stdin=subprocess.DEVNULL, capture_output=True, env=env, timeout=timeout)
    if probe.returncode != 0:
        raise ToolError(f"tahtaya bağlanılamadı: {probe.stderr.decode('utf-8', 'replace').strip() or probe.returncode}")
    if probe.stdout.decode().strip() == local["sha256"]:
        events.add("info", f"{tool['title']}: tahtadaki kopya güncel ({dst}, sürüm {local['commit'][:7]}) — kopyalama atlandı")
        return

    events.add("info", f"{tool['title']}: SFTP ile kopyalanıyor → {dst} (sürüm {local['commit'][:7]})")
    events.flush()
    part = dst + ".part"
    batch = "\n".join([
        f"-mkdir {tool['remote_dir']}",
        f"put {local['path']} {part}",
        f"chmod 755 {part}",
        f"rename {part} {dst}",  # OpenSSH, sunucu destekliyorsa posix-rename (üzerine yazan) kullanır
        f"put {os.path.join(os.path.dirname(local['path']), 'VERSION')} {tool['remote_dir']}/VERSION",
    ]) + "\n"
    # sftp -b toplu kipte BatchMode=yes'i zorlar (parola sorulmaz) — sshpass için açıkça kapatılır.
    r = subprocess.run(["sshpass", "-e", "sftp", "-q", "-o", "BatchMode=no", *_SSH_OPTS, "-b", "-", target],
                       input=batch.encode(), capture_output=True, env=env, timeout=timeout)
    if r.returncode != 0:
        raise ToolError("SFTP kopyalama başarısız: " + (r.stderr.decode("utf-8", "replace").strip() or str(r.returncode)))
    events.add("info", f"{tool['title']}: kopyalandı ({os.path.getsize(local['path']) // 1024} KB)")
