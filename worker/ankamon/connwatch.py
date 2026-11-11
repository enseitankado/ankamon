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

"""Bağlantı izleyici (kullanıcı isteği 2026-11-11: SSH etkinliği penceresi ▸ Ankamon'un bütün istekleri ve anlık trafik).

Ankamon süreçlerinin (konteyner) açık TCP bağlantılarını `ss -tnpiHO` ile okur; bağlantı başına bayt sayaçlarının
iki örnek arasındaki farkından anlık hızı hesaplar ve /run/ankamon/ssh-activity/conns.json'a yazar. Kaynak servis süreç
zincirinden bulunur (ssh → sshpass [SSH etkinliği kaydındaki pid] → python3 -m ankamon.screen …).

Yalnız pencere açıkken çalışır: API (backend SshActivityApi::connections) her istekte `want` dosyasına dokunur; dosya
WANT_SECONDS'dan eskiyse örnek alınmaz (boşta neredeyse sıfır maliyet). Konteyner host ağında: ana makinenin öteki
süreçlerinin soketleri de görünür ama süreç bilgisi (users:) yalnız konteyner süreçleri için çözülür — yalnız onlar
alınır. Döngü (loopback) bağlantıları (iç servisler arası: postgres, php-fpm, websocket köprüleri) alınmaz.
"""

import json
import logging
import os
import re
import subprocess
import time

DIR = "/run/ankamon/ssh-activity"
WANT = os.path.join(DIR, "want")
OUT = os.path.join(DIR, "conns.json")
INTERVAL = 2.0
WANT_SECONDS = 20

log = logging.getLogger("ankamon.connwatch")

_LINE = re.compile(r"^\S+\s+\S+\s+(\S+)\s+(\S+)\s+(.*)$")
_USERS = re.compile(r'users:\(\("([^"]+)",pid=(\d+)')
_NUM = {k: re.compile(r"\b" + k + r":(\d+)") for k in ("bytes_acked", "bytes_sent", "bytes_received")}

# Süreç adı / komut satırı → okunur servis adı.
_NAMES = {
    "telegraf": "Sensör toplama (Telegraf)", "rsyslogd": "Log alma (rsyslog)", "nginx": "Web sunucusu (nginx)",
    "php-fpm84": "API (PHP)", "grafana": "Grafana", "mediamtx": "Ekran yansıtma (MediaMTX)", "wssh": "Web terminal",
    "sshfs": "Dosya yöneticisi (sshfs)", "fping": "Ping", "nmap": "Ağ taraması (nmap)", "smbclient": "Paylaşım taraması",
    "curl": "curl", "x11vnc": "Ekran (x11vnc)", "postgres": "Veritabanı",
}
_SERVICES = {
    "worker": "Worker", "runner": "Görev çalıştırıcı", "screen": "Ekran/canlı akış", "files": "Dosya işlemleri",
    "filemanager": "Dosya yöneticisi", "netscan": "Ağ taraması", "logwatch": "Ankamon logs", "connwatch": "Bağlantı izleyici",
}


def _cmdline(pid: int) -> str:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().replace(b"\0", b" ").decode("utf-8", "replace").strip()
    except OSError:
        return ""


def _ppid(pid: int) -> int:
    try:
        with open(f"/proc/{pid}/stat") as f:
            return int(f.read().rsplit(")", 1)[1].split()[1])
    except (OSError, ValueError, IndexError):
        return 0


def _service(cmd: str) -> str | None:
    m = re.search(r"-m ankamon(?:\.(\w+))?", cmd)
    if m:
        return _SERVICES.get(m.group(1) or "worker", m.group(1) or "Worker")
    if "ansible" in cmd:
        return "Ansible"
    base = os.path.basename(cmd.split(" ", 1)[0]) if cmd else ""
    if base in ("python3", "python") and "wssh" in cmd:
        return "Web terminal"
    return _NAMES.get(base)


def _owner(pid: int, name: str) -> dict:
    """Bağlantıyı açan servis ve (SSH ise) sshpass sarmalayıcısının pid'i — SSH etkinliği kaydıyla eşleşir.
    Süreç zincirinde yukarı çıkılır: ilk sshpass kaydedilir, ilk tanınan servis alınır (ssh/sshpass/sh atlanır)."""
    info = {"proc": name, "pid": pid, "service": None, "sshpass": None}
    cur = pid
    for _ in range(8):
        if cur <= 1:
            break
        cmd = _cmdline(cur)
        base = os.path.basename(cmd.split(" ", 1)[0]) if cmd else ""
        if base == "sshpass":
            info["sshpass"] = info["sshpass"] or cur
        elif base not in ("ssh", "sh", "bash", "timeout", "nice", "ionice"):
            svc = _service(cmd)
            if svc:
                info["service"] = svc
                break
        cur = _ppid(cur)
    if name in ("ssh", "sshpass"):
        info["service"] = "SSH · " + info["service"] if info["service"] else "SSH"
    elif not info["service"]:
        info["service"] = _NAMES.get(name, name)
    return info


def _split(addr: str) -> tuple[str, int]:
    host, _, port = addr.rpartition(":")
    return host.strip("[]"), int(port or 0)


def _loopback(ip: str) -> bool:
    return ip.startswith("127.") or ip in ("::1", "::ffff:127.0.0.1")


def _listening() -> set[int]:
    out = subprocess.run(["ss", "-tlnH"], capture_output=True, text=True, timeout=5).stdout
    ports = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 4:
            ports.add(_split(parts[3])[1])
    return ports


def sample(prev: dict, prev_ts: float | None) -> tuple[dict, list]:
    now = time.time()
    out = subprocess.run(["ss", "-tnpiHO", "state", "established"], capture_output=True, text=True, timeout=10).stdout
    listen = _listening()
    seen, conns = {}, []
    for line in out.splitlines():
        m = _LINE.match(line)
        u = _USERS.search(line)
        if not m or not u:
            continue
        local, remote, rest = m.group(1), m.group(2), m.group(3)
        lip, lport = _split(local)
        rip, rport = _split(remote)
        if _loopback(lip) and _loopback(rip):
            continue
        name, pid = u.group(1), int(u.group(2))
        nums = {k: int(r.search(rest).group(1)) if r.search(rest) else 0 for k, r in _NUM.items()}
        sent = nums["bytes_acked"] or nums["bytes_sent"]
        recv = nums["bytes_received"]
        key = f"{local}>{remote}"
        seen[key] = (now, sent, recv)
        rate_in = rate_out = None
        if key in prev and prev_ts:
            dt = max(0.001, now - prev[key][0])
            rate_out = max(0, sent - prev[key][1]) / dt
            rate_in = max(0, recv - prev[key][2]) / dt
        conns.append({
            "dir": "in" if lport in listen else "out", "local": local, "remote": remote, "lip": lip, "lport": lport,
            "rip": rip, "rport": rport, "sent": sent, "recv": recv, "rate_in": rate_in, "rate_out": rate_out,
            **_owner(pid, name),
        })
    return seen, conns


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    os.makedirs(DIR, exist_ok=True)
    try:
        if not os.path.exists(WANT):
            open(WANT, "w").close()
        os.chmod(WANT, 0o666)  # API (php-fpm, nobody) dokunabilsin
    except OSError as exc:
        log.warning("want dosyası: %s", exc)
    prev, prev_ts = {}, None
    while True:
        try:
            fresh = time.time() - os.path.getmtime(WANT) < WANT_SECONDS
        except OSError:
            fresh = False
        if not fresh:
            prev, prev_ts = {}, None
            time.sleep(INTERVAL)
            continue
        try:
            seen, conns = sample(prev, prev_ts)
            prev, prev_ts = seen, time.time()
            tmp = OUT + ".tmp"
            with open(tmp, "w") as f:
                json.dump({"ts": prev_ts, "conns": conns}, f, ensure_ascii=False)
            os.chmod(tmp, 0o644)
            os.replace(tmp, OUT)
        except Exception:  # noqa: BLE001 — izleyici düşmesin
            log.exception("örnek alınamadı")
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
