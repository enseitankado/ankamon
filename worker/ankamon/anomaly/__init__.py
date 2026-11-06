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

Kural ayrıca PROBE (tahtada çalışan kabuk parçası) ve evaluate(values, ctx) tanımlarsa Anomaliler ▸ Tarama'da
seçilen tahtalarda anlık taranabilir (bkz. anomaly.scan).

Eklentiler de kural ekleyebilir (çekirdek eklentiyi adıyla bilmez): /opt/ankamon/ext/<ad>/worker/anomaly_rules.py
içindeki RULES listesi, burada aynı sözleşmeyle çalışır; tür adları ext/<ad>/anomaly_kinds.json'dan (bkz. backend
AnomaliesApi). Eklentinin verisine dayanan kural (ör. kendi tablosu) eklenti devre dışıyken kendisi boş dönmeli.
"""

import datetime
import glob
import importlib.util
import json
import logging
import os
import sys

from . import cmos_battery, identity, net_events, net_link_lost, no_login, ntp_unsynced, temp_high, uefi_nvram_high

log = logging.getLogger(__name__)


def _extension_rules() -> list:
    found = []
    for path in sorted(glob.glob("/opt/ankamon/ext/*/worker/anomaly_rules.py")):
        name = "ankamonext_anomaly_" + path.split("/")[-3]
        try:
            worker_dir = os.path.dirname(path)
            if worker_dir not in sys.path:
                sys.path.insert(0, worker_dir)
            spec = importlib.util.spec_from_file_location(name, path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            found.extend(getattr(module, "RULES", []))
        except Exception:  # noqa: BLE001 — bir eklentinin hatası çekirdek kurallarını durdurmasın
            log.exception("Eklenti anomali kuralları yüklenemedi: %s", path)
    return found


RULES = [no_login, ntp_unsynced, temp_high.cpu_rule, temp_high.disk_rule, cmos_battery, net_link_lost,
         uefi_nvram_high, net_link_lost.delayed_rule] + net_events.RULES + identity.RULES + _extension_rules()

# Her turda yeniden hesaplanan geriye dönük pencere (geç gelen loglar/oturum kayıtları için).
WINDOW = datetime.timedelta(days=1)
_EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)


def run(conn) -> None:
    overrides = _overrides(conn)
    for rule in RULES:
        try:
            if _due(conn, rule, overrides.get(rule.KIND) or {}):
                _apply(conn, rule)
        except Exception:  # noqa: BLE001 — bir kuralın hatası diğerlerini durdurmasın
            log.exception("Anomali kuralı çalışmadı: %s", rule.KIND)


def _overrides(conn) -> dict:
    """Yöneticinin tür ayarları (Tahta sağlığı ▸ Yardım ▸ Denetim türleri; bkz. backend AnomaliesApi::updateKind)."""
    try:
        row = conn.execute("SELECT value FROM settings WHERE key = 'anomaly_kind_overrides'").fetchone()
    except Exception:  # noqa: BLE001 — ayar okunamazsa varsayılanlarla devam
        return {}
    value = row["value"] if row else None
    return value if isinstance(value, dict) else {}


def _due(conn, rule, override: dict) -> bool:
    """Kural EVERY (sn) verdiyse en son çalışmasından o kadar geçmeden yeniden çalışmaz (log taraması pahalı kurallar).
    Yönetici sıklığı ayarladıysa (override every_s) o geçerlidir; tur 60 sn olduğundan birkaç sn pay bırakılır."""
    every = override.get("every_s") or getattr(rule, "EVERY", 0)
    try:
        every = float(every)
    except (TypeError, ValueError):
        every = 0
    if every <= 60:
        return True
    row = conn.execute("SELECT now() - value AS age FROM task_cursors WHERE name = %s", ("anomaly." + rule.KIND,)).fetchone()
    return row is None or row["age"].total_seconds() >= every - 5


def _since(conn, rule) -> datetime.datetime:
    kind = rule.KIND
    cursor = conn.execute("SELECT value FROM task_cursors WHERE name = %s", ("anomaly." + kind,)).fetchone()
    if not cursor:
        return _EPOCH  # ilk çalışma: tüm geçmiş
    # Kural kendi penceresini verebilir (ör. ölçümler geç gelmez — her turda bir günü taramaya gerek yok).
    since = cursor["value"] - getattr(rule, "WINDOW", WINDOW)
    if getattr(rule, "OPEN_FROM_WINDOW", False):
        return since   # kural süren kaydın devamını kendisi bağlar (bkz. log_events.continue_known): geriye taramaz
    oldest_open = conn.execute(
        "SELECT min(started_at) AS at FROM anomalies WHERE kind = %s AND ended_at IS NULL", (kind,)).fetchone()["at"]
    return min(since, oldest_open) if oldest_open else since


def _apply(conn, rule) -> None:
    kind = rule.KIND
    found, scopes = rule.detect(conn, _since(conn, rule))
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
