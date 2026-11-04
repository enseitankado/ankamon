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

"""Anomali: tahta açıkken ağ bağlantısı koptu (ağ kablosu çıkarıldı, ağ anahtarı/port kesildi).

Tahta kopukken log gönderemez; kopukluk bağlantı geri gelince, tahtanın gönderdiği loglardan anlaşılır:
  - Tahtanın rsyslog'u (TiHA, 90-tiha-remote.conf) iletemediği logları diskte kuyruğa alır, bağlantı gelince topluca
    yollar. Bu loglar tahtanın saatiyle (device_time) üretildikleri ana göre geç gelir: tahta o aralıkta AÇIKTI ve
    sunucuya ulaşamadı.
  - Aynı aralıkta Ankamon da tahtadan sensör verisi alamadıysa (tarama sunucudan IP ile yapılır) sorun log yolunda
    (ör. istiklal.local ad çözümü) değil tahtanın ağ bağlantısındadır.
  - Diğer tahtaların logları zamanında geliyorduysa sorun sunucuda ya da bütün ağda değildir.
  - NetworkManager/çekirdek taşıyıcı satırı (carrier, "Link is Down") geldiyse kablo çıkarıldığı kesindir. Bu satırlar
    TiHA'nın bakım profilinde iletilmez, çoğu tahtada yoktur: o durumda kayıt "kablo ya da port" olasılığıyla yazılır.

Sınırlar: kopukluk sürerken saptanamaz (tahta kapalıdan ayırt edilmez), bağlantı gelince geriye dönük yazılır. Arada
tahta yeniden açıldıysa (rsyslog başlangıç satırı) yalnız açılıştan önceki, logla kanıtlı kısım sayılır. Aynı kalıptan
kurulmuş tahtalar ilk açılışta kalıbın adıyla log gönderebilir: tahta yalnız adı VE IP'si kayıtla eşleşince sayılır.
"""

import datetime

KIND = "net_link_lost"
LATE = 120                                  # sn: tahtanın olağan saat farkının üstünde bu kadar geç gelen log kuyruktan gelmiştir
FLUSH_GAP = datetime.timedelta(seconds=120) # kuyruk boşaltması: ardışık geç loglar arasında bundan uzun ara yoksa tek boşaltma
THRESHOLD = datetime.timedelta(minutes=5)
SCRAPED_MAX = 0.2                           # aralığın en çok bu kadarında sensör verisi alındıysa tahta erişilebilirdi: sayılmaz
WINDOW = datetime.timedelta(hours=6)

_BURSTS = """
WITH l AS (
    SELECT host, from_ip, received_at, device_time, extract(epoch FROM received_at - device_time) AS lag
    FROM logs WHERE received_at >= %(since)s AND device_time IS NOT NULL AND host <> '' AND from_ip IS NOT NULL
), base AS (       -- tahtanın olağan farkı (saat kayması dahil): zamanında gelen logların alt dilimi
    SELECT host, from_ip, percentile_cont(0.1) WITHIN GROUP (ORDER BY lag) AS off FROM l GROUP BY host, from_ip
), late AS (
    SELECT l.* FROM l JOIN base b USING (host, from_ip) WHERE l.lag - b.off > %(late)s
), g AS (
    SELECT *, sum(CASE WHEN prev IS NULL OR received_at - prev > %(gap)s THEN 1 ELSE 0 END)
                OVER (PARTITION BY host, from_ip ORDER BY received_at) AS grp
    FROM (SELECT *, lag(received_at) OVER (PARTITION BY host, from_ip ORDER BY received_at) AS prev FROM late) x
)
SELECT host, from_ip, min(received_at) AS delivered, min(device_time) AS first_dev, max(device_time) AS last_dev, count(*) AS n
FROM g GROUP BY host, from_ip, grp ORDER BY host, from_ip, min(received_at)
"""

_BOARDS = """
SELECT id, lower(hostname) AS host, host(ip) AS ip, monitor_enabled,
       COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name
FROM boards WHERE hostname IS NOT NULL AND hostname <> '' AND ip IS NOT NULL
"""

# Kopukluktan önce zamanında gelen son log (yoksa tahta Ankamon'a yeni yönlendirilmiştir: ilk temas, kopukluk değil).
_LAST_OK = """
SELECT max(received_at) AS at FROM logs
WHERE host = %(host)s AND from_ip = %(ip)s AND received_at <= %(first)s + interval '60 seconds'
  AND received_at > %(first)s - interval '7 days'
"""

# Aralıkta zamanında gelen log: bağlantı çalışıyordu (geç gelenler eski kuyruğun yeniden gönderimidir).
_DELIVERED_MEANWHILE = """
SELECT count(*) AS n FROM logs
WHERE host = %(host)s AND from_ip = %(ip)s AND received_at > %(first)s + interval '60 seconds'
  AND received_at < %(delivered)s - interval '5 seconds'
"""

_BOOT = """
SELECT min(device_time) AS at FROM logs
WHERE host = %(host)s AND from_ip = %(ip)s AND program = 'rsyslogd' AND message LIKE '%%] start'
  AND device_time > %(s)s AND device_time <= %(e)s
"""

_SCRAPED = """
SELECT count(DISTINCT date_trunc('minute', m.time)) AS n
FROM metrics m JOIN metrics_tag t USING (tag_id)
WHERE t.board_id = %(board)s AND t.name = 'node_boot_time_seconds' AND m.time BETWEEN %(s)s AND %(e)s
"""

# Sunucu o aralıkta başka tahtalardan log ya da sensör verisi alıyordu (sunucu ya da bütün ağ kapalı değildi).
_OTHERS = """
SELECT (SELECT count(DISTINCT host) FROM logs WHERE received_at BETWEEN %(s)s AND %(e)s AND host <> %(host)s)
     + (SELECT count(DISTINCT t.board_id) FROM metrics m JOIN metrics_tag t USING (tag_id)
        WHERE t.name = 'node_boot_time_seconds' AND m.time BETWEEN %(s)s AND %(e)s AND t.board_id <> %(board)s) AS n
"""

_CARRIER = """
SELECT device_time, program, message FROM logs
WHERE host = %(host)s AND from_ip = %(ip)s AND device_time BETWEEN %(s)s AND %(e)s
  AND (message ~ 'carrier: link (dis)?connected' OR message ~ 'reason ''carrier-changed''' OR message ~ 'Link is (Down|Up)')
  AND message !~ '(wlp|wlan|p2p-dev)'
ORDER BY device_time
"""


def _fmt(at) -> str:
    return at.strftime("%d.%m %H:%M")


def _minutes(delta) -> int:
    return max(1, int(delta.total_seconds() // 60))


def detect(conn, since):
    boards = {}
    for r in conn.execute(_BOARDS).fetchall():
        boards[(r["host"], r["ip"])] = r
    found, scopes, seen = [], [], set()
    previous = None
    for b in conn.execute(_BURSTS, {"since": since, "late": LATE, "gap": FLUSH_GAP}).fetchall():
        board = boards.get(((b["host"] or "").lower(), b["from_ip"]))
        if not board:
            continue   # kayıtsız ad ya da kalıbın adını taşıyan başka tahta
        key = (board["host"], b["from_ip"])
        if key not in seen:
            seen.add(key)
            scopes.append((board["host"], since, b["delivered"]))
        args = {"host": b["host"], "ip": b["from_ip"], "delivered": b["delivered"], "first": b["first_dev"]}
        last_ok = conn.execute(_LAST_OK, args).fetchone()["at"]
        # İlk temas ya da eski kuyruğun, bağlantı çalışırken yeniden gönderimi kopukluk değildir.
        if last_ok is None or conn.execute(_DELIVERED_MEANWHILE, args).fetchone()["n"]:
            continue
        start = b["first_dev"]
        boot = conn.execute(_BOOT, {**args, "s": start, "e": b["delivered"]}).fetchone()["at"]
        # Arada yeniden açıldıysa tahta bir süre kapalıydı: yalnız logla kanıtlı açık kısım.
        end = b["last_dev"] if boot else b["delivered"]
        if end - start < THRESHOLD:
            continue
        # Aynı kopukluğun ikinci kuyruk boşaltması öncekiyle birleşir.
        if previous and previous["key"] == key and start <= previous["end"] + FLUSH_GAP:
            previous["record"]["ended_at"] = max(previous["record"]["ended_at"], end)
            previous["end"] = previous["record"]["ended_at"]
            previous["record"]["detail"]["queued"] += b["n"]
            continue
        window = {"s": start, "e": end}
        if board["monitor_enabled"]:
            scraped = conn.execute(_SCRAPED, {**window, "board": str(board["id"])}).fetchone()["n"]
            if scraped > SCRAPED_MAX * _minutes(end - start):
                continue   # Ankamon tahtaya ulaşabiliyordu: gecikme log yolunda, ağ bağlantısında değil
        if conn.execute(_OTHERS, {**window, "host": b["host"], "board": str(board["id"])}).fetchone()["n"] == 0:
            continue       # hiçbir tahtanın logu zamanında gelmedi: sorun sunucuda ya da bütün ağda
        carrier = conn.execute(_CARRIER, {**args, "s": start - datetime.timedelta(minutes=5),
                                          "e": end + datetime.timedelta(minutes=15)}).fetchall()
        cable = bool(carrier)
        text = ("Ağ kablosu çıkarıldı (tahta taşıyıcı sinyalini kaybettiğini bildirdi)" if cable
                else "Ağ bağlantısı koptu: kablo çıkarılmış ya da ağ anahtarı/port kesilmiş olabilir")
        text += (f" · {_minutes(end - start)} dk ulaşılamadı; tahtada bekleyen {b['n']} log {_fmt(b['delivered'])}'de geldi"
                 + (" · arada tahta yeniden açıldı" if boot else ""))
        record = {"host": board["host"], "board_id": board["id"], "board_name": board["name"],
                  "started_at": start, "ended_at": end,
                  "detail": {"text": text, "cable": cable, "queued": b["n"], "last_ok": last_ok,
                             "delivered": b["delivered"], "rebooted": bool(boot),
                             "carrier": [f"{c['device_time']:%H:%M:%S} {c['message'][:120]}" for c in carrier[:4]]}}
        found.append(record)
        previous = {"key": key, "end": end, "record": record}
    return found, scopes


# Anlık tarama: kablolu arabirimlerin şu anki durumu ("ad:taşıyıcı:hız") ve son 7 günde NetworkManager günlüğündeki kablo
# kopmaları (tahtanın kendi günlüğü taşıyıcı satırlarını tutar; bunlar sunucuya iletilmiyor olabilir).
PROBE = r"""
links=
for d in /sys/class/net/*; do
  n=${d##*/}; [ -e "$d/device" ] || continue; [ -d "$d/wireless" ] && continue
  links="$links $n:$(cat $d/carrier 2>/dev/null):$(cat $d/speed 2>/dev/null)"
done
echo "links=$links"
c=$(journalctl -u NetworkManager --since "-7 days" -o short-iso --no-pager 2>/dev/null | grep -v -E 'wlp|wlan|p2p' | grep -E "carrier: link disconnected|-> unavailable \(reason 'carrier-changed'")
echo "drops=$(printf '%s' "$c" | grep -c .)"
echo "last=$(printf '%s\n' "$c" | tail -n 1 | cut -c1-25)"
"""


def evaluate(values: dict, ctx: dict) -> dict:
    links = []
    for item in (values.get("links") or "").split():
        name, _, rest = item.partition(":")
        carrier, _, speed = rest.partition(":")
        links.append({"iface": name, "carrier": carrier, "speed": int(speed) if speed.isdigit() else None})
    try:
        drops = int(values.get("drops") or 0)
    except ValueError:
        drops = 0
    detail = {"links": links, "drops_7d": drops, "last_drop": values.get("last") or None}
    if not links:
        return {"anomaly": None, "summary": "Kablolu ağ arabirimi bulunamadı", "detail": detail}
    up = [l for l in links if l["carrier"] == "1"]
    parts = [", ".join(f"{l['iface']} bağlı" + (f" ({l['speed']} Mbit/sn)" if l["speed"] else "") for l in up)
             if up else "Hiçbir kablolu arabirimde kablo takılı değil"]
    parts.append(f"son 7 günde {drops} kez kablo koptu (son: {detail['last_drop']})" if drops else "son 7 günde kablo kopması yok")
    return {"anomaly": bool(drops) or not up, "summary": "; ".join(parts), "detail": detail}
