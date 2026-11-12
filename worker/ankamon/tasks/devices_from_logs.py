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

"""Log gönderen cihazları envantere işler.

Cihazlar kendilerini log göndererek tanıtır: bilgisayar adı (TiHA'nın dinamik adı, ör. etap-1a2b3c)
kaydı bulmaya yarar, gönderen adres güncel IP'dir. Ağ bölümü değişse de kayıtlar kendiliğinden güncellenir.
Kalıcı kimlik MAC'tir; logdan açılan kayıt device_identity görevinde MAC'e bağlanır.

Yalnız zamanında teslim edilen loglar sayılır: cihaz bağlantısı kopukken kuyruğunda biriken loglar
o günkü (eski) bilgisayar adını taşır; onlar yeni kayıt açmamalı, IP'yi de değiştirmemeli (imajdan
klonlanan cihaz, kaynak cihazın kuyruğunu da taşıyıp kendi IP'sinden gönderebilir).

Cihazlar sunucunun BÜTÜN ağ bağdaştırıcılarından algılanır (kullanıcı isteği 2026-11-09 — önceden yalnız cihaz
ağından); cihaz olup olmadığına gönderen adresin MAC'i karar verir (bkz. netscan.devicemac — ARP tablosu, yoksa ağ
taraması):
  - Kayıtlı cihaz (bilgisayar adı eşleşir): IP yalnız gönderenin MAC'i cihazın kablolu/kablosuz MAC'iyle eşleşirse
    güncellenir; cihazın MAC'i kayıtlı değilse MAC bir cihaz MAC'iyse ya da cihaz "Bu bir akıllı tahtadır" diye
    işaretliyse (devices.smart_board). MAC henüz bilinmiyorsa yalnız cihaz ağından gelen kaynak güvenilir (eski kural).
    Böylece herhangi bir ağdan atılan sahte syslog paketi (başka MAC) bir cihazın IP'sini kendi adresine çevirip
    yönetim bağlantılarını (root parolasıyla SSH) üstüne çekemez.
  - Yeni kayıt: yalnız gönderenin MAC'i bir cihaz MAC'iyse (ETAP faz veritabanı / Vestel) açılır.
Cihaz olmayan kaynakların logları yine Loglar'da görünür.
"""

import ipaddress
import logging

from .. import activity, netroles
from ..netscan import devicemac, ifaces

log = logging.getLogger(__name__)

# Gerçek TiHA cihazları SYSLOG_PORT'a yalnız okul ağından (fiziksel LAN) ulaşır. Bu aralıklardan
# gelen trafik fiziksel bir cihaz OLAMAZ — konteynerin kendi döngü/bağlantısız/Docker köprü ağı
# adresleridir (ör. test betiklerinin konteyner içinden attığı sahte syslog — bkz. "screentest"
# vakası: IP 172.18.0.3, konteynerin kendi docker-compose köprü ağı). Bunlardan otomatik cihaz
# kaydı AÇILMAZ; elle "Ekle" ile kayıt admin'in sorumluluğundadır, buradan etkilenmez.
_FAKE_SOURCE_NETS = (
    ipaddress.ip_network("127.0.0.0/8"),      # loopback
    ipaddress.ip_network("169.254.0.0/16"),   # link-local
    ipaddress.ip_network("172.16.0.0/12"),    # Docker varsayılan köprü ağları havuzu
    ipaddress.ip_network("::1/128"),
)
# Bariz test/deneme kayıtları: hostname'i fiziksel cihaz adlandırma kuralına (etap-xxxxxx) uymasa
# da bu kelimeleri içeriyorsa otomatik açılmaz (ör. "screentest").
_SUSPECT_HOST_WORDS = ("test", "debug", "demo", "sample", "deneme", "örnek", "ornek")


def _looks_fake(host: str, ip: str | None) -> bool:
    if ip:
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            addr = None
        if addr is not None and any(addr in net for net in _FAKE_SOURCE_NETS):
            return True
    lowered = (host or "").lower()
    return any(word in lowered for word in _SUSPECT_HOST_WORDS)


RECENT = """
    SELECT host, max(from_ip) FILTER (WHERE from_ip ~ '^[0-9]{1,3}(\\.[0-9]{1,3}){3}$') AS ip,
           max(received_at) AS last_log_at
    FROM logs
    WHERE received_at > now() - interval '15 minutes' AND host <> ''
      AND device_time > received_at - interval '1 hour'
    GROUP BY host
"""


def _device_source(conn):
    """ip → cihaz ağından mı. Rol seçilmemişse (varsayılan) her kaynak kabul edilir (eski davranış)."""
    role = netroles.roles(conn)
    if not role["device_iface"] and not role["admin_iface"]:
        return lambda ip: True
    cidrs = netroles.device_cidrs(conn, ifaces.networks())

    def accept(ip: str | None) -> bool:
        if not ip:
            return True  # IP'siz kayıt IP değiştiremez (COALESCE); ad eşleşmesiyle güncellenir
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        return any(addr in net for net in cidrs)
    return accept


def _ip_trusted(device: dict, ip: str, mac: str | None, from_device_net) -> bool:
    """Kayıtlı cihazın IP'si bu kaynaktan güncellenebilir mi (bkz. modül başı)."""
    if mac:
        own = {m for m in (device["mac"], device["wifi_mac"]) if m}
        if own:
            return mac in own
        return device["smart_board"] or devicemac.is_device_mac(mac)
    return from_device_net(ip)


def run(conn) -> None:
    from_device_net = _device_source(conn)
    macs = devicemac.ip_macs(conn)
    devices = {r["host"]: r for r in conn.execute(
        """SELECT lower(hostname) AS host, id, mac::text AS mac, wifi_mac::text AS wifi_mac, smart_board
           FROM devices WHERE hostname IS NOT NULL""").fetchall()}
    for row in conn.execute(RECENT).fetchall():
        ip = row["ip"]
        mac = macs.get(ip) if ip else None
        device = devices.get((row["host"] or "").lower())
        if device:
            trusted = not ip or _ip_trusted(device, ip, mac, from_device_net)
            if not trusted:
                log.debug("IP güncellenmedi (MAC eşleşmiyor): %s %s (%s)", row["host"], ip, mac)
            conn.execute(
                """UPDATE devices SET ip = CASE WHEN %(trusted)s THEN COALESCE(%(ip)s::inet, ip) ELSE ip END,
                          last_log_at = %(last_log_at)s, updated_at = now() WHERE id = %(id)s""",
                dict(row, trusted=trusted, id=device["id"]),
            )
            continue
        device_mac = devicemac.is_device_mac(mac)
        # Bilgisayar adı değişmiş kayıtlı cihaz (TiHA dinamik adı): MAC'iyle bulunur, IP'si güncellenir (ad
        # device_identity görevinde bağlanır). Kayıtta bilgisayar adı HİÇ yoksa (ağ taramasıyla ya da elle açılmış kayıt —
        # device_identity yalnız MAC'siz kayıtları okur, bunlara hiç bakmaz) logdaki ad yazılır: yoksa Cihazlar listesinde
        # "Bilgisayar adı" sonsuza dek boş kalıyordu (kullanıcı bildirimi 2026-11-11). Ad varsa değiştirilmez.
        if mac and conn.execute(
                """UPDATE devices SET ip = %(ip)s::inet, last_log_at = %(last_log_at)s, updated_at = now(),
                          hostname = CASE WHEN %(fill)s THEN COALESCE(NULLIF(hostname, ''), %(host)s) ELSE hostname END
                   WHERE mac = %(mac)s::macaddr OR (wifi_mac = %(mac)s::macaddr AND NOT EXISTS (
                       SELECT 1 FROM devices x WHERE x.mac = %(mac)s::macaddr))""",
                dict(row, mac=mac, fill=bool(row["host"]) and not _looks_fake(row["host"], ip))).rowcount:
            continue
        # Elle (yalnız IP ile) eklenmiş kayıt varsa adını tamamla: kaynak o kaydın MAC'iyle ya da cihaz MAC'iyle.
        updated = 0
        if ip and (device_mac or (mac is None and from_device_net(ip))):
            updated = conn.execute(
                """UPDATE devices SET hostname = %(host)s, last_log_at = %(last_log_at)s, updated_at = now()
                   WHERE ip = %(ip)s::inet AND hostname IS NULL""",
                row,
            ).rowcount
        if updated:
            continue
        if not device_mac:
            log.debug("cihaz MAC'i olmayan log kaynağı (kayıt açılmadı): %s (%s, MAC %s)", row["host"], ip, mac or "bilinmiyor")
            continue
        if _looks_fake(row["host"], ip):
            log.info("şüpheli kaynak yok sayıldı (otomatik kayıt açılmadı): %s (%s)", row["host"], ip)
            continue
        conn.execute(
            """INSERT INTO devices (hostname, ip, mac, source, last_log_at)
               VALUES (%(host)s, %(ip)s::inet, %(mac)s::macaddr, 'syslog', %(last_log_at)s)
               ON CONFLICT DO NOTHING""",
            dict(row, mac=mac),
        )
        log.info("yeni cihaz: %s (%s, MAC %s)", row["host"], ip, mac)
        activity.record(conn, f"Yeni cihaz bulundu (log): {row['host']} ({ip or 'IP yok'}, MAC {mac})")
