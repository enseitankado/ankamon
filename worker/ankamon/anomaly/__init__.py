"""Anomali tespiti (Tahtalar ▸ Anomaliler; bkz. db/migrations/033_anomalies.sql).

Her kural ayrı bir modüldür: KIND (anomalies.kind) ve detect(conn, since) tanımlar. detect, `since`ten
sonra süren/biten kaynak aralıklarını (ör. tahtanın açık aralıkları) baştan hesaplar ve
(bulunanlar, kapsamlar) döndürür:
  bulunanlar: [{host, board_id, board_name, started_at, ended_at|None, detail}] — ended_at None = sürüyor
  kapsamlar:  [(host, başlangıç, bitiş)] — yeniden hesaplanan aralıklar; bu aralıklarda başlayıp artık
              bulunmayan eski kayıtlar silinir (ör. oturum kaydı gecikip geldiyse 15 dk dolmamış olabilir).
Kapsam dışındaki eski kayıtlara dokunulmaz: kaynak veriler (loglar) silinse de rapor kalır.

İlk çalışmada (imleç yok) tüm geçmiş taranır (geçmişe dönük rapor); sonra her turda son gün ve
sürmekte olan anomalilerin başından itibaren. Yeni kural: modülü yazıp RULES'a ekleyin.
"""

import datetime
import json
import logging

from . import no_login

log = logging.getLogger(__name__)

RULES = [no_login]

# Her turda yeniden hesaplanan geriye dönük pencere (geç gelen loglar/oturum kayıtları için).
WINDOW = datetime.timedelta(days=1)
_EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)


def run(conn) -> None:
    for rule in RULES:
        try:
            _apply(conn, rule)
        except Exception:  # noqa: BLE001 — bir kuralın hatası diğerlerini durdurmasın
            log.exception("Anomali kuralı çalışmadı: %s", rule.KIND)


def _since(conn, kind: str) -> datetime.datetime:
    cursor = conn.execute("SELECT value FROM task_cursors WHERE name = %s", ("anomaly." + kind,)).fetchone()
    if not cursor:
        return _EPOCH  # ilk çalışma: tüm geçmiş
    since = cursor["value"] - WINDOW
    oldest_open = conn.execute(
        "SELECT min(started_at) AS at FROM anomalies WHERE kind = %s AND ended_at IS NULL", (kind,)).fetchone()["at"]
    return min(since, oldest_open) if oldest_open else since


def _apply(conn, rule) -> None:
    kind = rule.KIND
    found, scopes = rule.detect(conn, _since(conn, kind))
    keep = {}
    for a in found:
        keep.setdefault(a["host"], []).append(a["started_at"])
    with conn.transaction():
        for host, start, end in scopes:
            conn.execute(
                """DELETE FROM anomalies WHERE kind = %s AND host = %s AND started_at BETWEEN %s AND %s
                   AND NOT (started_at = ANY(%s))""",
                (kind, host, start, end, keep.get(host, [])))
        for a in found:
            conn.execute(
                """INSERT INTO anomalies (kind, host, board_id, board_name, started_at, ended_at, detail)
                   VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                   ON CONFLICT (kind, host, started_at) DO UPDATE SET
                     ended_at = EXCLUDED.ended_at, detail = EXCLUDED.detail,
                     board_id = COALESCE(EXCLUDED.board_id, anomalies.board_id),
                     board_name = COALESCE(NULLIF(EXCLUDED.board_name, ''), anomalies.board_name),
                     updated_at = now()
                   WHERE anomalies.ended_at IS DISTINCT FROM EXCLUDED.ended_at
                      OR anomalies.detail <> EXCLUDED.detail""",
                (kind, a["host"], a["board_id"], a["board_name"], a["started_at"], a["ended_at"], _json(a["detail"])))
        conn.execute(
            """INSERT INTO task_cursors (name, value, updated_at) VALUES (%s, now(), now())
               ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
            ("anomaly." + kind,))


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)
