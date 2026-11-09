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

"""Log gönderen tahtaları envantere işler.

Tahtalar kendilerini log göndererek tanıtır: bilgisayar adı (TiHA'nın dinamik adı, ör. etap-1a2b3c)
kaydı bulmaya yarar, gönderen adres güncel IP'dir. Ağ bölümü değişse de kayıtlar kendiliğinden güncellenir.
Kalıcı kimlik MAC'tir; logdan açılan kayıt board_identity görevinde MAC'e bağlanır.

Yalnız zamanında teslim edilen loglar sayılır: tahta bağlantısı kopukken kuyruğunda biriken loglar
o günkü (eski) bilgisayar adını taşır; onlar yeni kayıt açmamalı, IP'yi de değiştirmemeli (imajdan
klonlanan tahta, kaynak tahtanın kuyruğunu da taşıyıp kendi IP'sinden gönderebilir).

Tahtalar sunucunun BÜTÜN ağ bağdaştırıcılarından algılanır (kullanıcı isteği 2026-11-09 — önceden yalnız tahta
ağından); tahta olup olmadığına gönderen adresin MAC'i karar verir (bkz. netscan.boardmac — ARP tablosu, yoksa ağ
taraması):
  - Kayıtlı tahta (bilgisayar adı eşleşir): IP yalnız gönderenin MAC'i tahtanın kablolu/kablosuz MAC'iyle eşleşirse
    güncellenir; tahtanın MAC'i kayıtlı değilse MAC bir tahta MAC'iyse ya da tahta "Bu bir akıllı tahtadır" diye
    işaretliyse (boards.smart_board). MAC henüz bilinmiyorsa yalnız tahta ağından gelen kaynak güvenilir (eski kural).
    Böylece herhangi bir ağdan atılan sahte syslog paketi (başka MAC) bir tahtanın IP'sini kendi adresine çevirip
    yönetim bağlantılarını (root parolasıyla SSH) üstüne çekemez.
  - Yeni kayıt: yalnız gönderenin MAC'i bir tahta MAC'iyse (ETAP faz veritabanı / Vestel) açılır.
Tahta olmayan kaynakların logları yine Loglar'da görünür.
"""

import ipaddress
import logging

from .. import activity, netroles
from ..netscan import boardmac, ifaces

log = logging.getLogger(__name__)

# Gerçek TiHA tahtaları SYSLOG_PORT'a yalnız okul ağından (fiziksel LAN) ulaşır. Bu aralıklardan
# gelen trafik fiziksel bir tahta OLAMAZ — konteynerin kendi döngü/bağlantısız/Docker köprü ağı
# adresleridir (ör. test betiklerinin konteyner içinden attığı sahte syslog — bkz. "screentest"
# vakası: IP 172.18.0.3, konteynerin kendi docker-compose köprü ağı). Bunlardan otomatik tahta
# kaydı AÇILMAZ; elle "Ekle" ile kayıt admin'in sorumluluğundadır, buradan etkilenmez.
_FAKE_SOURCE_NETS = (
    ipaddress.ip_network("127.0.0.0/8"),      # loopback
    ipaddress.ip_network("169.254.0.0/16"),   # link-local
    ipaddress.ip_network("172.16.0.0/12"),    # Docker varsayılan köprü ağları havuzu
    ipaddress.ip_network("::1/128"),
)
# Bariz test/deneme kayıtları: hostname'i fiziksel tahta adlandırma kuralına (etap-xxxxxx) uymasa
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


def _board_source(conn):
    """ip → tahta ağından mı. Rol seçilmemişse (varsayılan) her kaynak kabul edilir (eski davranış)."""
    role = netroles.roles(conn)
    if not role["board_iface"] and not role["admin_iface"]:
        return lambda ip: True
    cidrs = netroles.board_cidrs(conn, ifaces.networks())

    def accept(ip: str | None) -> bool:
        if not ip:
            return True  # IP'siz kayıt IP değiştiremez (COALESCE); ad eşleşmesiyle güncellenir
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        return any(addr in net for net in cidrs)
    return accept


def _ip_trusted(board: dict, ip: str, mac: str | None, from_board_net) -> bool:
    """Kayıtlı tahtanın IP'si bu kaynaktan güncellenebilir mi (bkz. modül başı)."""
    if mac:
        own = {m for m in (board["mac"], board["wifi_mac"]) if m}
        if own:
            return mac in own
        return board["smart_board"] or boardmac.is_board_mac(mac)
    return from_board_net(ip)


def run(conn) -> None:
    from_board_net = _board_source(conn)
    macs = boardmac.ip_macs(conn)
    boards = {r["host"]: r for r in conn.execute(
        """SELECT lower(hostname) AS host, id, mac::text AS mac, wifi_mac::text AS wifi_mac, smart_board
           FROM boards WHERE hostname IS NOT NULL""").fetchall()}
    for row in conn.execute(RECENT).fetchall():
        ip = row["ip"]
        mac = macs.get(ip) if ip else None
        board = boards.get((row["host"] or "").lower())
        if board:
            trusted = not ip or _ip_trusted(board, ip, mac, from_board_net)
            if not trusted:
                log.debug("IP güncellenmedi (MAC eşleşmiyor): %s %s (%s)", row["host"], ip, mac)
            conn.execute(
                """UPDATE boards SET ip = CASE WHEN %(trusted)s THEN COALESCE(%(ip)s::inet, ip) ELSE ip END,
                          last_log_at = %(last_log_at)s, updated_at = now() WHERE id = %(id)s""",
                dict(row, trusted=trusted, id=board["id"]),
            )
            continue
        board_mac = boardmac.is_board_mac(mac)
        # Bilgisayar adı değişmiş kayıtlı tahta (TiHA dinamik adı): MAC'iyle bulunur, IP'si güncellenir (ad
        # board_identity görevinde bağlanır).
        if mac and conn.execute(
                """UPDATE boards SET ip = %(ip)s::inet, last_log_at = %(last_log_at)s, updated_at = now()
                   WHERE mac = %(mac)s::macaddr OR (wifi_mac = %(mac)s::macaddr AND NOT EXISTS (
                       SELECT 1 FROM boards x WHERE x.mac = %(mac)s::macaddr))""",
                dict(row, mac=mac)).rowcount:
            continue
        # Elle (yalnız IP ile) eklenmiş kayıt varsa adını tamamla: kaynak o kaydın MAC'iyle ya da tahta MAC'iyle.
        updated = 0
        if ip and (board_mac or (mac is None and from_board_net(ip))):
            updated = conn.execute(
                """UPDATE boards SET hostname = %(host)s, last_log_at = %(last_log_at)s, updated_at = now()
                   WHERE ip = %(ip)s::inet AND hostname IS NULL""",
                row,
            ).rowcount
        if updated:
            continue
        if not board_mac:
            log.debug("tahta MAC'i olmayan log kaynağı (kayıt açılmadı): %s (%s, MAC %s)", row["host"], ip, mac or "bilinmiyor")
            continue
        if _looks_fake(row["host"], ip):
            log.info("şüpheli kaynak yok sayıldı (otomatik kayıt açılmadı): %s (%s)", row["host"], ip)
            continue
        conn.execute(
            """INSERT INTO boards (hostname, ip, mac, source, last_log_at)
               VALUES (%(host)s, %(ip)s::inet, %(mac)s::macaddr, 'syslog', %(last_log_at)s)
               ON CONFLICT DO NOTHING""",
            dict(row, mac=mac),
        )
        log.info("yeni tahta: %s (%s, MAC %s)", row["host"], ip, mac)
        activity.record(conn, f"Yeni tahta bulundu (log): {row['host']} ({ip or 'IP yok'}, MAC {mac})")
