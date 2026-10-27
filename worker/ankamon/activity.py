# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Ankamon logs: önemli olayları activity_log'a yazar (arayüzün alt çubuğu "Ankamon logs" okur).

Çekirdek ve eklentiler kendi faydalı/kritik olaylarını buradan yazar; servislerin hata çıktıları, çökmeleri
ve darboğazlar ise ayrı süreçte (bkz. logwatch) toplanır. source: kaydı üreten bileşen (boşsa çağıranın
adı yazılmaz), detail: satıra sığmayan ayrıntı (arayüzde ipucu).
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

_count = 0


def record(conn, message: str, level: str = "info", source: str = "", detail: str = "") -> None:
    """Bir olayı kaydeder (level: info | warn | error). Tabloyu ara sıra budar (son ~2000 kayıt kalır)."""
    global _count
    try:
        conn.execute("INSERT INTO activity_log (level, message, source, detail) VALUES (%s, %s, %s, %s)",
                     (level, message, source[:40], detail[:8000]))
        _count += 1
        if _count % 50 == 0:
            conn.execute("DELETE FROM activity_log WHERE id < (SELECT max(id) - 2000 FROM activity_log)")
    except Exception:  # etkinlik kaydı asıl işi engellemesin
        log.exception("etkinlik kaydı yazılamadı")
