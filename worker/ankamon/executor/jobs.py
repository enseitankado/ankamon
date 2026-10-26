"""Kuyruktaki görevleri sırayla alır, türüne göre tahtalarda çalıştırır ve sonuçları yazar.

Görevi API kuyruğa koyar (bkz. backend JobsApi); yürütme burada, host erişimi olan worker'da yapılır.
Her tur bir görev işler; uzun görevler diğer periyodik işleri bloklamasın diye küçük tutulur.
Komut/işlem görevlerinin her tahtadaki sonucu ayrıca command_log'a (komut logları) yazılır.
"""

from __future__ import annotations

import json
import logging
import os

from . import ansible, wol
from .. import activity

log = logging.getLogger(__name__)

ACTIONS_DIR = os.environ.get("ACTIONS_DIR", "/opt/ankamon/app/actions")

# command_log'a yazılan görev türleri (wol komut sayılmaz).
_LOGGED_TYPES = {"command", "action"}


def _board_access(conn) -> tuple[str, str]:
    """SSH erişim bilgisi (settings.ssh_access). Fonksiyon adı değişmedi: board_identity.py bunu içe aktarıyor."""
    row = conn.execute("SELECT value FROM settings WHERE key = 'ssh_access'").fetchone()
    access = (row["value"] if row else None) or {}
    return access.get("user") or "root", access.get("password") or ""


def _claim(conn):
    """Sıradaki bir görevi 'running' yapıp döndürür (eşzamanlı worker'a karşı atomik)."""
    return conn.execute(
        """UPDATE jobs SET status = 'running', started_at = now()
           WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1
                       FOR UPDATE SKIP LOCKED)
           RETURNING id, type, params, title,
                     (SELECT username FROM users WHERE id = created_by) AS username""").fetchone()


def _targets(conn, job_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT board_id, host(ip) AS ip, mac::text AS mac,
                  COALESCE(NULLIF(b.label, ''), b.hostname, host(b.ip)) AS name
           FROM job_targets t JOIN boards b ON b.id = t.board_id WHERE t.job_id = %s""",
        (job_id,)).fetchall()
    return [dict(r) for r in rows]


# Tek turda işlenecek en çok görev sayısı; periyodik işler uzun süre bloklanmasın diye sınırlı.
_MAX_PER_TICK = 20


def run(conn) -> None:
    for _ in range(_MAX_PER_TICK):
        job = _claim(conn)
        if job is None:
            return
        log.info("görev çalıştırılıyor: #%s (%s)", job["id"], job["type"])
        activity.record(conn, f"Görev başladı: {job['title']} ({job['username'] or '—'})")
        try:
            targets = _targets(conn, job["id"])
            results = _dispatch(conn, job, job["params"] or {}, targets)
            summary = _write_results(conn, job, results, targets)
            activity.record(conn, f"Görev bitti: {job['title']} — {summary}")
        except Exception as exc:  # beklenmeyen hata: görevi başarısız kapat, worker dönmeye devam etsin
            log.exception("görev #%s hatası", job["id"])
            conn.execute(
                "UPDATE jobs SET status = 'failed', finished_at = now(), summary = %s WHERE id = %s",
                (f"Hata: {exc}"[:200], job["id"]))
            activity.record(conn, f"Görev hatası: {job['title']} — {exc}"[:200], "error")


def _dispatch(conn, job, params, targets) -> dict[int, dict]:
    """Hedeflerde işi çalıştırır. Her tahtanın sonucu hazır olur olmaz (en yavaş tahtayı beklemeden)
    `_write_one` ile hemen `job_targets`'a yazılır — bkz. ansible.run()'daki on_result; Jobs.js
    bunu polling ile canlı yakalar."""
    if not targets:
        return {}
    names = {t["board_id"]: t["name"] for t in targets}
    # Hepsi "Çalışıyor" görünsün: _write_one her tahtayı bitince tek tek ok/failed'a çevirecek,
    # kullanıcı polling'de hangi tahtaların hâlâ beklediğini anında görsün.
    conn.execute(
        "UPDATE job_targets SET status = 'running' WHERE job_id = %s AND board_id = ANY(%s)",
        (job["id"], [t["board_id"] for t in targets]))

    if job["type"] == "wol":
        results = {}
        for t in targets:
            result = _wol_result(*wol.wake(t["mac"], t["ip"]))
            results[t["board_id"]] = result
            _write_one(conn, job, t["board_id"], result, names.get(t["board_id"], ""))
        return results

    user, password = _board_access(conn)
    if not password:
        raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
    hosts = [{"id": t["board_id"], "ip": t["ip"]} for t in targets if t["ip"]]
    if not hosts:
        raise RuntimeError("Seçilen tahtaların IP adresi yok.")

    def on_result(board_id, result):
        _write_one(conn, job, board_id, result, names.get(board_id, ""))

    if job["type"] == "command":
        return ansible.run(hosts, user, password, body=params["command"], timeout=120, on_result=on_result)
    if job["type"] == "action":
        return _run_action(hosts, user, password, params, on_result)
    raise RuntimeError(f"Bilinmeyen görev türü: {job['type']}")


def _run_action(hosts, user, password, params, on_result) -> dict[int, dict]:
    action_id = params["action"]
    action_dir = os.path.join(ACTIONS_DIR, action_id)
    with open(os.path.join(action_dir, "action.json"), encoding="utf-8") as f:
        timeout = int(json.load(f).get("timeout", 120))
    with open(os.path.join(action_dir, "run.sh"), encoding="utf-8") as f:
        script = f.read()
    env = {k: str(v) for k, v in (params.get("values") or {}).items()}
    return ansible.run(hosts, user, password, body=script, env=env, timeout=timeout, on_result=on_result)


def _wol_result(ok: bool, msg: str) -> dict:
    return {"status": "ok" if ok else "failed", "rc": 0 if ok else None, "output": msg}


def _write_one(conn, job, board_id: int, result: dict, name: str) -> None:
    """Tek bir tahtanın sonucunu hemen yazar — `_dispatch` içinden (ansible on_result veya wol döngüsü)
    o tahta bitince anında çağrılır, en yavaş tahtayı beklemeden; `conn` autocommit olduğundan
    `/api/jobs/{id}` bunu hemen görür (Jobs.js'in 2 sn'lik polling'i canlı akış hissi verir)."""
    conn.execute(
        """UPDATE job_targets SET status = %s, exit_code = %s, output = %s, finished_at = now()
           WHERE job_id = %s AND board_id = %s""",
        (result["status"], result["rc"], result["output"], job["id"], board_id))
    if job["type"] in _LOGGED_TYPES:
        command_text = (job["params"] or {}).get("command") if job["type"] == "command" else job["title"]
        conn.execute(
            """INSERT INTO command_log (board_id, board_name, username, source, command, exit_code, status)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (board_id, name, job["username"] or "", job["type"], command_text or "", result["rc"], result["status"]))


def _write_results(conn, job, results: dict[int, dict], targets: list[dict]) -> str:
    """Tahta başına sonuçlar `_dispatch` sırasında `_write_one` ile zaten yazıldı; burada yalnız
    genel iş özetini kapatır."""
    total = len(results)
    ok = sum(1 for r in results.values() if r["status"] == "ok")
    status = "done" if ok == total else "failed"
    summary = f"{ok}/{total} tahtada başarılı" if total else "Hedef tahta yok."
    conn.execute(
        "UPDATE jobs SET status = %s, finished_at = now(), summary = %s WHERE id = %s",
        (status, summary, job["id"]))
    return summary
