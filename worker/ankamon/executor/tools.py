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
MEB_CA = "/opt/ankamon/certs/meb-ca.crt"
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
}


# Eklentiler kendi dış araçlarını ext/<ad>/worker/tools.json ile ekleyebilir (çekirdek hiçbir eklentiyi
# adıyla bilmez). Biçim: {"<araç-adı>": {title, repo, branch, file, remote_dir, check_every_run?}}.
# Çok dosyalı araçlar için "kind": "archive" (bkz. _ensure_archive): {title, kind, remote_dir, sources: [
#   {repo, ref: "release" | <dal>, include: [yollar], dest?: <alt dizin>}]} — kaynaklar tek arşivde birleşir,
#   tahtada remote_dir bütünüyle (atomik) değiştirilir.
def _load_ext_tools() -> None:
    import glob
    for path in glob.glob("/opt/ankamon/ext/*/worker/tools.json"):
        try:
            with open(path, encoding="utf-8") as fh:
                for name, spec in (json.load(fh) or {}).items():
                    TOOLS.setdefault(name, spec)
        except (OSError, ValueError):
            pass


_load_ext_tools()

_SSH_OPTS = [
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "ConnectTimeout=10", "-o", "PubkeyAuthentication=no",
    "-o", "PreferredAuthentications=password,keyboard-interactive",
]


class ToolError(RuntimeError):
    pass


def remote_path(name: str) -> str:
    t = TOOLS[name]
    if t.get("kind") == "archive":
        return t["remote_dir"]
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
                                 headers={"Accept": accept, "User-Agent": "ankamon"})
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
    if tool.get("kind") == "archive":
        return _ensure_archive(name, events)
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
    if tool.get("kind") == "archive":
        return _upload_archive(board, user, password, name, local, events, timeout)
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


# --- Çok dosyalı araçlar ("kind": "archive") ------------------------------------------------------------
# Örnek: bir eklentinin GUI'siz kullanılan sihirbazı (paket dizini + yardımcı araçlar). Kaynak başına sürüm
# "release" ise son GitHub sürümünün etiketi, değilse dalın son commit'idir; günün ilk kullanımında (yerel
# tarih) denetlenir, biri değişmişse bütün kaynaklar o sürümleriyle indirilip TEK arşivde birleştirilir.
# Tahta her seferinde indirmez: tahtadaki kopyanın arşiv özeti (remote_dir/.ankamon-arsiv-sha256) aynıysa atlanır.

_ARCHIVE_NAME = "arsiv.tar.gz"
_ARCHIVE_MAX_BYTES = 64 << 20        # tek kaynak tarball'ının üst sınırı (yanlış depo/ref koruması)
_ARCHIVE_MARK = ".ankamon-arsiv-sha256"


def _arsiv_kaynak_surumu(src: dict) -> str:
    """Kaynağın şu anki sürümü: "release" → son sürüm etiketi (ör. v0.1.100), dal → son commit (40 hane)."""
    if src.get("ref", "release") == "release":
        tag = json.loads(_api(f"/repos/{src['repo']}/releases/latest")).get("tag_name") or ""
        if not tag:
            raise ToolError(f"{src['repo']}: son sürüm etiketi okunamadı")
        return tag
    sha = _api(f"/repos/{src['repo']}/commits/{src['ref']}", "application/vnd.github.sha").decode().strip()
    if len(sha) < 7:
        raise ToolError(f"{src['repo']}: son commit okunamadı")
    return sha


def _arsiv_kaynagini_ac(src: dict, version: str, staging: str) -> int:
    """Kaynağın tarball'ını (api.github.com → codeload yönlendirmesi) indirip yalnız `include` yollarını
    staging/<dest>/ altına açar. Bağlantı, mutlak yol, '..' ve normal dosya/dizin dışı üye atlanır.
    @return açılan dosya sayısı"""
    import io
    import tarfile
    req = urllib.request.Request(f"https://api.github.com/repos/{src['repo']}/tarball/{version}",
                                 headers={"Accept": "application/vnd.github+json", "User-Agent": "ankamon"})
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT * 3, context=_ssl_context()) as r:
        data = r.read(_ARCHIVE_MAX_BYTES + 1)
    if len(data) > _ARCHIVE_MAX_BYTES:
        raise ToolError(f"{src['repo']}: arşiv {_ARCHIVE_MAX_BYTES >> 20} MB sınırını aşıyor")
    include = [p.strip("/") for p in src.get("include") or []]
    dest_root = os.path.join(staging, (src.get("dest") or "").strip("/"))
    count = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            parts = member.name.split("/", 1)          # GitHub tarball'ı "<sahip>-<depo>-<sha>/" altında
            if len(parts) < 2 or not parts[1]:
                continue
            rel = parts[1].rstrip("/")
            pieces = rel.split("/")
            if include and not any(rel == p or rel.startswith(p + "/") for p in include):
                continue
            if rel.startswith("/") or ".." in pieces or "__pycache__" in pieces:
                continue
            target = os.path.join(dest_root, rel)
            if member.isdir():
                os.makedirs(target, exist_ok=True)
            elif member.isfile():
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with tar.extractfile(member) as fsrc, open(target, "wb") as fdst:
                    fdst.write(fsrc.read())
                os.chmod(target, 0o755 if member.mode & 0o111 else 0o644)
                count += 1
    if not count:
        raise ToolError(f"{src['repo']}@{version}: arşivde istenen yollar yok ({', '.join(include) or 'tümü'})")
    return count


def _arsiv_etiketi(tool: dict, versions: dict) -> str:
    """İnsanın okuyacağı sürüm: ilk kaynağın sürümü (+ diğerlerinin kısa commit'i)."""
    labels = []
    for src in tool["sources"]:
        v = versions.get(src["repo"], "")
        labels.append(v[:7] if len(v) == 40 else v)
    return labels[0] + (f" (+{', '.join(labels[1:])})" if len(labels) > 1 else "")


def _ensure_archive(name: str, events) -> dict:
    """Çok dosyalı aracın sunucudaki arşivini hazırlar. Döner: {"path", "commit" (sürüm etiketi), "sha256",
    "versions"}. Günde bir sürüm denetimi; hata olursa eldeki arşiv kullanılır, hiç yoksa ToolError."""
    import shutil
    import tarfile
    import tempfile
    tool = TOOLS[name]
    base = _local_dir(name)
    os.makedirs(base, mode=0o755, exist_ok=True)
    local = os.path.join(base, _ARCHIVE_NAME)
    state = _state(name)
    today = _dt.date.today().isoformat()
    have = os.path.exists(local) and state.get("sha256") == _sha256(local)

    def result() -> dict:
        return {"path": local, "commit": state["label"], "sha256": state["sha256"], "versions": state["versions"]}

    if have and state.get("checked") == today and not tool.get("check_every_run"):
        events.add("info", f"{tool['title']}: sunucudaki kopya kullanılıyor (sürüm {state['label']}, bugün denetlendi)")
        events.flush()
        return result()

    events.add("info", f"{tool['title']}: günün ilk kullanımı — GitHub'da yeni sürüm denetleniyor…")
    events.flush()
    try:
        versions = {src["repo"]: _arsiv_kaynak_surumu(src) for src in tool["sources"]}
        if have and versions == state.get("versions"):
            events.add("info", f"{tool['title']}: sunucudaki kopya güncel (sürüm {state['label']})")
            state["checked"] = today
        else:
            staging = tempfile.mkdtemp(prefix=f"{name}.", dir=base)
            try:
                files = sum(_arsiv_kaynagini_ac(src, versions[src["repo"]], staging) for src in tool["sources"])
                with open(os.path.join(staging, ".ankamon-surum.json"), "w", encoding="utf-8") as fh:
                    json.dump(versions, fh, ensure_ascii=False)
                with tarfile.open(local + ".tmp", "w:gz") as tar:
                    for entry in sorted(os.listdir(staging)):
                        tar.add(os.path.join(staging, entry), arcname=entry)
                os.replace(local + ".tmp", local)
            finally:
                shutil.rmtree(staging, ignore_errors=True)
            old = state.get("label")
            state = {"versions": versions, "label": _arsiv_etiketi(tool, versions), "sha256": _sha256(local),
                     "checked": today, "updated_at": _dt.datetime.now().isoformat(timespec="seconds")}
            events.add("info", f"{tool['title']}: {'yeni sürüm indirildi' if old else 'indirildi'} — {state['label']}"
                               f"{f' (önceki {old})' if old else ''}, {files} dosya, {os.path.getsize(local) // 1024} KB")
        _save_state(name, state)
    except Exception as e:  # ağ, TLS, API sınırı, bozuk arşiv…
        if not have:
            raise ToolError(f"{tool['title']} indirilemedi ve sunucuda kopyası yok: {e}") from e
        events.add("err", f"{tool['title']}: sürüm denetlenemedi ({e}); sunucudaki kopya kullanılıyor "
                          f"(sürüm {state['label']})")
    events.flush()
    return result()


def _upload_archive(board: dict, user: str, password: str, name: str, local: dict, events, timeout: int) -> None:
    """Arşivi tahtaya kopyalayıp remote_dir'i atomik olarak değiştirir (yalnız arşiv özeti farklıysa)."""
    tool = TOOLS[name]
    dst = tool["remote_dir"].rstrip("/")
    target = f"{user}@{board['ip']}"
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}

    def ssh(command: str) -> subprocess.CompletedProcess:
        return subprocess.run(["sshpass", "-e", "ssh", "-T", *_SSH_OPTS, target, command],
                              stdin=subprocess.DEVNULL, capture_output=True, env=env, timeout=timeout)

    probe = ssh(f"cat {dst}/{_ARCHIVE_MARK} 2>/dev/null; true")
    if probe.returncode != 0:
        raise ToolError(f"tahtaya bağlanılamadı: {probe.stderr.decode('utf-8', 'replace').strip() or probe.returncode}")
    if probe.stdout.decode().strip() == local["sha256"]:
        events.add("info", f"{tool['title']}: tahtadaki kopya güncel ({dst}, sürüm {local['commit']}) — kopyalama atlandı")
        return

    events.add("info", f"{tool['title']}: SFTP ile kopyalanıyor → {dst} (sürüm {local['commit']})")
    events.flush()
    part = f"/var/tmp/ankamon-{name}.tar.gz.part"
    r = subprocess.run(["sshpass", "-e", "sftp", "-q", "-o", "BatchMode=no", *_SSH_OPTS, "-b", "-", target],
                       input=f"put {local['path']} {part}\n".encode(), capture_output=True, env=env, timeout=timeout)
    if r.returncode != 0:
        raise ToolError("SFTP kopyalama başarısız: " + (r.stderr.decode("utf-8", "replace").strip() or str(r.returncode)))
    # Yeni dizine açılır, sonra eskisiyle yer değiştirir: yarım kopya hiçbir zaman çalıştırılmaz.
    swap = (f'set -e; d={dst}; t={part}; rm -rf "$d.new" "$d.old"; mkdir -p "$d.new"; '
            f'tar -xzf "$t" -C "$d.new" --no-same-owner; echo {local["sha256"]} > "$d.new/{_ARCHIVE_MARK}"; '
            f'if [ -d "$d" ]; then mv "$d" "$d.old"; fi; mv "$d.new" "$d"; rm -rf "$d.old" "$t"')
    r = ssh(swap)
    if r.returncode != 0:
        raise ToolError("arşiv tahtada açılamadı: " + (r.stderr.decode("utf-8", "replace").strip() or str(r.returncode)))
    events.add("info", f"{tool['title']}: kopyalandı ({os.path.getsize(local['path']) // 1024} KB)")
