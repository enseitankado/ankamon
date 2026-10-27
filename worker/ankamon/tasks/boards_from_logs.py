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

Syslog portu iki ağdan da (tahta + idari) log kabul eder; ama Ayarlar ▸ Ağ arabirimleri'nde rol seçildiyse
YALNIZ tahta ağından gelen kaynaklar tahta kaydı açar/IP günceller (bkz. netroles). Aksi halde idari ağdan
tek bir sahte syslog paketi bir tahtanın IP'sini kendi adresine çevirip yönetim bağlantılarını (root
parolasıyla SSH) üstüne çekebilirdi. İdari ağdan gelen loglar yine Loglar'da görünür.
"""

import ipaddress
import logging

from .. import activity, netroles
from ..netscan import ifaces

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


def run(conn) -> None:
    from_board_net = _board_source(conn)
    for row in conn.execute(RECENT).fetchall():
        if not from_board_net(row["ip"]):
            log.debug("tahta ağı dışından log kaynağı (envantere işlenmedi): %s (%s)", row["host"], row["ip"])
            continue
        updated = conn.execute(
            """UPDATE boards
               SET ip = COALESCE(%(ip)s::inet, ip), last_log_at = %(last_log_at)s, updated_at = now()
               WHERE lower(hostname) = lower(%(host)s)""",
            row,
        ).rowcount
        if updated:
            continue
        # Elle (yalnız IP ile) eklenmiş kayıt varsa adını tamamla; yoksa yeni kayıt aç.
        if row["ip"]:
            updated = conn.execute(
                """UPDATE boards SET hostname = %(host)s, last_log_at = %(last_log_at)s, updated_at = now()
                   WHERE ip = %(ip)s::inet AND hostname IS NULL""",
                row,
            ).rowcount
        if not updated:
            if _looks_fake(row["host"], row["ip"]):
                log.info("şüpheli kaynak yok sayıldı (otomatik kayıt açılmadı): %s (%s)", row["host"], row["ip"])
                continue
            conn.execute(
                """INSERT INTO boards (hostname, ip, source, last_log_at)
                   VALUES (%(host)s, %(ip)s::inet, 'syslog', %(last_log_at)s)""",
                row,
            )
            log.info("yeni tahta: %s (%s)", row["host"], row["ip"])
            activity.record(conn, f"Yeni tahta bulundu (log): {row['host']} ({row['ip'] or 'IP yok'})")
