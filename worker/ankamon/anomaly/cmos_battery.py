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

"""Anomali: BIOS (CMOS) pili 2,4 V'un altında.

Kaynak: metrics_5m özetindeki Super I/O in8 = Vbat (bkz. docker/telegraf/reshape.star). Yalnız Super I/O sürücüsü
yüklü tahtalarda ölçülür ("Metrik izlemeyi kur (fan/pil/anakart sensörleri dahil)" hazır komutu, bkz. actions/node-exporter).

Düşük okuma en az MIN_BUCKETS kez (15 dk) görülmelidir (tek okuma parazit olabilir). Pil kendiliğinden düzelmez:
tahta kapanınca anomali bitmez, sağlam bir okuma (pil değişti) gelene dek sürer. ~0 V okuma yonga girişinin bağlı
olmadığını gösterir, ölçüm sayılmaz.
"""

import datetime

KIND = "cmos_battery_low"
LIMIT_V = 2.4
NO_READING_V = 0.05
MIN_BUCKETS = 3
GAP = datetime.timedelta(minutes=15)
BUCKET = datetime.timedelta(minutes=5)
WINDOW = datetime.timedelta(hours=1)

_SAMPLES = """
SELECT t.board_id, m.time, min(m.value) AS v
FROM metrics_5m m JOIN metrics_tag t USING (tag_id)
WHERE t.name = 'node_hwmon_in_volts' AND t.board_id <> '' AND m.time >= %s AND m.value > %s
GROUP BY t.board_id, m.time
ORDER BY t.board_id, m.time
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


def _tr(value: float) -> str:
    return f"{value:.2f}".replace(".", ",")


def _islands(rows: list, limit: float) -> list[dict]:
    """Sıralı ölçümler → düşük aralıklar. Aralığı yalnız sağlam okuma bitirir; open: hâlâ sağlam okuma gelmedi."""
    found, current = [], None
    for r in rows:
        if r["v"] < limit:
            if not current:
                current = {"started_at": r["time"], "low_min": r["v"], "buckets": 0, "open": True}
            current["last_at"] = r["time"]
            current["low_last"] = r["v"]
            current["low_min"] = min(current["low_min"], r["v"])
            current["buckets"] += 1
        elif current:
            current["open"] = False
            found.append(current)
            current = None
    if current:
        found.append(current)
    return found


def detect(conn, since):
    boards = {r["board_id"]: r for r in conn.execute(_BOARDS).fetchall() if r["host"]}
    samples: dict[str, list] = {}
    for r in conn.execute(_SAMPLES, (since, NO_READING_V)).fetchall():
        if r["board_id"] in boards:
            samples.setdefault(r["board_id"], []).append(r)
    known: dict[str, list] = {}
    for r in conn.execute(_KNOWN, (KIND, since - GAP)).fetchall():
        known.setdefault(r["host"], []).append(r)

    found, scopes = [], []
    for board_id, rows in samples.items():
        board = boards[board_id]
        scopes.append((board["host"], rows[0]["time"], rows[-1]["time"]))
        for iv in _islands(rows, LIMIT_V):
            start, low, continued = iv["started_at"], iv["low_min"], False
            for r in known.get(board["host"], []):
                if r["started_at"] < start and (r["ended_at"] is None or r["ended_at"] >= start - GAP):
                    start, continued = r["started_at"], True
                    low = min(low, float((r["detail"] or {}).get("min_v") or low))
                    break
            if iv["buckets"] < MIN_BUCKETS and not continued:
                continue
            found.append({"host": board["host"], "board_id": board["id"], "board_name": board["name"],
                          "started_at": start, "ended_at": None if iv["open"] else iv["last_at"] + BUCKET,
                          "detail": {"min_v": round(low, 2), "limit_v": LIMIT_V,
                                     "text": f"En düşük {_tr(low)} V — eşik {_tr(LIMIT_V)} V (yeni pil ~3 V)"}})
    return found, scopes


# Anlık tarama: Super I/O in8 (Vbat), milivolt. it87 yongası sysfs'te model adıyla da görünebilir (it8732…).
PROBE = r"""
superio=
for f in /sys/class/hwmon/hwmon*/name; do
  case "$(cat "$f" 2>/dev/null)" in it8*|nct*|f71*)
    superio=1
    [ -r "${f%/name}/in8_input" ] && echo "mv=$(cat "${f%/name}/in8_input")";;
  esac
done
echo "superio=$superio"
"""


def evaluate(values: dict, ctx: dict) -> dict:
    if values.get("superio") != "1":
        return {"anomaly": None, "summary": "Pil ölçülemiyor: \"Metrik izlemeyi kur (fan/pil/anakart sensörleri dahil)\" hazır komutunu "
                                            "çalıştırın", "detail": {}}
    try:
        volts = float(values.get("mv", "")) / 1000
    except ValueError:
        volts = 0.0
    if volts <= NO_READING_V:
        return {"anomaly": None, "summary": "Donanım izleme yongası pil gerilimini vermiyor", "detail": {}}
    return {"anomaly": volts < LIMIT_V, "summary": f"{_tr(volts)} V — eşik {_tr(LIMIT_V)} V",
            "detail": {"volts": round(volts, 2), "limit_v": LIMIT_V}}
