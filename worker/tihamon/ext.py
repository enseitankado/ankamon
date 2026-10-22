"""Eklentilerin (ext/<ad>) kendi ayarlarını worker tarafında okuması için yardımcı.

Değerler çekirdeğin settings tablosunda "ext.<ad>.<key>" anahtarlarıyla durur (bkz. backend
Core\\Extensions ve Api\\ExtensionsApi; arayüzde Ayarlar ▸ Eklentiler düzenler). Eklenti worker
görevi değeri şöyle okur:

    from tihamon.ext import setting
    enabled = setting(conn, "<ad>", "<key>", default=False)
"""

from __future__ import annotations


def setting(conn, name: str, key: str, default=None):
    """settings tablosundaki ext.<name>.<key> değeri (jsonb olarak saklanır); yoksa default döner."""
    row = conn.execute(
        "SELECT value FROM settings WHERE key = %s", (f"ext.{name}.{key}",)
    ).fetchone()
    if row is None:
        return default
    value = row["value"]
    return default if value is None else value
