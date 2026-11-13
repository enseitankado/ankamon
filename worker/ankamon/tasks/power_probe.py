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

"""Cihazların güç yoklaması (bkz. executor/power_probe.py, göç 055) — elektrik kesintisi anomalilerinin teyit verisi.

Bir cihaz yoklanır: hiç yoklanmadıysa, loglarda son yoklamadan sonra yeni bir açılış göründüyse (device_uptime) ya da
son yoklamanın üzerinden REFRESH geçtiyse. Açılış başına bir satır yazılır (boot_id); aynı açılışta yeniden yoklama
yalnız sayaçları tazeler. İki ardışık açılışın satırları arasındaki SMART farkı aradaki kapanışların türünü verir;
bu yüzden satır kapanıştan ÖNCE de bulunmalıdır — REFRESH bunu sağlar (cihaz açılıştan sonra hemen yoklanamadıysa).

Yalnız Linux cihazlar (journalctl/smartctl); SSH'ı açık, çevrimiçi olanlar. Yoklamalar paralel (session_probe gibi),
veritabanına yazma ana iş parçacığında.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from ..executor import power_probe, whoami
from ..executor.jobs import _device_access

log = logging.getLogger(__name__)

REFRESH = "30 minutes"
_BATCH = 40

_DUE = f"""
SELECT d.id, host(d.ip) AS ip
FROM devices d
LEFT JOIN LATERAL (SELECT max(probed_at) AS at FROM device_power_probes p WHERE p.device_id = d.id) p ON true
LEFT JOIN LATERAL (SELECT max(started_at) AS at FROM device_uptime u
                   WHERE u.host IN (d.hostname, lower(d.hostname))) u ON true
WHERE d.online AND d.ssh_ok AND d.ip IS NOT NULL AND COALESCE(d.os_family, 'linux') = 'linux'
  AND (p.at IS NULL OR p.at < now() - interval '{REFRESH}' OR u.at > p.at)
ORDER BY p.at NULLS FIRST
LIMIT {_BATCH}
"""


def run(conn) -> None:
    devices = conn.execute(_DUE).fetchall()
    if not devices:
        return
    user, password = _device_access(conn)
    if not password:
        return
    n = max(1, min(whoami.dynamic_concurrency(), len(devices)))
    with ThreadPoolExecutor(max_workers=n) as pool:
        results = list(pool.map(lambda d: (d["id"], power_probe.probe(dict(d), user, password)), devices))
    for device_id, rec in results:
        if rec:
            try:
                power_probe.store(conn, device_id, rec)
            except Exception:  # noqa: BLE001 — bir cihazın kaydı diğerlerini durdurmasın
                log.exception("güç yoklaması yazılamadı: cihaz %s", device_id)
