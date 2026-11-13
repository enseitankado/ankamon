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

"""Anomali: elektrik kesintisi / fişten çekme — cihaz işletim sistemi kapatmadan güçsüz kaldı.

Kullanıcılar bazen cihazı fişini çekerek (ya da priz anahtarından) kapatıyor (kullanıcı isteği 2026-11-13). Her açılış
(yeniden açılan cihaz) için önceki çalışmanın nasıl bittiği üç kaynaktan değerlendirilir:

  1. Ankamon'a gelen loglar: düzenli kapanışta logind "System is powering down / rebooting", "The system will power
     off / reboot now!", "Powering off..." ya da rsyslogd "exiting on signal" gönderilir. Önceki açılıştan (rsyslogd
     "start") bu açılışa kadar bunların hiçbiri yoksa kapanış ANİDİR. (Kullanıcı oturumu yöneticisinin "Reached target
     shutdown.target" satırı her oturum kapanışında gelir, sistem kapanışı değildir — sayılmaz. Açılışta EFI
     bölümünün "FAT-fs … Volume was not properly unmounted" uyarısı ise bu tahtalarda HER açılışta geliyor — kanıt değil.)
  2. Cihazın kendi journal'ı (power_probe yoklaması, göç 055): önceki açılışın kapanış izi ve son satırının zamanı —
     kesinti anı (session_probe 30 sn'de bir sshd satırı yazdırdığından ~30 sn hassasiyet).
  3. Sistem diskinin SMART ani güç kaybı sayacı: bu açılışta ve bir önceki yoklanan açılışta okunan değerin farkı.
     ETAP'ın "Zorla kapat" düğmesi ve eta-shutdown otomatik kapanması (poweroff -f) de journal'da iz bırakmaz; ama
     işletim sistemi diski durdurduğundan sayaç ARTMAZ. Fiş çekilince ya da elektrik kesilince artar. Bu yüzden:
       sayaç arttı → kesin ("SMART ile teyit edildi");  sayaç artmadı → anomali değil (işletim sistemi kapattı).
     SMART farkı bilinemiyorsa (disk sayaç sunmuyor ya da önceki ölçüm yok) kayıt "olası" yazılır — ancak cihazın
     eta-shutdown ayarı (saatli ya da boşta otomatik kapanma) kapanışı açıklayabiliyorsa yazılmaz (session_end ile
     aynı ölçüt; tahtalarda 20 dk boşta kapanma yaygın, aksi halde çoğu kayıt yanlış alarm olurdu).

Kayıt: started_at = kesinti anı (journal'ın son satırı, yoksa sunucuya gelen son log), ended_at = yeniden açılış.
Toplu kesinti (aynı bina/katta birden çok cihaz) bu kayıtlardan ayrıca türetilir (bkz. power_outage_area.py).
"""

from __future__ import annotations

import datetime

KIND = "power_loss"
EVERY = 300
WINDOW = datetime.timedelta(hours=6)       # her turda yeniden değerlendirilen açılışlar (yoklama dakikalar içinde gelir)
PAD = datetime.timedelta(hours=2)          # pencere öncesi olay taraması (önceki açılış bulunamazsa _BEFORE)
HISTORY = datetime.timedelta(days=7)          # ilk çalışmada geriye dönük tarama sınırı
LOOKBACK = datetime.timedelta(days=14)        # önceki açılışı/ölçümü bulmak için geriye bakış
MATCH = datetime.timedelta(minutes=3)         # logdaki açılış ile yoklamanın açılış anı eşleşme payı
PROBE_WAIT = datetime.timedelta(minutes=20)   # yeni açılışın yoklaması bu kadar beklenir (SMART teyidi gelsin)
_EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)

_DEVICES = """
SELECT id, lower(hostname) AS host, host(ip) AS ip, COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name
FROM devices WHERE hostname IS NOT NULL AND hostname <> ''
"""

# Açılışlar ve düzenli kapanış izleri (pahalı ifadeler program süzgecinden sonra — MATERIALIZED).
_EVENT_FILTER = """
WHERE (program = 'rsyslogd' AND (message LIKE '[origin%%] start' OR message LIKE '%%exiting on signal%%'))
   OR (program = 'systemd-logind' AND (message LIKE 'System is powering down%%' OR message LIKE 'System is rebooting%%'
       OR message LIKE 'The system will %%' OR message LIKE 'Powering off%%'))
"""
_EVENT_COLUMNS = """SELECT host AS raw_host, lower(host) AS host, from_ip, device_time, received_at,
       (program = 'rsyslogd' AND message LIKE '[origin%%] start') AS boot FROM l"""

_EVENTS = f"""
WITH l AS MATERIALIZED (
    SELECT host, from_ip, device_time, received_at, program, message FROM logs
    WHERE received_at >= %(from)s AND device_time IS NOT NULL AND host <> '' AND from_ip IS NOT NULL
      AND program IN ('rsyslogd', 'systemd-logind')
)
{_EVENT_COLUMNS} {_EVENT_FILTER}
ORDER BY 2, 3, 4
"""

# Penceredeki ilk açılıştan öncesi, iki adımda (tek cihaz, (host, received_at) dizini geriye doğru): önce önceki açılış
# (LIMIT 1 — ilk eşleşmede durur), sonra yalnız o açılıştan pencereye kadar olan olaylar. Tek sorguda LIMIT, seyrek
# eşleşmede 14 günün tamamını tarıyordu (~0,7 sn/cihaz).
_PREV_BOOT = """
SELECT received_at FROM logs
WHERE host = %(host)s AND received_at >= %(r0)s AND received_at < %(r1)s AND from_ip = %(ip)s
  AND program = 'rsyslogd' AND message LIKE '[origin%%] start'
ORDER BY received_at DESC LIMIT 1
"""

# Açılış adayları: cihazın açık aralıklarının başları (device_uptime — açılışta ya da 15 dk sessizlikten sonra başlar).
# Her adayın çevresi dar aralıkla sorulur: logs'un 14 günlük taraması gerekmez.
_UPTIME_STARTS = """
SELECT started_at FROM device_uptime
WHERE host = %(host)s AND started_at >= %(r0)s AND started_at < %(r1)s
ORDER BY started_at DESC LIMIT 8
"""
_AROUND = datetime.timedelta(minutes=10)

_BEFORE = """
SELECT host AS raw_host, lower(host) AS host, from_ip, device_time, received_at,
       (program = 'rsyslogd' AND message LIKE '[origin%%] start') AS boot
FROM logs
WHERE host = %(host)s AND received_at >= %(r0)s AND received_at < %(r1)s
  AND from_ip = %(ip)s AND device_time IS NOT NULL AND (
    (program = 'rsyslogd' AND (message LIKE '[origin%%] start' OR message LIKE '%%exiting on signal%%'))
 OR (program = 'systemd-logind' AND (message LIKE 'System is powering down%%' OR message LIKE 'System is rebooting%%'
     OR message LIKE 'The system will %%' OR message LIKE 'Powering off%%')))
ORDER BY received_at DESC
"""

# Kesintiden önce cihazın ürettiği son log (journal yoksa kesinti anı).
_LAST_LOG = """
SELECT max(device_time) AS at FROM logs
WHERE host = %(host)s AND from_ip = %(ip)s AND received_at BETWEEN %(r0)s AND %(r1)s
  AND device_time > %(d0)s AND device_time < %(d1)s
"""

_PROBES = """
SELECT device_id, boot_id, booted_at, first_probed_at, power_cycles, unsafe_shutdowns, unsafe_attr, disk_model, disk_serial,
       prev_started_at, prev_ended_at, prev_clean, prev_last_line, eta_shutdown
FROM device_power_probes WHERE booted_at >= %s ORDER BY device_id, booted_at
"""

# session_end'in netleştirdiği oturum kapanışı (ETAP otomatik kapanma) kesinti anına denk geliyorsa.
_AUTO_SESSION = """
SELECT end_reason FROM device_sessions
WHERE device_id = %s AND end_reason IN ('auto_idle', 'auto_timed', 'shutdown', 'reboot')
  AND ended_at BETWEEN %s AND %s LIMIT 1
"""


def _span(delta: datetime.timedelta) -> str:
    minutes = max(0, int(delta.total_seconds() // 60))
    parts = []
    for size, unit in ((1440, "gün"), (60, "saat"), (1, "dk")):
        n, minutes = divmod(minutes, size)
        if n:
            parts.append(f"{n} {unit}")
    return " ".join(parts) or "1 dk'dan kısa"


def _int(conf: dict, key: str, default: int = 0) -> int:
    try:
        return int(conf.get(key, default))
    except (TypeError, ValueError):
        return default


def eta_explains(conf: dict, run_start, cut, tz) -> str | None:
    """eta-shutdown ayarı bu kapanışı açıklayabilir mi (bkz. tasks/session_end.classify)? → açıklama ya da None."""
    conf = conf or {}
    if conf.get("AUTO_SHUTDOWN.enabled") == "true":
        local = cut.astimezone(tz)
        at = local.replace(hour=_int(conf, "AUTO_SHUTDOWN.hour") % 24, minute=_int(conf, "AUTO_SHUTDOWN.minute") % 60,
                           second=0, microsecond=0)
        if -120 <= (local - at).total_seconds() <= 4 * 3600:
            return f"ETAP saatli otomatik kapanma ({at:%H:%M})"
    if conf.get("TIMED_MODE.mode") == "shutdown" and run_start is not None:
        idle = max(5, _int(conf, "TIMED_MODE.hour") * 60 + _int(conf, "TIMED_MODE.minute"))
        if (cut - run_start).total_seconds() >= idle * 60 - 90:
            return f"ETAP boşta otomatik kapanma ({idle} dk)"
    return None


def _smart_delta(probe, baseline):
    """→ (artış, açılış farkı, metin) ya da None (karşılaştırılamaz)."""
    if not probe or not baseline:
        return None
    s1, s0 = probe.get("disk_serial"), baseline.get("disk_serial")
    if s1 and s0 and s1 != s0:
        return None   # başka disk: disk değişmiş ya da ölçüm eski IP'deki başka cihazdan (bkz. göç 056)
    u1, u0 = probe["unsafe_shutdowns"], baseline["unsafe_shutdowns"]
    if u1 is None or u0 is None or probe["unsafe_attr"] != baseline["unsafe_attr"] or u1 < u0:
        return None   # sayaç yok, disk değişmiş ya da sayaç sıfırlanmış
    c1, c0 = probe["power_cycles"], baseline["power_cycles"]
    cycles = c1 - c0 if c1 is not None and c0 is not None and c1 >= c0 else None
    return u1 - u0, cycles, f"SMART {probe['unsafe_attr']}: {u0} → {u1}"


def _boots(rows, devices_by_key, devices_by_host):
    """Log satırları → {device_id: [{"at", "received", "prev_at", "prev_received", "clean", "host", "ip"}]}."""
    out: dict = {}
    current = None
    prev_boot, markers = None, False
    for r in rows:
        key = (r["host"], r["from_ip"])
        if key != current:
            current, prev_boot, markers = key, None, False
        if not r["boot"]:
            markers = True
            continue
        device = devices_by_key.get(key) or devices_by_host.get(r["host"])
        if device and prev_boot is not None:
            out.setdefault(device["id"], []).append({
                "at": r["device_time"], "received": r["received_at"], "prev_at": prev_boot["device_time"],
                "prev_received": prev_boot["received_at"], "clean": markers, "host": r["host"], "ip": r["from_ip"]})
        prev_boot, markers = r, False
    return out


def _event_rows(conn, since):
    """Pencere (since − PAD) olayları; her (ad, IP) için pencerenin ilk açılışından önceki açılış ve aradaki kapanış
    izleri ayrıca (yalnız o cihazın satırları) eklenir — her turda LOOKBACK kadar log taranmasın diye."""
    start = since - PAD
    groups: dict = {}
    for r in conn.execute(_EVENTS, {"from": start}).fetchall():
        groups.setdefault((r["host"], r["from_ip"]), []).append(r)
    rows = []
    for key, events in groups.items():
        first_boot = next((e for e in events if e["boot"]), None)
        if first_boot is not None and first_boot["received_at"] >= since:
            args = {"host": first_boot["raw_host"], "ip": key[1], "r0": start - LOOKBACK, "r1": start}
            prev = None
            for u in conn.execute(_UPTIME_STARTS, args).fetchall():
                prev = conn.execute(_PREV_BOOT, dict(args, r0=u["started_at"] - _AROUND,
                                                     r1=min(start, u["started_at"] + _AROUND))).fetchone()
                if prev:
                    break
            before = []
            if prev is None:
                rows.extend(events)
                continue
            for e in conn.execute(_BEFORE, dict(args, r0=prev["received_at"])).fetchall():
                before.append(e)
                if e["boot"]:
                    break
            rows.extend(sorted(before, key=lambda e: e["device_time"]))
        rows.extend(events)
    rows.sort(key=lambda e: (e["host"], e["from_ip"], e["device_time"]))
    return rows


def detect(conn, since):
    now = conn.execute("SELECT now() AS now").fetchone()["now"]
    tz = now.tzinfo
    since = max(since, now - HISTORY)
    devices = conn.execute(_DEVICES).fetchall()
    by_id = {d["id"]: d for d in devices}
    by_key = {(d["host"], d["ip"]): d for d in devices}
    hosts: dict = {}
    for d in devices:
        hosts.setdefault(d["host"], []).append(d)
    # Aynı adı taşıyan birden çok kayıt (kalıp kopyası) varsa yalnız ad+IP eşleşmesi sayılır.
    by_host = {h: ds[0] for h, ds in hosts.items() if len(ds) == 1}

    log_boots = _boots(_event_rows(conn, since), by_key, by_host)
    probes: dict = {}
    for p in conn.execute(_PROBES, (since - LOOKBACK,)).fetchall():
        probes.setdefault(p["device_id"], []).append(p)

    fleet_conf = _fleet_conf(conn)
    found, scopes = [], []
    for device_id in set(log_boots) | set(probes):
        device = by_id.get(device_id)
        if not device:
            continue
        dev_probes = probes.get(device_id, [])
        events = []   # (açılış anı, log kaydı|None, yoklama|None)
        used = set()
        for b in log_boots.get(device_id, []):
            match = next((p for p in dev_probes if abs(p["booted_at"] - b["at"]) <= MATCH), None)
            if match:
                used.add(match["boot_id"])
            events.append((b["at"], b, match))
        for p in dev_probes:
            if p["boot_id"] not in used and p["prev_clean"] is not None:
                events.append((p["booted_at"], None, p))
        cuts = []
        for at, b, p in sorted(events, key=lambda e: e[0]):
            if at < since:
                continue
            record = _evaluate(conn, device, at, b, p, dev_probes, now, tz, fleet_conf)
            if record == "wait":
                continue
            if record:
                cuts.append(record["started_at"])
                found.append(record)
            elif b:
                cuts.append(b["prev_at"])      # eski kaydı (artık anomali değilse) silinebilsin
            elif p and p["prev_started_at"]:
                cuts.append(p["prev_started_at"])
        scopes.append((device["host"], min(cuts + [since]), now))
    return found, scopes


def _evaluate(conn, device, at, b, p, dev_probes, now, tz, fleet_conf=None):
    """Tek açılış → kayıt, None (anomali değil / bilinmiyor) ya da "wait" (yoklama bekleniyor)."""
    if (b and b["clean"]) or (p and p["prev_clean"]):
        return None   # düzenli kapanış izi var
    log_unclean = b is not None
    journal_unclean = p is not None and p["prev_clean"] is False
    if not log_unclean and not journal_unclean:
        return None
    if p is None and now - at < PROBE_WAIT:
        return "wait"
    baseline = None
    if p is not None:
        older = [q for q in dev_probes if q["booted_at"] < p["booted_at"] - MATCH]
        baseline = older[-1] if older else None
    delta = _smart_delta(p, baseline)

    # Kesinti anı ve önceki çalışmanın başı.
    cut, cut_source = None, None
    if journal_unclean and p["prev_ended_at"]:
        cut, cut_source = p["prev_ended_at"], "journal"
    elif b:
        cut = conn.execute(_LAST_LOG, {"host": b["host"], "ip": b["ip"], "r0": b["prev_received"],
                                       "r1": b["received"] + datetime.timedelta(minutes=15),
                                       "d0": b["prev_at"], "d1": b["at"] - datetime.timedelta(seconds=2)}).fetchone()["at"]
        cut_source = "log"
    if cut is None or cut >= at:
        return None
    run_start = (p["prev_started_at"] if p and p["prev_started_at"] else None) or (b["prev_at"] if b else None)

    sources = []
    if log_unclean:
        sources.append("Ankamon'a kapanış logu gelmedi")
    if journal_unclean:
        sources.append("cihaz günlüğü kapanış izi olmadan bitti"
                       + (f" (son satır: {p['prev_last_line'][:80]})" if p["prev_last_line"] else ""))
    detail = {"cut_source": cut_source, "log_unclean": log_unclean, "journal_unclean": journal_unclean,
              "booted_at": at, "off_min": int((at - cut).total_seconds() // 60)}
    if delta is not None:
        increase, cycles, smart_text = delta
        detail.update(smart_increase=increase, smart_cycles=cycles, smart_attr=p["unsafe_attr"],
                      smart_before=baseline["unsafe_shutdowns"], smart_after=p["unsafe_shutdowns"])
        if increase == 0:
            return None   # disk düzgün durduruldu: işletim sistemi kapattı (ETAP zorla/otomatik kapatma)
        confirm = "smart"
        head = "Elektrik kesildi ya da fiş çekildi (SMART ile teyit edildi)"
        sources.append(smart_text + (f" — arada {cycles} açılış" if cycles and cycles > 1 else ""))
    else:
        why = ("disk ani güç kaybı sayacı sunmuyor" if p and p["unsafe_shutdowns"] is None
               else "önceki SMART ölçümü yok" if p else "cihaz bu açılışta yoklanamadı")
        # Cihazın eta-shutdown ayarı (bilinmiyorsa — hiç yoklanmadıysa — filoda en yaygın olanı: ETAP imajı aynı).
        conf = (p or _latest(dev_probes) or {}).get("eta_shutdown") or fleet_conf or {}
        explained = eta_explains(conf, run_start, cut, tz)
        if explained:
            return None   # SMART'sız ayırt edilemez: ETAP'ın kendi otomatik kapanması olabilir
        if conn.execute(_AUTO_SESSION, (device["id"], cut - datetime.timedelta(minutes=5), at)).fetchone():
            return None
        confirm = "log"
        head = f"Ani kapanma — olası elektrik kesintisi / fişten çekme (SMART teyidi yok: {why})"
        detail["smart_missing"] = why
    detail.update(confirm=confirm, sources=sources,
                  text=f"{head} · {_span(at - cut)} kapalı kaldı · " + "; ".join(sources))
    return {"host": device["host"], "device_id": device["id"], "device_name": device["name"],
            "started_at": cut, "ended_at": at, "detail": detail}


_FLEET_CONF = """
SELECT eta_shutdown, count(*) AS n FROM (
    SELECT DISTINCT ON (device_id) eta_shutdown FROM device_power_probes ORDER BY device_id, probed_at DESC) x
WHERE eta_shutdown <> '{}'::jsonb GROUP BY 1 ORDER BY 2 DESC LIMIT 1
"""


def _fleet_conf(conn) -> dict:
    row = conn.execute(_FLEET_CONF).fetchone()
    return row["eta_shutdown"] if row else {}


def _latest(dev_probes):
    return dev_probes[-1] if dev_probes else None


# --- Anlık tarama (bkz. anomaly.scan): önceki açılışın nasıl bittiği ve SMART sayacı (kayıtlı son ölçümle fark). ---
from ..executor import power_probe as _probe  # noqa: E402

PROBE = _probe.SCRIPT

_LAST_STORED = """
SELECT unsafe_shutdowns, unsafe_attr, power_cycles, booted_at, disk_serial FROM device_power_probes
WHERE device_id = %s AND boot_id <> %s ORDER BY booted_at DESC LIMIT 1
"""


def evaluate(values: dict, ctx: dict) -> dict:
    rec = _probe.parse("\n".join(f"{k}={v}" for k, v in values.items()))
    if not rec:
        return {"anomaly": None, "summary": "Açılış bilgisi okunamadı", "detail": {}}
    parts, anomaly = [], False
    if rec["prev_clean"] is None:
        parts.append("önceki açılışın günlüğü yok")
    elif rec["prev_clean"]:
        parts.append("önceki açılış düzenli kapandı")
    else:
        anomaly = None   # iz yok: elektrik kesintisi ya da ETAP zorla/otomatik kapatma — SMART ayırır
        parts.append("önceki açılış kapanış izi olmadan bitti")
    if rec["unsafe_shutdowns"] is None:
        parts.append("disk ani güç kaybı sayacı sunmuyor")
    else:
        parts.append(f"SMART {rec['unsafe_attr']} = {rec['unsafe_shutdowns']} (açılış sayısı {rec['power_cycles']})")
        # Runner taramada iş hedefini verir (anahtar "device_id"); "id" de kabul (2026-11-13: yalnız "id" aranıyordu,
        # karşılaştırma hiç yapılmıyor, fişten çekilen cihaz taramada «bilinmiyor» kalıyordu).
        device = ctx.get("device") or {}
        device_id = device.get("device_id") or device.get("id")
        last = None
        if ctx.get("conn") is not None and device_id:
            last = ctx["conn"].execute(_LAST_STORED, (device_id, rec["boot_id"])).fetchone()
        comparable = (last and last["unsafe_shutdowns"] is not None and last["unsafe_attr"] == rec["unsafe_attr"]
                      and rec["unsafe_shutdowns"] >= last["unsafe_shutdowns"]
                      and not (last["disk_serial"] and rec["disk_serial"] and last["disk_serial"] != rec["disk_serial"]))
        if comparable:
            inc = rec["unsafe_shutdowns"] - last["unsafe_shutdowns"]
            parts.append(f"önceki ölçümden ({last['booted_at']:%d.%m %H:%M} açılışı) beri {inc} ani güç kaybı")
            if rec["prev_clean"] is False:
                anomaly = inc > 0
                parts.insert(0, "Elektrik kesildi ya da fiş çekildi (SMART ile teyit edildi)" if inc > 0
                             else "İşletim sistemi kapattı (ETAP zorla/otomatik kapatma) — fiş çekilmedi")
        elif rec["prev_clean"] is False:
            parts.append("karşılaştırılacak önceki SMART ölçümü yok")
    return {"anomaly": anomaly, "summary": "; ".join(parts), "detail": rec}
