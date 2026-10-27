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

"""Kayıtlı tahtaların erişilebilirliğini yoklar (SSH ve sensör portuna TCP bağlantısı).

Çevrimiçiye dönüş ilk başarılı yoklamada hemen yansır. Çevrimdışıya dönüş ise bilerek geciktirilir:
tek seferlik bir yoklama hatası (ağ sıçraması, Wi-Fi'de anlık kopma) grid'i titretmesin diye
FAILS_BEFORE_OFFLINE kez üst üste başarısızlık istenir. Bu görev __main__.py'de diğer periyodik
görevlerden (TICK_SECONDS) ayrı, daha sık bir döngüde çalışır (STATUS_TICK_SECONDS) — amaç,
çevrimdışı tespitinin TICK_SECONDS'ı (varsayılan 60 sn) beklemeden sonuçlanması.

exporter_ok AYNI histerezisi kendi başına da alır (online'dan bağımsız sayaçla): telegraf_targets.py
Telegraf'ın tarama listesini doğrudan bu alana göre kurar (bkz. o dosya), tek bir başarısız sensör
port yoklaması (geçici ağ sıçraması) tahtayı o turda listeden düşürüp, hâlâ gerçekten açıkken sensör
kaydını kesmesin diye — "tahta açık olduğu sürece kesintisiz kayıt" garantisi burada kurulur.

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

_fails: dict[int, int] = {}
_exporter_fails: dict[int, int] = {}


async def _open(ip: str, port: int, limit: asyncio.Semaphore) -> bool:
    async with limit:
        try:
            _, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), TIMEOUT)
        except (OSError, asyncio.TimeoutError):
            return False
        writer.close()
        return True


async def _check(boards: list[dict]) -> list[tuple]:
    limit = asyncio.Semaphore(CONCURRENCY)
    results = await asyncio.gather(*(
        asyncio.gather(_open(b["ip"], SSH_PORT, limit), _open(b["ip"], b["exporter_port"], limit))
        for b in boards
    ))
    return [(b["id"], ssh, exporter) for b, (ssh, exporter) in zip(boards, results)]


def run(conn) -> None:
    boards = conn.execute("SELECT id, host(ip) AS ip, exporter_port FROM boards WHERE ip IS NOT NULL").fetchall()
    if not boards:
        return
    seen_ids = set()
    for board_id, ssh, exporter in asyncio.run(_check(boards)):
        seen_ids.add(board_id)
        reachable = ssh or exporter
        if reachable:
            _fails[board_id] = 0
            online = True
        else:
            _fails[board_id] = _fails.get(board_id, 0) + 1
            online = _fails[board_id] < FAILS_BEFORE_OFFLINE

        if exporter:
            _exporter_fails[board_id] = 0
            exporter_ok = True
        else:
            _exporter_fails[board_id] = _exporter_fails.get(board_id, 0) + 1
            exporter_ok = _exporter_fails[board_id] < FAILS_BEFORE_OFFLINE

        conn.execute(
            """UPDATE boards
               SET ssh_ok = %s, exporter_ok = %s, online = %s,
                   last_seen_at = CASE WHEN %s THEN now() ELSE last_seen_at END
               WHERE id = %s""",
            (ssh, exporter_ok, online, reachable, board_id),
        )
    # Artık yoklanmayan (silinmiş/elden çıkmış) tahtalar için sayaçlar süresiz birikmesin.
    for stale_id in set(_fails) - seen_ids:
        _fails.pop(stale_id, None)
    for stale_id in set(_exporter_fails) - seen_ids:
        _exporter_fails.pop(stale_id, None)
