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

"""Tek bir tahtada kabuk betiğini SSH ile çalıştırır ve olup biteni satır satır olay olarak bildirir."""

from __future__ import annotations

import os
import queue
import shlex
import subprocess
import threading
import time

_READY = "__ANKAMON_READY__"
_MAX_LINES = 20000          # tahta başına saklanan en çok çıktı satırı (sonrası sayılır, saklanmaz)
_MAX_LINE = 2000            # tek satırın en çok uzunluğu
_FLUSH_SECONDS = 0.3        # olaylar en geç bu kadar bekletilip topluca yazılır (veritabanı yükü)
_FLUSH_LINES = 200

_SSH_OPTS = [
    "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4",
    "-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
]


class Events:
    """Bir tahtanın (ya da görevin genelinin) olaylarını tamponlayıp topluca job_events'e yazar.
    Bir bağlantı aynı anda yalnız TEK iş parçacığınca kullanılmalıdır: paralel çalışan tahtalar
    (komut/hazır işlem — bkz. runner/__main__.py) her biri kendi bağlantısıyla kendi Events'ini açar.
    (Önceden tek bağlantı iş parçacıkları arasında eşzamanlı paylaşılıyordu; bu güvenli değildi ve
    birden fazla tahta seçilince pratikte yalnız biri gerçekten tamamlanıyordu.)"""

    def __init__(self, conn, job_id: int, board_id: int | None):
        self.job_id = job_id
        self.board_id = board_id
        self.conn = conn
        self.buf: list[tuple] = []
        self.last = time.monotonic()

    def add(self, kind: str, text: str) -> None:
        self.buf.append((self.job_id, self.board_id, kind, text))
        if len(self.buf) >= _FLUSH_LINES or time.monotonic() - self.last >= _FLUSH_SECONDS:
            self.flush()

    def flush(self) -> None:
        self.last = time.monotonic()
        if not self.buf:
            return
        with self.conn.cursor() as cur:
            cur.executemany("INSERT INTO job_events (job_id, board_id, kind, text) VALUES (%s, %s, %s, %s)", self.buf)
        self.buf = []

    def close(self) -> None:
        self.flush()


def _wrapper(body: str, env: dict | None) -> str:
    lines = [f"printf '%s\\n' {_READY}"]   # bağlantı kuruldu işareti (çıktıya yazılmaz)
    for key, value in (env or {}).items():
        lines.append(f"export {key}={shlex.quote(str(value))}")
    lines.append(body)
    return "\n".join(lines) + "\n"


def _reader(pipe, kind: str, out: queue.Queue) -> None:
    for raw in iter(pipe.readline, b""):
        line = raw.decode("utf-8", errors="replace").rstrip("\n")
        # İlerleme çubukları (\r ile aynı satırı yeniden yazanlar): yalnız son hâli tutulur.
        if "\r" in line:
            line = line.rstrip("\r").split("\r")[-1]
        out.put((kind, line[:_MAX_LINE]))
    out.put((kind, None))


def run(board: dict, user: str, password: str, *, body: str, env: dict | None, timeout: int,
        events: Events) -> dict:
    """Betiği çalıştırır; olayları `events`'e yazar. Döner: {"status", "rc", "output"} (job_targets için)."""
    target = f"{user}@{board['ip']}"
    events.add("info", f"Bağlanılıyor: {target} …")
    started = time.monotonic()
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, target, "bash -c " + shlex.quote(_wrapper(body, env))]
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password})
    q: queue.Queue = queue.Queue()
    for pipe, kind in ((proc.stdout, "out"), (proc.stderr, "err")):
        threading.Thread(target=_reader, args=(pipe, kind, q), daemon=True).start()

    ready = False
    open_pipes = 2
    kept: list[str] = []
    dropped = 0
    err_tail: list[str] = []
    timed_out = False
    while open_pipes:
        try:
            kind, line = q.get(timeout=0.5)
        except queue.Empty:
            events.flush()
            if time.monotonic() - started > timeout:
                timed_out = True
                proc.kill()
            continue
        if line is None:
            open_pipes -= 1
            continue
        if kind == "out" and not ready and line.strip() == _READY:
            ready = True
            events.add("info", f"Bağlandı ({time.monotonic() - started:.1f} sn) — komut çalıştırılıyor")
            continue
        if kind == "err":
            err_tail = (err_tail + [line])[-5:]
        if len(kept) < _MAX_LINES:
            kept.append(line)
            events.add(kind, line)
        else:
            dropped += 1
    rc = proc.wait()
    elapsed = time.monotonic() - started
    if dropped:
        events.add("info", f"… {dropped} satır daha (gösterilmedi)")

    if timed_out:
        status, text, rc = "failed", f"Zaman aşımı: {timeout} sn içinde bitmedi, durduruldu.", None
    elif not ready:
        status = "unreachable"
        if rc == 5:
            text = "Bağlanılamadı: SSH parolası reddedildi (Ayarlar → SSH erişimi)."
        else:
            text = "Bağlanılamadı: " + (err_tail[-1] if err_tail else f"ssh çıkış kodu {rc}")
        rc = None
    elif rc == 0:
        status, text = "ok", f"Bitti — çıkış kodu 0 ({elapsed:.1f} sn)"
        if not kept:
            # Ör. root'un ev dizininde yalnız gizli dosyalar varken "ls" gerçekten hiçbir şey basmaz;
            # bu satır olmadan kullanıcı çıktının gösterilmediğini sanıyordu.
            events.add("info", "(Komut hiçbir çıktı üretmedi)")
    else:
        status, text = "failed", f"Bitti — çıkış kodu {rc} ({elapsed:.1f} sn)"
    events.add("ok" if status == "ok" else "fail", text)
    events.flush()

    output = "\n".join(kept)
    if status != "ok":
        output = (output + "\n" + text).strip()
    return {"status": status, "rc": rc, "output": output[-8000:]}
