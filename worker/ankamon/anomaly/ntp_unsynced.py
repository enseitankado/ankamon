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

"""Anomali: tahtanın saati NTP sunucusuyla eşitlenmiyor.

Sürekli izleme (detect) tahtanın node_exporter ölçümlerinden yapılır (telegraf, dakikada bir — bkz.
docker/telegraf/reshape.star): bir ölçüm "eşitlenmemiş" sayılır, eğer
  - node_timex_sync_status = 0 (çekirdeğin saat eşitleme bayrağı; systemd-timesyncd/chrony eşitleyince 1), ya da
  - tahtanın saati (node_time_seconds) ölçümün sunucudaki zamanından OFFSET_MAX'tan fazla sapıyorsa.
Ardışık eşitlenmemiş ölçümler (aralarında GAP'ten uzun boşluk yok — tahta kapandıysa aralık biter) bir
aralıktır; THRESHOLD'dan uzun olanlar anomalidir (açılışta eşitleme birkaç saniye-dakika sürebilir).
sync_status ölçümü eklenmeden önceki geçmişte yalnız saat sapması değerlendirilir.

Sapma eşiği bilerek geniştir: ölçüm zamanı Ankamon sunucusunun saatidir; sunucunun kendi saati de birkaç
saniye kayabilir. Asıl ölçüt çekirdeğin eşitleme bayrağıdır.

Anlık tarama (PROBE/evaluate, bkz. anomaly.scan): tahtada timedatectl ile NTP açık mı, eşitlendi mi,
hangi sunucu/servis, son eşitleme ve sunucuya göre saat farkı.
"""

import datetime

KIND = "ntp_unsynced"
THRESHOLD = datetime.timedelta(minutes=15)
# Ölçümler arasında bundan uzun boşluk: tahta kapalıydı ya da ölçülemedi, aralık burada biter.
GAP = datetime.timedelta(minutes=15)
OFFSET_MAX = 30.0  # saniye
# Her turda yeniden hesaplanan geriye dönük pencere (bkz. anomaly._since): ölçümler geç gelmez, birkaç
# boşluk payı yeter (süren anomalinin başı ayrıca kapsanır).
WINDOW = datetime.timedelta(hours=1)

_SAMPLES = """
WITH s AS (
    SELECT t.board_id, m.time,
           max(CASE WHEN t.name = 'node_time_seconds' THEN m.value - extract(epoch FROM m.time) END) AS off,
           max(CASE WHEN t.name = 'node_timex_sync_status' THEN m.value END) AS sync
    FROM metrics m JOIN metrics_tag t USING (tag_id)
    WHERE t.name IN ('node_time_seconds', 'node_timex_sync_status') AND m.time >= %(since)s
    GROUP BY t.board_id, m.time
), f AS (
    SELECT board_id, time, off, sync,
           (COALESCE(sync = 0, false) OR COALESCE(abs(off) > %(off_max)s, false)) AS bad
    FROM s
), g AS (
    SELECT *, lag(time) OVER w AS prev_t, lag(bad) OVER w AS prev_bad FROM f
    WINDOW w AS (PARTITION BY board_id ORDER BY time)
), h AS (
    SELECT *, sum(CASE WHEN bad AND (prev_bad IS NOT TRUE OR time - prev_t > %(gap)s) THEN 1 ELSE 0 END)
                  OVER (PARTITION BY board_id ORDER BY time) AS grp
    FROM g
)
SELECT h.board_id, min(h.time) AS started_at, max(h.time) AS last_at,
       max(abs(h.off)) AS off_max, bool_or(COALESCE(h.sync = 0, false)) AS unsynced,
       (array_agg(h.off ORDER BY h.time DESC))[1] AS off_last
FROM h WHERE h.bad
GROUP BY h.board_id, h.grp
ORDER BY h.board_id, started_at
"""

# Tahta başına ölçüm kapsamı (yeniden hesaplanan aralık) ve son ölçüm zamanı.
_SCOPES = """
SELECT t.board_id, min(m.time) AS first_at, max(m.time) AS last_at
FROM metrics m JOIN metrics_tag t USING (tag_id)
WHERE t.name = 'node_time_seconds' AND m.time >= %s
GROUP BY t.board_id
"""

_BOARDS = """
SELECT id, lower(COALESCE(NULLIF(hostname, ''), host(ip))) AS host,
       COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name
FROM boards WHERE id = ANY(%s)
"""


_KNOWN = """
SELECT host, started_at, ended_at FROM anomalies
WHERE kind = %s AND (ended_at IS NULL OR ended_at >= %s)
ORDER BY started_at
"""


def _board_ids(rows) -> list[int]:
    ids = set()
    for r in rows:
        try:
            ids.add(int(r["board_id"]))
        except (TypeError, ValueError):
            pass
    return sorted(ids)


def detect(conn, since):
    now = conn.execute("SELECT now() AS now").fetchone()["now"]
    scopes_rows = conn.execute(_SCOPES, (since,)).fetchall()
    if not scopes_rows:
        return [], []
    islands = conn.execute(_SAMPLES, {"since": since, "off_max": OFFSET_MAX, "gap": GAP}).fetchall()
    boards = {r["id"]: r for r in conn.execute(_BOARDS, (_board_ids(scopes_rows),)).fetchall()}
    last_sample = {}
    scopes = []
    for r in scopes_rows:
        board = boards.get(int(r["board_id"])) if str(r["board_id"]).isdigit() else None
        if not board or not board["host"]:
            continue  # tahta kaydı silinmiş: eski kayıtlara dokunma
        last_sample[board["id"]] = r["last_at"]
        scopes.append((board["host"], r["first_at"], r["last_at"]))

    # Pencerenin başında kesilmiş aralık, daha önce kaydedilmiş anomalinin devamıdır: başlangıcı oradan alınır
    # (yoksa aynı anomali pencere başlangıcıyla ikinci kez yazılırdı).
    known = {}
    for r in conn.execute(_KNOWN, (KIND, since - GAP)).fetchall():
        known.setdefault(r["host"], []).append(r)

    found = []
    for iv in islands:
        board = boards.get(int(iv["board_id"])) if str(iv["board_id"]).isdigit() else None
        if not board or not board["host"]:
            continue
        start = iv["started_at"]
        for r in known.get(board["host"], []):
            if r["started_at"] < start and (r["ended_at"] is None or r["ended_at"] >= start - GAP):
                start = r["started_at"]
                break
        ongoing = iv["last_at"] == last_sample.get(board["id"]) and now - iv["last_at"] <= GAP
        end = now if ongoing else iv["last_at"]
        if end - start < THRESHOLD:
            continue
        detail = {"threshold_min": int(THRESHOLD.total_seconds() // 60),
                  "unsynced": bool(iv["unsynced"]),
                  "offset_max_s": round(iv["off_max"], 1) if iv["off_max"] is not None else None,
                  "offset_s": round(iv["off_last"], 1) if iv["off_last"] is not None else None}
        found.append({"host": board["host"], "board_id": board["id"], "board_name": board["name"],
                      "started_at": start, "ended_at": None if ongoing else iv["last_at"],
                      "detail": detail})
    return found, scopes


# --- Anlık tarama ------------------------------------------------------------------------------------------
# Çıktı "anahtar=değer" satırları; anomaly.scan bunları KIND'e göre ayırır. date en sonda: sunucu zamanıyla
# karşılaştırma için (SSH dönüşü kadar gecikme payı kalır).
PROBE = r"""
echo "ntp=$(timedatectl show -p NTP --value 2>/dev/null)"
echo "synced=$(timedatectl show -p NTPSynchronized --value 2>/dev/null)"
echo "can_ntp=$(timedatectl show -p CanNTP --value 2>/dev/null)"
echo "server=$(timedatectl show-timesync -p ServerName --value 2>/dev/null)"
echo "address=$(timedatectl show-timesync -p ServerAddress --value 2>/dev/null)"
echo "servers=$(timedatectl show-timesync -p SystemNTPServers --value 2>/dev/null)"
svc=; for s in systemd-timesyncd chrony chronyd ntp ntpsec openntpd; do
  [ "$(systemctl is-active "$s" 2>/dev/null)" = active ] && { svc=$s; break; }; done
echo "service=$svc"
echo "last_sync=$(stat -c %Y /var/lib/systemd/timesync/clock 2>/dev/null)"
echo "now=$(date +%s.%N)"
"""


def evaluate(values: dict, ctx: dict) -> dict:
    """PROBE çıktısı → {"anomaly": bool|None, "summary": str, "detail": {...}}.
    ctx: {"t0", "t1"} (SSH komutunun sunucudaki başlangıç/bitiş zamanı, epoch sn)."""
    ntp = values.get("ntp", "")
    synced = values.get("synced", "")
    if not ntp and not synced:
        return {"anomaly": None, "summary": "timedatectl yok; saat eşitleme durumu okunamadı", "detail": {}}
    detail = {"ntp": ntp == "yes", "synced": synced == "yes", "service": values.get("service") or None,
              "server": values.get("server") or None, "address": values.get("address") or None,
              "servers": values.get("servers") or None}
    offset = None
    try:
        board_now = float(values.get("now", ""))
        t0, t1 = ctx["t0"], ctx["t1"]
        # Tahtanın saati SSH süresince [t0, t1] aralığında olmalı; dışındaysa en yakın uca göre fark.
        offset = 0.0 if t0 - 1 <= board_now <= t1 + 1 else (board_now - t1 if board_now > t1 else board_now - t0)
        detail["offset_s"] = round(offset, 1)
    except (KeyError, ValueError):
        pass
    try:
        detail["last_sync"] = int(values.get("last_sync", ""))
    except ValueError:
        pass

    problems = []
    if ntp != "yes":
        problems.append("NTP eşitleme kapalı" + (" (hiç NTP servisi yok)" if not detail["service"] else ""))
    elif synced != "yes":
        problems.append("saat NTP sunucusuyla eşitlenmemiş")
    if offset is not None and abs(offset) > OFFSET_MAX:
        problems.append(f"saat sunucudan {abs(offset):.0f} sn {'ileri' if offset > 0 else 'geri'}")
    where = detail["server"] or detail["servers"] or ""
    if problems:
        summary = "; ".join(problems)
        summary = summary[0].upper() + summary[1:]
        if detail["service"]:
            summary += f" — {detail['service']}" + (f", sunucu: {where}" if where else "")
        return {"anomaly": True, "summary": summary, "detail": detail}
    summary = "Eşitli" + (f" — {detail['server']}" if detail["server"] else "") + \
        (f" ({detail['service']})" if detail["service"] else "")
    return {"anomaly": False, "summary": summary, "detail": detail}
