"""Ahenk kontrol raporunu tahtadan alıp veritabanına yazar (Bakım ▸ Ahenk sekmesi).

Hazır işlem actions/ahenk-check tahtada ahenk-debug'ı (enseitankado/ahenk-debug) --json ile çalıştırır ve
raporu /opt/ahenk-debug/son-rapor.json'a (renkli metin raporu son-rapor.ansi'ye) yazar; iş çıktısı satır/uzunluk sınırlı olduğundan (bkz.
runner/stream.py) JSON çıktıdan değil bu dosyadan okunur. Runner, işlem o tahtada başarıyla bitince
fetch_and_store()'u çağırır (bkz. runner/__main__.py). Tahta başına yalnız son rapor tutulur
(ahenk_reports, db/migrations/030_ahenk_reports.sql): summary tablo sütunları, report tam ham veri.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess

from .tools import _SSH_OPTS, TOOLS

log = logging.getLogger("tihamon.ahenk")

ACTION = "ahenk-check"
_DIR = TOOLS["ahenk-debug"]["remote_dir"]
_SEP = "\n--tihamon-ahenk--\n"


def _summary(d: dict, rc: int) -> dict:
    """Tablonun sütunları: ham rapordan küçük, kararlı bir özet (anahtarlar araç sürümüne göre değişebilir)."""
    findings = d.get("findings") or []
    bad = [f for f in findings if isinstance(f, dict) and f.get("severity") in ("FAIL", "WARN")]
    live = d.get("live_connection") or {}
    probe = d.get("active_probe") or {}
    school = d.get("school") or {}
    ident, reg_mac = d.get("identity_mac"), d.get("registered_mac")
    return {
        "result": rc,
        "hostname": d.get("hostname"),
        "ahenk_version": d.get("ahenk_version"),
        "service_active": d.get("service_active"),
        "service_enabled": d.get("service_enabled"),
        "service_nrestarts": d.get("service_nrestarts"),
        "registered": d.get("registered"),
        "lider_server": (d.get("lider_server") or {}).get("short"),
        "uuid": d.get("uuid"),
        "messenger": d.get("messenger_type"),
        "live_count": live.get("count") if isinstance(live, dict) else None,
        # Test yalnız bağlantı yokken yapılır; atlandıysa nedeni yanında (ör. "Pulsar bağlantısı canlı").
        "probe": None if not probe else (f"atlandı ({probe.get('error')})" if probe.get("skipped") and probe.get("error")
                                         else "atlandı" if probe.get("skipped") else "başarılı" if probe.get("ok") else "başarısız"),
        "probe_detail": probe.get("error") or probe.get("stage"),
        "identity_mac": ident,
        "registered_mac": reg_mac,
        "mac_match": (str(ident).lower() == str(reg_mac).lower()) if ident and reg_mac else None,
        "school": school.get("school"),
        "city": school.get("city"),
        "town": school.get("town"),
        "school_code": school.get("code"),
        "unit": school.get("unit_name"),
        "phase": d.get("phase"),
        "fail": sum(1 for f in bad if f.get("severity") == "FAIL"),
        "warn": sum(1 for f in bad if f.get("severity") == "WARN"),
        "problems": [f"{'✗' if f.get('severity') == 'FAIL' else '!'} {f.get('title')}" for f in bad][:20],
    }


def fetch_and_store(conn, board: dict, user: str, password: str, job_id: int | None, events=None) -> None:
    """Tahtadaki son raporu okur ve ahenk_reports'a yazar. Okunamazsa yalnız olay/log (iş başarısı bozulmaz)."""
    cmd = (f"cat {_DIR}/son-rapor.json; printf '{_SEP}'; cat {_DIR}/son-rapor.rc 2>/dev/null; "
           f"printf '{_SEP}'; cut -d' ' -f2 {_DIR}/VERSION 2>/dev/null; printf '{_SEP}'; "
           f"cat {_DIR}/son-rapor.ansi 2>/dev/null")
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "SSHPASS": password}
    try:
        r = subprocess.run(["sshpass", "-e", "ssh", "-T", *_SSH_OPTS, f"{user}@{board['ip']}", cmd],
                           stdin=subprocess.DEVNULL, capture_output=True, env=env, timeout=60)
        raw, rc_txt, commit, text = (r.stdout.decode("utf-8", "replace").split(_SEP, 3) + ["", "", ""])[:4]
        report = json.loads(raw)
        rc = int(rc_txt.strip() or 0)
    except (OSError, subprocess.TimeoutExpired, ValueError) as e:
        log.warning("ahenk raporu okunamadı: tahta %s: %s", board.get("board_id"), e)
        if events:
            events.add("err", f"Ahenk raporu tahtadan okunamadı (tabloya yazılmadı): {e}")
        return
    conn.execute(
        """INSERT INTO ahenk_reports (board_id, checked_at, job_id, exit_code, tool_commit, summary, report, report_text)
           VALUES (%s, now(), %s, %s, %s, %s::jsonb, %s::jsonb, %s)
           ON CONFLICT (board_id) DO UPDATE SET checked_at = now(), job_id = EXCLUDED.job_id,
             exit_code = EXCLUDED.exit_code, tool_commit = EXCLUDED.tool_commit,
             summary = EXCLUDED.summary, report = EXCLUDED.report, report_text = EXCLUDED.report_text""",
        (board["board_id"], job_id, rc, commit.strip()[:40] or None,
         json.dumps(_summary(report, rc), ensure_ascii=False, default=str),
         json.dumps(report, ensure_ascii=False, default=str), text or None))
    if events:
        events.add("info", "Ahenk raporu kaydedildi (Bakım ▸ Ahenk)")
