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

"""Anomali: işlemci / disk sıcaklığı tahtanın kendi ortalamasının %30 üzerinde.

Yeni veri tutulmaz: ortalamalar zaten sürekli hesaplanan metrics_1h (5 yıl), izleme metrics_5m (180 gün)
özetlerinden okunur. Diske yalnız bulunan anomali kaydı yazılır.

Ortalama: tahtanın son BASE_WINDOW içindeki saatlik ortalamaları (yalnız tahta açıkken ölçüm olur; bir saatte
birden çok seri varsa — çekirdekler, diskler — en sıcağı). BASE_MIN_HOURS'tan az geçmişi olan tahta
değerlendirilmez: birkaç saatlik ortalama yanıltır.

Anomali: 5 dakikalık ortalama RATIO × ortalamayı THRESHOLD kadar kesintisiz aşıyor (kısa yük tepeleri normaldir).
GAP'ten uzun ölçüm boşluğu (tahta kapalı) aralığı bitirir.
"""

import datetime
from types import SimpleNamespace

RATIO = 1.3
THRESHOLD = datetime.timedelta(minutes=15)
GAP = datetime.timedelta(minutes=15)
WINDOW = datetime.timedelta(hours=1)
BASE_WINDOW = datetime.timedelta(days=30)
BASE_MIN_HOURS = 24
BUCKET = datetime.timedelta(minutes=5)

# k10temp node_exporter'da sürücü adıyla değil PCI yoluyla gelir (AMD'de hep 00:18.3); 00:01.0 (amdgpu) dahil değil.
_CPU_TAGS = """t.name = 'node_hwmon_temp_celsius' AND t.chip ~ '(coretemp|k10temp|zenpower|0000:00:18_3)'"""
_DISK_TAGS = """t.name IN ('smartmon_temperature_celsius_raw_value', 'smartmon_airflow_temperature_cel_raw_value',
                           'nvme_temperature_celsius')"""
# Bağlı olmayan sensörün 0'ı, SMART'ın paketli ham değeri: fiziksel olmayan ölçümler sayılmaz.
_VALID = "{a}.value > 0 AND {a}.value <= 120"

_BASELINES = """
SELECT board_id, avg(v) AS avg, count(*) AS hours FROM (
    SELECT t.board_id, h.time, max(h.value) AS v
    FROM metrics_1h h JOIN metrics_tag t USING (tag_id)
    WHERE {tags} AND t.board_id = ANY(%(boards)s) AND h.time >= %(from)s AND {valid}
    GROUP BY t.board_id, h.time
) per_hour GROUP BY board_id HAVING count(*) >= %(min_hours)s
"""

_SAMPLES = """
WITH s AS (
    SELECT t.board_id, m.time, max(m.value) AS v
    FROM metrics_5m m JOIN metrics_tag t USING (tag_id)
    WHERE {tags} AND t.board_id = ANY(%(boards)s) AND m.time >= %(since)s AND {valid}
    GROUP BY t.board_id, m.time
)
SELECT board_id, time, v FROM s ORDER BY board_id, time
"""

_BOARDS = """
SELECT id::text AS board_id, id, lower(COALESCE(NULLIF(hostname, ''), host(ip))) AS host,
       COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name
FROM boards
"""

_KNOWN = """
SELECT host, started_at, ended_at, detail FROM anomalies
WHERE kind = %s AND (ended_at IS NULL OR ended_at >= %s)
ORDER BY started_at
"""


def _tr(value: float, digits: int = 1) -> str:
    return f"{value:.{digits}f}".replace(".", ",")


def _text(peak: float, avg: float) -> str:
    return f"En yüksek {_tr(peak)} °C — ortalaması {_tr(avg)} °C, eşik {_tr(avg * RATIO)} °C"


def _baselines(conn, tags: str, boards: list[str]) -> dict:
    now = conn.execute("SELECT now() AS now").fetchone()["now"]
    rows = conn.execute(_BASELINES.format(tags=tags, valid=_VALID.format(a="h")),
                        {"boards": boards, "from": now - BASE_WINDOW, "min_hours": BASE_MIN_HOURS}).fetchall()
    return {r["board_id"]: float(r["avg"]) for r in rows}


def _islands(rows: list, limit: float) -> list[dict]:
    """Bir tahtanın sıralı ölçümleri → limit üstünde kesintisiz aralıklar."""
    found, current, prev_time = [], None, None
    for r in rows:
        broken = prev_time is not None and r["time"] - prev_time > GAP
        if current and (broken or r["v"] <= limit):
            found.append(current)
            current = None
        if r["v"] > limit:
            if current:
                current["last_at"] = r["time"]
                current["peak"] = max(current["peak"], r["v"])
            else:
                current = {"started_at": r["time"], "last_at": r["time"], "peak": r["v"]}
        prev_time = r["time"]
    if current:
        found.append(current)
    return found


def _detect(conn, since, kind: str, tags: str):
    now = conn.execute("SELECT now() AS now").fetchone()["now"]
    boards = {r["board_id"]: r for r in conn.execute(_BOARDS).fetchall() if r["host"]}
    averages = _baselines(conn, tags, list(boards))
    if not averages:
        return [], []
    samples: dict[str, list] = {}
    for r in conn.execute(_SAMPLES.format(tags=tags, valid=_VALID.format(a="m")),
                          {"boards": list(averages), "since": since}).fetchall():
        samples.setdefault(r["board_id"], []).append(r)

    # Pencerenin başında kesilmiş aralık, kayıtlı anomalinin devamıdır: başlangıcı ve tepesi kayıttan korunur.
    known: dict[str, list] = {}
    for r in conn.execute(_KNOWN, (kind, since - GAP)).fetchall():
        known.setdefault(r["host"], []).append(r)

    found, scopes = [], []
    for board_id, rows in samples.items():
        board = boards[board_id]
        avg = averages[board_id]
        scopes.append((board["host"], rows[0]["time"], rows[-1]["time"]))
        for iv in _islands(rows, avg * RATIO):
            start, peak = iv["started_at"], iv["peak"]
            for r in known.get(board["host"], []):
                if r["started_at"] < start and (r["ended_at"] is None or r["ended_at"] >= start - GAP):
                    start = r["started_at"]
                    peak = max(peak, float((r["detail"] or {}).get("peak_c") or 0))
                    break
            ongoing = iv["last_at"] == rows[-1]["time"] and now - iv["last_at"] <= GAP
            end = now if ongoing else iv["last_at"] + BUCKET
            if end - start < THRESHOLD:
                continue
            found.append({"host": board["host"], "board_id": board["id"], "board_name": board["name"],
                          "started_at": start, "ended_at": None if ongoing else end,
                          "detail": {"peak_c": round(peak, 1), "average_c": round(avg, 1),
                                     "limit_c": round(avg * RATIO, 1), "text": _text(peak, avg)}})
    return found, scopes


def _evaluate(values: dict, ctx: dict, kind_name: str, tags: str) -> dict:
    try:
        current = float(values.get("value", "")) / 1000
    except ValueError:
        current = None
    if current is None or current <= 0:
        return {"anomaly": None, "summary": f"{kind_name} sıcaklığı okunamadı", "detail": {}}
    board_id = str(ctx["board"]["board_id"])
    avg = _baselines(ctx["conn"], tags, [board_id]).get(board_id)
    if avg is None:
        return {"anomaly": None, "summary": f"Şu an {_tr(current)} °C; karşılaştırma için en az "
                                            f"{BASE_MIN_HOURS} saatlik ölçüm geçmişi gerekli",
                "detail": {"current_c": round(current, 1)}}
    limit = avg * RATIO
    detail = {"current_c": round(current, 1), "average_c": round(avg, 1), "limit_c": round(limit, 1)}
    summary = f"Şu an {_tr(current)} °C — ortalaması {_tr(avg)} °C, eşik {_tr(limit)} °C"
    return {"anomaly": current > limit, "summary": summary, "detail": detail}


# Anlık tarama: en sıcak seri, millidegre ("value=").
_CPU_PROBE = r"""
best=
for f in /sys/class/hwmon/hwmon*/name; do
  case "$(cat "$f" 2>/dev/null)" in coretemp|k10temp|zenpower)
    for t in "${f%/name}"/temp*_input; do
      v=$(cat "$t" 2>/dev/null) || continue
      [ -n "$v" ] && { [ -z "$best" ] || [ "$v" -gt "$best" ]; } && best=$v
    done;;
  esac
done
echo "value=$best"
"""

# Uykudaki diski uyandırmaz (-n standby). 194/190: SATA ham değeri 10. sütun; NVMe "Temperature: 35 Celsius".
_DISK_PROBE = r"""
best=
for d in /dev/sd? /dev/nvme?n1; do
  [ -b "$d" ] || continue
  v=$(smartctl -A -n standby "$d" 2>/dev/null | awk '$1=="194"||$1=="190"{print $10; exit} $1=="Temperature:"{print $2; exit}')
  case "$v" in ''|*[!0-9]*) continue;; esac
  [ -z "$best" ] || [ "$v" -gt "$best" ] && best=$v
done
[ -n "$best" ] && echo "value=${best}000"
"""


def _rule(kind: str, name: str, tags: str, probe: str) -> SimpleNamespace:
    return SimpleNamespace(
        KIND=kind, WINDOW=WINDOW, PROBE=probe,
        detect=lambda conn, since: _detect(conn, since, kind, tags),
        evaluate=lambda values, ctx: _evaluate(values, ctx, name, tags))


cpu_rule = _rule("cpu_temp_high", "İşlemci", _CPU_TAGS, _CPU_PROBE)
disk_rule = _rule("disk_temp_high", "Disk", _DISK_TAGS, _DISK_PROBE)
