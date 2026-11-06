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

"""Wi-Fi Monitör görülme geçmişi (wifimon_sightings, göç 040): tahta başına hangi verici ilk ne zaman, kaç farklı günde görüldü.

Arayüz "yeni" rozetini (bu tahtada son 24 saatte ilk kez) ve "N günde görüldü" bilgisini buradan alır. Yalnız kalıcı adresler
yazılır: rastgele (yerel yönetimli) adresler dakikalar içinde değiştiğinden geçmişleri anlamsızdır ve tabloyu şişirir —
Wi-Fi ağlarında BSSID ise rastgele de olsa paylaşım noktası boyunca sabit kaldığından yazılır; Wi-Fi'ye bağlı cihazın
(client) rastgele adresi de telefonların ağa özel adresi olduğundan o ağda sabit kalır, yazılır. 90 günden eski kayıtlar saatte
bir silinir. Hata (veritabanı yok/yetişmiyor) Wi-Fi Monitör'ü durdurmaz: geçmiş alanları boş döner.
"""

from __future__ import annotations

import logging
import time

from .. import db

log = logging.getLogger("ankamon.screen.wifimon_sightings")

_RETENTION_DAYS = 90
_last_prune = 0.0


def _stable(row: dict) -> bool:
    return bool(row.get("addr")) and (row["kind"] in ("wifi", "client") or not row.get("random"))


def record_and_annotate(board_id: int, rows: list[dict]) -> None:
    """Satırları geçmişe yazar; her satıra first_seen (epoch sn) ve seen_days ekler (kalıcı olmayan adreste None)."""
    global _last_prune
    for row in rows:
        row["first_seen"] = row["seen_days"] = None
    stable = [r for r in rows if _stable(r)]
    if not stable:
        return
    try:
        with db.connect() as conn:
            # Tek sorgu; aynı adres bir taramada iki kez gelirse (ör. aynı BSSID iki satırda) ilki yazılır.
            got = conn.execute(
                """INSERT INTO wifimon_sightings AS s (board_id, kind, addr, name)
                   SELECT DISTINCT ON (k, a) %s, k, a, n FROM unnest(%s::text[], %s::text[], %s::text[]) AS u(k, a, n)
                   ON CONFLICT (board_id, kind, addr) DO UPDATE SET
                     name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE s.name END,
                     seen_days = s.seen_days + CASE WHEN s.last_seen::date < now()::date THEN 1 ELSE 0 END,
                     last_seen = now()
                   RETURNING kind, addr, extract(epoch FROM first_seen)::bigint AS first_seen, seen_days""",
                (board_id, [r["kind"] for r in stable], [r["addr"].upper() for r in stable],
                 [r.get("name") or "" for r in stable])).fetchall()
            if time.time() - _last_prune > 3600:
                _last_prune = time.time()
                conn.execute("DELETE FROM wifimon_sightings WHERE last_seen < now() - make_interval(days => %s)",
                             (_RETENTION_DAYS,))
        known = {(g["kind"], g["addr"]): g for g in got}
        for row in stable:
            g = known.get((row["kind"], row["addr"].upper()))
            if g:
                row["first_seen"], row["seen_days"] = int(g["first_seen"]), int(g["seen_days"])
    except Exception as exc:  # geçmiş yazılamazsa izleme sürer
        log.warning("wifimon_sightings yazılamadı: %s", exc)
