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

"""Anomaliler ▸ Bildirimler kuralları: anomali verisinden ntfy bildirimi (bkz. executor/ntfy.py, 037_session_activity_ntfy.sql).

Kural, anomali sayfasının dört çalışma biçiminden birine bağlıdır:
  live    (Anlık):  süren yeni anomali görülünce; aynı tahta + tür için tekrar sınırı seçilir.
  scan    (Tarama): seçilen aralıkta tahtalar "anomaly_scan" göreviyle yoklanır, anomali bulunanlar bildirilir.
  history (Geçmiş): seçilen aralıkta yeni başlayan kayıtların dökümü.
  summary (Özet):   seçilen aralıkta tahta başına sayı ve süre özeti.
Saatlik üst sınır (max_per_hour) her kuralda geçerlidir: dolunca canlı bildirimler bekler, gürültü telefona taşmaz.
"""

from __future__ import annotations

import datetime
import glob
import json
import logging
import time

from psycopg.types.json import Jsonb

from ..anomaly import scan as anomaly_scan
from ..executor import ntfy

log = logging.getLogger(__name__)

_EVERY_SECONDS = 30
_last = 0.0

_LABELS = {
    "no_login": "Oturumsuz açık", "ntp_unsynced": "NTP eşitlenmemiş", "cpu_temp_high": "İşlemci sıcaklığı yüksek",
    "disk_temp_high": "Disk sıcaklığı yüksek", "cmos_battery_low": "BIOS pili zayıf",
}


def _labels() -> dict:
    labels = dict(_LABELS)
    for path in glob.glob("/opt/ankamon/ext/*/anomaly_kinds.json"):
        try:
            with open(path, encoding="utf-8") as f:
                for kind, item in json.load(f).items():
                    labels.setdefault(kind, item.get("label", kind))
        except (OSError, ValueError, AttributeError):
            continue
    return labels


def _org(conn) -> str:
    row = conn.execute("SELECT value FROM settings WHERE key = 'organization'").fetchone()
    return ((row["value"] if row else None) or {}).get("name") or ""


def _room(conn, rule) -> int:
    used = conn.execute(
        "SELECT count(*) AS n FROM ntfy_messages WHERE rule_id = %s AND status = 'ok' AND sent_at > now() - interval '1 hour'",
        (rule["id"],)).fetchone()["n"]
    return rule["max_per_hour"] - used


def _due(conn, rule) -> bool:
    """Aralık doldu mu; kuralın ilk turunda yalnız sayaç başlar (kurulur kurulmaz döküm gönderilmez)."""
    if rule["last_run_at"] is None:
        conn.execute("UPDATE ntfy_rules SET last_run_at = now() WHERE id = %s", (rule["id"],))
        return False
    return datetime.datetime.now(datetime.timezone.utc) - rule["last_run_at"] >= datetime.timedelta(minutes=rule["interval_minutes"])


def _where(rule) -> tuple[str, list]:
    sql, args = "", []
    if rule["kinds"]:
        sql += " AND a.kind = ANY(%s)"
        args.append(rule["kinds"])
    if rule["board_ids"]:
        sql += " AND a.board_id = ANY(%s)"
        args.append(rule["board_ids"])
    return sql, args


def _name(a) -> str:
    return a["board"] or a["host"]


def _live(conn, rule, cfg, labels, title_prefix) -> None:
    where, args = _where(rule)
    rows = conn.execute(
        f"""SELECT a.id, a.kind, a.host, a.board_id, COALESCE(NULLIF(b.label, ''), NULLIF(a.board_name, '')) AS board, a.started_at
            FROM anomalies a LEFT JOIN boards b ON b.id = a.board_id
            WHERE a.ended_at IS NULL {where}
              AND NOT EXISTS (SELECT 1 FROM ntfy_sent s WHERE s.rule_id = %s AND s.anomaly_id = a.id)
            ORDER BY a.started_at""", (*args, rule["id"])).fetchall()
    room = _room(conn, rule)
    for a in rows:
        if rule["interval_minutes"] > 0 and conn.execute(
                """SELECT 1 FROM ntfy_messages WHERE rule_id = %s AND board_id IS NOT DISTINCT FROM %s AND kind = %s AND status = 'ok'
                   AND sent_at > now() - make_interval(mins => %s) LIMIT 1""",
                (rule["id"], a["board_id"], a["kind"], rule["interval_minutes"])).fetchone():
            conn.execute("INSERT INTO ntfy_sent VALUES (%s, %s) ON CONFLICT DO NOTHING", (rule["id"], a["id"]))
            continue
        if room <= 0:
            return
        label = labels.get(a["kind"], a["kind"])
        ok = ntfy.send_logged(conn, cfg, rule["id"], rule["name"], f"{title_prefix}{label}",
                              f"{_name(a)}: {label} ({a['started_at']:%d.%m.%Y %H:%M} başladı)", a["board_id"], a["kind"])
        if ok:
            room -= 1
            conn.execute("INSERT INTO ntfy_sent VALUES (%s, %s) ON CONFLICT DO NOTHING", (rule["id"], a["id"]))
        else:
            return      # sunucuya ulaşılamıyor: bir sonraki tura kalır


def _history(conn, rule, cfg, labels, title_prefix) -> None:
    if not _due(conn, rule):
        return
    where, args = _where(rule)
    rows = conn.execute(
        f"""SELECT a.kind, a.host, COALESCE(NULLIF(b.label, ''), NULLIF(a.board_name, '')) AS board, a.started_at
            FROM anomalies a LEFT JOIN boards b ON b.id = a.board_id
            WHERE a.started_at >= %s {where} ORDER BY a.started_at""", (rule["last_run_at"], *args)).fetchall()
    conn.execute("UPDATE ntfy_rules SET last_run_at = now() WHERE id = %s", (rule["id"],))
    if rows and _room(conn, rule) > 0:
        lines = [f"{a['started_at']:%d.%m %H:%M} {_name(a)}: {labels.get(a['kind'], a['kind'])}" for a in rows[:30]]
        more = f"\n… {len(rows) - 30} kayıt daha" if len(rows) > 30 else ""
        ntfy.send_logged(conn, cfg, rule["id"], rule["name"], f"{title_prefix}{len(rows)} yeni anomali", "\n".join(lines) + more)


def _summary(conn, rule, cfg, labels, title_prefix) -> None:
    if not _due(conn, rule):
        return
    where, args = _where(rule)
    rows = conn.execute(
        f"""SELECT COALESCE(NULLIF(b.label, ''), NULLIF(a.board_name, ''), a.host) AS board, a.kind, count(*) AS n
            FROM anomalies a LEFT JOIN boards b ON b.id = a.board_id
            WHERE (a.ended_at IS NULL OR a.ended_at >= %s) {where}
            GROUP BY 1, 2 ORDER BY 3 DESC""", (rule["last_run_at"], *args)).fetchall()
    conn.execute("UPDATE ntfy_rules SET last_run_at = now() WHERE id = %s", (rule["id"],))
    if rows and _room(conn, rule) > 0:
        lines = [f"{r['board']}: {labels.get(r['kind'], r['kind'])} × {r['n']}" for r in rows[:30]]
        ntfy.send_logged(conn, cfg, rule["id"], rule["name"], f"{title_prefix}Anomali özeti ({sum(r['n'] for r in rows)} kayıt)", "\n".join(lines))


def _scan(conn, rule, cfg, labels, title_prefix) -> None:
    if rule["pending_job"]:
        job = conn.execute("SELECT status FROM jobs WHERE id = %s", (rule["pending_job"],)).fetchone()
        if job and job["status"] in ("queued", "running"):
            return
        found = []
        if job:
            for t in conn.execute(
                    """SELECT t.board_id, t.output, COALESCE(NULLIF(b.label, ''), b.hostname, host(b.ip)) AS name
                       FROM job_targets t JOIN boards b ON b.id = t.board_id WHERE t.job_id = %s AND t.status = 'ok'""",
                    (rule["pending_job"],)).fetchall():
                try:
                    results = json.loads(t["output"] or "{}").get("results", {})
                except ValueError:
                    continue
                for kind, res in results.items():
                    if res.get("anomaly") is True:
                        found.append((t["board_id"], t["name"], kind, res.get("summary") or ""))
        conn.execute("UPDATE ntfy_rules SET pending_job = NULL WHERE id = %s", (rule["id"],))
        room = _room(conn, rule)
        for board_id, name, kind, text in found:
            if room <= 0:
                break
            label = labels.get(kind, kind)
            if ntfy.send_logged(conn, cfg, rule["id"], rule["name"], f"{title_prefix}Tarama: {label}", f"{name}: {text or label}", board_id, kind):
                room -= 1
        return
    if not _due(conn, rule):
        return
    kinds = [k for k in (rule["kinds"] or list(anomaly_scan.SCANNABLE)) if k in anomaly_scan.SCANNABLE]
    boards = conn.execute(
        "SELECT id FROM boards WHERE online AND ip IS NOT NULL AND (%s OR id = ANY(%s))",
        (not rule["board_ids"], rule["board_ids"])).fetchall()
    conn.execute("UPDATE ntfy_rules SET last_run_at = now() WHERE id = %s", (rule["id"],))
    if not kinds or not boards:
        return
    with conn.transaction():
        job_id = conn.execute(
            "INSERT INTO jobs (type, title, params) VALUES ('anomaly_scan', %s, %s) RETURNING id",
            (f"Bildirim taraması: {rule['name']}", Jsonb({"kinds": kinds}))).fetchone()["id"]
        for b in boards:
            conn.execute("INSERT INTO job_targets (job_id, board_id) VALUES (%s, %s)", (job_id, b["id"]))
        conn.execute("UPDATE ntfy_rules SET pending_job = %s WHERE id = %s", (job_id, rule["id"]))
        conn.execute("SELECT pg_notify('ankamon_jobs', %s)", (str(job_id),))


_HANDLERS = {"live": _live, "history": _history, "summary": _summary, "scan": _scan}


def run(conn) -> None:
    global _last
    if time.monotonic() - _last < _EVERY_SECONDS:
        return
    _last = time.monotonic()
    cfg = ntfy.config(conn)
    if not cfg["topic"]:
        return
    rules = conn.execute("SELECT * FROM ntfy_rules WHERE enabled ORDER BY id").fetchall()
    if not rules:
        return
    labels = _labels()
    org = _org(conn)
    prefix = f"{org}: " if org else "Ankamon: "
    for rule in rules:
        try:
            _HANDLERS[rule["mode"]](conn, rule, cfg, labels, prefix)
        except Exception:  # noqa: BLE001 — bir kuralın hatası ötekileri durdurmasın
            log.exception("ntfy kuralı çalışmadı: %s", rule["name"])
