# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Eklentilerin (ext/<ad>) worker tarafındaki yardımcıları.

Ayarlar: değerler çekirdeğin settings tablosunda "ext.<ad>.<key>" anahtarlarıyla durur (bkz. backend
Core\\Extensions ve Api\\ExtensionsApi; arayüzde Sistem ▸ Eklentiler düzenler). Eklenti worker
görevi değeri şöyle okur:

    from ankamon.ext import setting
    enabled = setting(conn, "<ad>", "<key>", default=False)

Cihaz kimliği satırları (device_identity_rows): ext/<ad>/worker/device_identity.py içinde
ROWS(conn, device_ids) → {device_id: [[ad, değer], …]} tanımlayan eklenti, cihazın kilit ekranındaki kimlik
bilgisine satır ekler (ör. envanter numarası). Çekirdek hiçbir eklentiyi adıyla bilmez.
"""

from __future__ import annotations

import glob
import importlib.util
import logging
import os

log = logging.getLogger(__name__)

# Eklentilerin kurulu olduğu dizin (backend Core\Extensions::dir ile aynı).
EXT_DIR = os.environ.get("EXT_DIR", "/opt/ankamon/ext")

_identity_modules: list | None = None


def setting(conn, name: str, key: str, default=None):
    """settings tablosundaki ext.<name>.<key> değeri (jsonb olarak saklanır); yoksa default döner."""
    row = conn.execute(
        "SELECT value FROM settings WHERE key = %s", (f"ext.{name}.{key}",)
    ).fetchone()
    if row is None:
        return default
    value = row["value"]
    return default if value is None else value


def _load_identity_modules() -> list:
    """ext/*/worker/device_identity.py modülleri (bir kez yüklenir; hatalı eklenti atlanır)."""
    global _identity_modules
    if _identity_modules is None:
        _identity_modules = []
        for path in sorted(glob.glob(os.path.join(EXT_DIR, "*", "worker", "device_identity.py"))):
            name = os.path.basename(os.path.dirname(os.path.dirname(path)))
            try:
                spec = importlib.util.spec_from_file_location(f"ext_device_identity_{name}", path)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                if callable(getattr(mod, "ROWS", None)):
                    _identity_modules.append(mod)
            except Exception:
                log.exception("eklenti kimlik modülü yüklenemedi: %s", path)
    return _identity_modules


def device_identity_rows(conn, device_ids: list[int]) -> dict[int, list]:
    """Eklentilerin cihaz başına kimlik satırları: {device_id: [[ad, değer], …]} (boş değerler atlanır)."""
    out: dict[int, list] = {}
    for mod in _load_identity_modules():
        try:
            for device_id, rows in (mod.ROWS(conn, list(device_ids)) or {}).items():
                rows = [[str(k), str(v)] for k, v in rows if str(v or "").strip()]
                if rows:
                    out.setdefault(int(device_id), []).extend(rows)
        except Exception:
            log.exception("eklenti kimlik satırları alınamadı: %s", getattr(mod, "__file__", "?"))
    return out
