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

"""Kayıtlı cihazların erişilebilirliğini yoklar (SSH ve sensör portuna TCP bağlantısı).

Çevrimiçiye dönüş ilk başarılı yoklamada hemen yansır. Çevrimdışıya dönüş ise bilerek geciktirilir:
tek seferlik bir yoklama hatası (ağ sıçraması, Wi-Fi'de anlık kopma) grid'i titretmesin diye
FAILS_BEFORE_OFFLINE kez üst üste başarısızlık istenir. Bu görev __main__.py'de diğer periyodik
görevlerden (TICK_SECONDS) ayrı, daha sık bir döngüde çalışır (STATUS_TICK_SECONDS) — amaç,
çevrimdışı tespitinin TICK_SECONDS'ı (varsayılan 60 sn) beklemeden sonuçlanması.

exporter_ok AYNI histerezisi kendi başına da alır (online'dan bağımsız sayaçla): telegraf_targets.py
Telegraf'ın tarama listesini doğrudan bu alana göre kurar (bkz. o dosya), tek bir başarısız sensör
port yoklaması (geçici ağ sıçraması) cihazı o turda listeden düşürüp, hâlâ gerçekten açıkken sensör
kaydını kesmesin diye — "cihaz açık olduğu sürece kesintisiz kayıt" garantisi burada kurulur.

Üst üste başarısızlık sayaçları süreç belleğindedir (veritabanında değil): worker yeniden başlarsa
sıfırlanır, bu da en kötü durumda bir yoklama turu daha gerektirir — yanlışlıkla "çevrimiçi"
göstermenin önüne geçer, tek riski birkaç saniyelik ek gecikmedir.
"""

import asyncio

TIMEOUT = 2.0
CONCURRENCY = 64
SSH_PORT = 22

# Çevrimdışı sayılmadan önce üst üste istenen başarısız yoklama sayısı (histerezis).
FAILS_BEFORE_OFFLINE = 2

# "Bilgisayarı kapat" komutundan (devices.shutdown_at) sonra cihaz bu süre içinde SSH'te yeniden görünmediyse kapalı
# sayılır: ilk başarısız yoklamada çevrim dışı (FAILS_BEFORE_OFFLINE beklenmez) ve ağ kaydı (Varlıklar) da çevrim dışı.
# Kapanış birkaç saniye SSH'e yanıt verebilir; cihaz yeniden açılırsa bu süreden sonra görülür ve kural düşer.
SHUTDOWN_GRACE = "3 minutes"

_fails: dict[int, int] = {}
_exporter_fails: dict[int, int] = {}


async def _device_tcp_port_open(ip: str, port: int, limit: asyncio.Semaphore) -> bool:
    async with limit:
        try:
            _, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), TIMEOUT)
        except (OSError, asyncio.TimeoutError):
            return False
        writer.close()
        return True


async def _probe_device_ssh_and_exporter(devices: list[dict]) -> list[tuple]:
    limit = asyncio.Semaphore(CONCURRENCY)
    results = await asyncio.gather(*(
        asyncio.gather(_device_tcp_port_open(b["ip"], SSH_PORT, limit), _device_tcp_port_open(b["ip"], b["exporter_port"], limit))
        for b in devices
    ))
    return [(b["id"], ssh, exporter) for b, (ssh, exporter) in zip(devices, results)]


def run(conn) -> None:
    devices = conn.execute(
        f"""SELECT id, host(ip) AS ip, exporter_port,
                  (shutdown_at IS NOT NULL AND (last_seen_at IS NULL OR last_seen_at < shutdown_at + interval '{SHUTDOWN_GRACE}'))
                  AS shut_down
           FROM devices WHERE ip IS NOT NULL""").fetchall()
    if not devices:
        return
    shut_down = {b["id"] for b in devices if b["shut_down"]}
    seen_ids = set()
    for device_id, ssh, exporter in asyncio.run(_probe_device_ssh_and_exporter(devices)):
        seen_ids.add(device_id)
        reachable = ssh or exporter
        if reachable:
            _fails[device_id] = 0
            online = True
        else:
            _fails[device_id] = _fails.get(device_id, 0) + 1
            # Kapatma komutundan sonra ulaşılamıyorsa beklemeden çevrim dışı (kullanıcı isteği 2026-11-11).
            online = _fails[device_id] < FAILS_BEFORE_OFFLINE and device_id not in shut_down

        if exporter:
            _exporter_fails[device_id] = 0
            exporter_ok = True
        else:
            _exporter_fails[device_id] = _exporter_fails.get(device_id, 0) + 1
            exporter_ok = _exporter_fails[device_id] < FAILS_BEFORE_OFFLINE

        conn.execute(
            """UPDATE devices
               SET ssh_ok = %s, exporter_ok = %s, online = %s,
                   last_seen_at = CASE WHEN %s THEN now() ELSE last_seen_at END
               WHERE id = %s""",
            (ssh, exporter_ok, online, reachable, device_id),
        )
    _mark_shut_down_offline(conn)
    # Artık yoklanmayan (silinmiş/elden çıkmış) cihazlar için sayaçlar süresiz birikmesin.
    for stale_id in set(_fails) - seen_ids:
        _fails.pop(stale_id, None)
    for stale_id in set(_exporter_fails) - seen_ids:
        _exporter_fails.pop(stale_id, None)


def _mark_shut_down_offline(conn) -> None:
    """Kapatma komutu verilmiş ve SSH'e ulaşılamayan cihazın ağ kaydını (Varlıklar — net_devices) çevrim dışı yapar.

    Ağ taraması kapanan cihazı ancak birkaç tur sonra düşürür (ARP önbelleği); Akıllı Tahtalar ve Varlıklar aynı durumu
    göstersin diye burada hemen düşürülür. Cihaz yeniden açılınca SSH yoklaması last_seen_at'i ilerletir, koşul düşer ve
    ağ taraması cihazı yeniden çevrim içi yazar.
    """
    conn.execute(
        f"""UPDATE net_devices nd SET online = false, state_changed_at = now()
            FROM devices b
            WHERE (nd.mac = b.mac OR nd.mac = b.wifi_mac) AND nd.online
              AND b.shutdown_at IS NOT NULL AND NOT b.online
              AND (b.last_seen_at IS NULL OR b.last_seen_at < b.shutdown_at + interval '{SHUTDOWN_GRACE}')""")
