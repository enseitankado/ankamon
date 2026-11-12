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

"""Cihazın kalıcı kimliğini (kablolu MAC) ve güncel bilgisayar adını SSH ile okur.

Bilgisayar adı değişebilir: kurulumda "etap", imaj hazırlığında "etap-image", TiHA'nın dinamik adıyla
"etap-<MAC son 6 hane>". Cihaz kuyruğunda bekleyen eski loglar da eski adla gelir. Bu yüzden logdan açılan
her kayıt burada MAC'e bağlanır; aynı MAC'li bir kayıt zaten varsa ikisi birleştirilir. Takma ad, konum
ve notlar MAC'e bağlı kayıtta kalır, bilgisayar adı ve IP cihazın o anki değerleriyle güncellenir.

Aynı SSH turunda donanım bilgisi de (disk/RAM/BIOS/çekirdek/anakart) bir kez toplanır — bkz.
executor.hwfacts: cihazlar grid'indeki sütunları besler, "Bilgi kartı" bu ilk kaydı önbellek olarak kullanır.
"""

from __future__ import annotations

import logging
import re
import time

from .. import activity
from ..executor import ansible, hwfacts
from ..executor.jobs import _device_access

log = logging.getLogger(__name__)

# Başarısız okumadan sonra aynı cihaz için yeniden deneme aralığı (saniye).
RETRY_SECONDS = 1800

# Önce kablolu fiziksel arayüz (TiHA'nın dinamik adı da bunun MAC'inden üretilir), yoksa varsayılan rota.
# hwfacts.SCRIPT'in eklenmesiyle donanım bilgisi de AYNI SSH turunda toplanır (ikinci bir bağlantı gerekmez).
SCRIPT = r"""
iface=""
for d in /sys/class/net/*; do
    [ -e "$d/device" ] && [ ! -e "$d/wireless" ] && [ ! -e "$d/phy80211" ] && { iface=${d##*/}; break; }
done
[ -n "$iface" ] || iface=$(ip -o route show default 2>/dev/null | awk '{print $5; exit}')
echo "HOSTNAME=$(hostname)"
echo "MAC=$(cat /sys/class/net/$iface/address 2>/dev/null)"
""" + hwfacts.SCRIPT

_MAC_RE = re.compile(r"^([0-9a-f]{2}:){5}[0-9a-f]{2}$")


def _parse(output: str) -> tuple[str | None, str | None]:
    values = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
    mac = values.get("MAC", "").strip().lower()
    hostname = values.get("HOSTNAME", "").strip()
    if not _MAC_RE.match(mac) or mac == "00:00:00:00:00:00":
        mac = None
    return mac, hostname or None


def _assign(conn, device_id: int, mac: str, hostname: str | None, facts: dict) -> None:
    """MAC'i (ve donanım bilgisini) kayda yazar; aynı MAC'li başka kayıt varsa bu kaydı ona katıp siler."""
    now_ts = int(time.time())
    with conn.transaction():
        owner = conn.execute(
            "SELECT id, label, location, notes FROM devices WHERE mac = %s::macaddr AND id <> %s FOR UPDATE",
            (mac, device_id)).fetchone()
        if owner is None:
            conn.execute(
                """UPDATE devices SET mac = %s::macaddr, hostname = COALESCE(%s, hostname), updated_at = now()
                   WHERE id = %s""", (mac, hostname, device_id))
            hwfacts.store(conn, device_id, facts, now_ts)
            return

        dup = conn.execute("SELECT * FROM devices WHERE id = %s FOR UPDATE", (device_id,)).fetchone()
        conn.execute(
            """UPDATE devices SET
                   hostname     = COALESCE(%(hostname)s, %(dup_hostname)s, hostname),
                   ip           = COALESCE(%(ip)s, ip),
                   label        = COALESCE(NULLIF(label, ''), %(label)s),
                   location     = COALESCE(NULLIF(location, ''), %(location)s),
                   notes        = COALESCE(NULLIF(notes, ''), %(notes)s),
                   online       = %(online)s, ssh_ok = %(ssh_ok)s, exporter_ok = %(exporter_ok)s,
                   last_seen_at = GREATEST(last_seen_at, %(last_seen_at)s),
                   last_log_at  = GREATEST(last_log_at, %(last_log_at)s),
                   updated_at   = now()
               WHERE id = %(owner)s""",
            {**dup, "hostname": hostname, "dup_hostname": dup["hostname"], "owner": owner["id"]})
        # Geçmiş korunur: komut logları ve görev sonuçları kalan kayda taşınır.
        conn.execute("UPDATE command_log SET device_id = %s WHERE device_id = %s", (owner["id"], device_id))
        conn.execute(
            """UPDATE job_targets t SET device_id = %s WHERE device_id = %s
               AND NOT EXISTS (SELECT 1 FROM job_targets o WHERE o.job_id = t.job_id AND o.device_id = %s)""",
            (owner["id"], device_id, owner["id"]))
        conn.execute("DELETE FROM devices WHERE id = %s", (device_id,))
        hwfacts.store(conn, owner["id"], facts, now_ts)
    log.info("cihaz #%s, aynı MAC'li #%s ile birleştirildi (%s, %s)", device_id, owner["id"], mac, hostname)
    activity.record(conn, f"Cihaz kaydı birleştirildi: {dup['hostname']} → {hostname or dup['hostname']} ({mac})")


def run(conn) -> None:
    devices = conn.execute(
        """SELECT id, host(ip) AS ip FROM devices
           WHERE mac IS NULL AND ssh_ok AND ip IS NOT NULL
             AND COALESCE((facts->>'identity_failed_at')::bigint, 0) < %s
           ORDER BY id""",
        (int(time.time()) - RETRY_SECONDS,)).fetchall()
    if not devices:
        return
    user, password = _device_access(conn)
    if not password:
        return
    results = ansible.run([dict(b) for b in devices], user, password, body=SCRIPT, timeout=30)
    for device in devices:
        res = results.get(device["id"], {})
        mac, hostname = _parse(res.get("output", "")) if res.get("status") == "ok" else (None, None)
        if mac is None:
            conn.execute(
                "UPDATE devices SET facts = facts || jsonb_build_object('identity_failed_at', %s::bigint) WHERE id = %s",
                (int(time.time()), device["id"]))
            log.warning("cihaz #%s (%s) MAC okunamadı: %s", device["id"], device["ip"], res.get("output", "")[:200])
            continue
        facts = hwfacts.parse(res.get("output", ""))
        # Önceki turda başka bir kayıtla birleşmiş olabilir.
        if conn.execute("SELECT 1 FROM devices WHERE id = %s", (device["id"],)).fetchone():
            _assign(conn, device["id"], mac, hostname, facts)
