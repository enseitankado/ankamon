# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Arka plan etkinlik günlüğü: önemli olayları activity_log'a yazar (arayüzdeki durum çubuğu okur)."""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

_count = 0


def record(conn, message: str, level: str = "info") -> None:
    """Bir olayı kaydeder. Tabloyu ara sıra budar (son ~2000 kayıt kalır)."""
    global _count
    try:
        conn.execute("INSERT INTO activity_log (level, message) VALUES (%s, %s)", (level, message))
        _count += 1
        if _count % 50 == 0:
            conn.execute("DELETE FROM activity_log WHERE id < (SELECT max(id) - 2000 FROM activity_log)")
    except Exception:  # etkinlik kaydı asıl işi engellemesin
        log.exception("etkinlik kaydı yazılamadı")
