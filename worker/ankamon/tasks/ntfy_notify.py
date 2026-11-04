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

Kural iki çalışma biçiminden birine bağlıdır (bkz. 038_ntfy_rule_modes.sql):
  live    (Anomali başlayınca): süren yeni anomali görülünce; aynı tahta + tür için tekrar sınırı seçilir.
  summary (Düzenli özet):       seçilen aralıkta süren anomalilerin tahta ve tür başına sayısı.
Saatlik üst sınır (max_per_hour) her kuralda geçerlidir: dolunca canlı bildirimler bekler, gürültü telefona taşmaz.
"""

from __future__ import annotations

import datetime
import glob
import json
import logging
import time

from ..executor import ntfy

log = logging.getLogger(__name__)

_EVERY_SECONDS = 30
_PAUSE_AFTER_FAILURE = 300     # sunucuya ulaşılamıyorsa her turda hata kaydı birikmesin
_last = 0.0

_LABELS = {
    "no_login": "Oturumsuz açık", "ntp_unsynced": "NTP eşitlenmemiş", "cpu_temp_high": "İşlemci sıcaklığı yüksek",
    "disk_temp_high": "Disk sıcaklığı yüksek", "cmos_battery_low": "BIOS pili zayıf", "uefi_nvram_high": "UEFI NVRAM dolu",
    "net_link_lost": "Ağ bağlantısı koptu",
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


_HANDLERS = {"live": _live, "summary": _summary}


def run(conn) -> None:
    global _last
    if time.monotonic() - _last < _EVERY_SECONDS:
        return
    _last = time.monotonic()
    cfg = ntfy.config(conn)
    if not cfg["topic"]:
        return
    failed = conn.execute(
        "SELECT 1 FROM ntfy_messages WHERE status = 'failed' AND rule_id IS NOT NULL AND sent_at > now() - make_interval(secs => %s) LIMIT 1",
        (_PAUSE_AFTER_FAILURE,)).fetchone()
    if failed:
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
