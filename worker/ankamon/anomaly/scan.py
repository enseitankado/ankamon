"""Anlık anomali taraması (Anomaliler ▸ Tarama; görev türü "anomaly_scan" — bkz. runner, backend JobsApi).

Seçilen tahtalarda seçilen kurallar o an yoklanır. Her kural modülü PROBE (tahtada çalışan kabuk parçası,
"anahtar=değer" satırları basar) ve evaluate(values, ctx) tanımlar. Bir tahtaya TEK SSH bağlantısı: seçili
kuralların parçaları bölüm başlıklarıyla ("@@<kind>") tek betikte çalışır.

Sonuç bir anlık görüntüdür (job_targets.output, JSON): {"results": {kind: {anomaly, summary, detail}}}.
anomaly: true (var) / false (yok) / null (değerlendirilemedi). Sürekli izleme ve geçmiş rapor ayrı
(kuralların detect'i, anomalies tablosu); tarama ona yazmaz.
"""

from __future__ import annotations

import json
import os
import subprocess
import time

from . import RULES

SCANNABLE = {rule.KIND: rule for rule in RULES if hasattr(rule, "PROBE")}

_SSH_OPTS = [
    "-T",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
    "-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
]


def _script(kinds: list[str]) -> str:
    parts = []
    for kind in kinds:
        parts.append(f'echo "@@{kind}"\n{SCANNABLE[kind].PROBE.strip()}')
    return "\n".join(parts) + "\n"


def _parse(text: str) -> dict[str, dict]:
    sections: dict[str, dict] = {}
    current = None
    for line in text.splitlines():
        if line.startswith("@@"):
            current = sections.setdefault(line[2:].strip(), {})
        elif current is not None and "=" in line:
            key, _, value = line.partition("=")
            current[key.strip()] = value.strip()
    return sections


def run(conn, board: dict, kinds: list[str], user: str, password: str, timeout: int = 20) -> dict:
    """Tek tahtayı tarar. Döner: {"status": ok|unreachable|failed, "rc", "output": JSON metin}.
    conn yalnız evaluate'in okuması için (iş parçacığına özgü bağlantı verilmeli)."""
    kinds = [k for k in kinds if k in SCANNABLE]
    if not board.get("ip"):
        return {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
    cmd = ["sshpass", "-e", "ssh", *_SSH_OPTS, "-o", f"ConnectTimeout={min(timeout, 8)}",
           f"{user}@{board['ip']}", "sh -s"]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    t0 = time.time()
    try:
        proc = subprocess.run(cmd, input=_script(kinds).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"status": "failed", "rc": None, "output": f"Zaman aşımı ({timeout} sn)."}
    t1 = time.time()
    if proc.returncode == 255 or (proc.returncode == 5 and not proc.stdout):
        err = proc.stderr.decode("utf-8", "replace").strip()
        msg = "SSH parolası reddedildi." if proc.returncode == 5 else (err or "Tahtaya bağlanılamadı.")
        return {"status": "unreachable", "rc": proc.returncode, "output": msg}
    sections = _parse(proc.stdout.decode("utf-8", "replace"))
    ctx = {"t0": t0, "t1": t1, "board": board, "conn": conn}
    results = {}
    for kind in kinds:
        try:
            results[kind] = SCANNABLE[kind].evaluate(sections.get(kind, {}), ctx)
        except Exception as exc:  # noqa: BLE001 — bir kuralın hatası diğer kuralların sonucunu düşürmesin
            results[kind] = {"anomaly": None, "summary": f"Değerlendirilemedi: {exc}", "detail": {}}
    return {"status": "ok", "rc": 0, "output": json.dumps({"results": results}, ensure_ascii=False, default=str)}
