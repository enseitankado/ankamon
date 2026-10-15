"""MAC adresinden üretici (vendor) bulma.

Kaynak: Wireshark'ın `manuf` tablosu (manuf.gz, bu dizinde; IEEE MA-L/MA-M/MA-S/IAB kayıtlarının
birleşimi + iyi bilinen adresler, ~58 bin kayıt). Depoda tutulmaz: imaj derlenirken
https://www.wireshark.org/download/automated/data/manuf adresinden indirilir (bkz. Dockerfile). İndirilemediyse
tablo boştur — üretici adları boş kalır, tarama yine çalışır.

Tablo ilk kullanımda belleğe bir kez yüklenir (~8 MB). Önek uzunlukları 24 (MA-L), 28 (MA-M) ve
36 (MA-S/IAB) bit; en uzun eşleşme kazanır.
"""

from __future__ import annotations

import gzip
import os

_PATH = os.path.join(os.path.dirname(__file__), "manuf.gz")
_tables: dict[int, dict[str, str]] | None = None


def _load() -> dict[int, dict[str, str]]:
    tables: dict[int, dict[str, str]] = {24: {}, 28: {}, 36: {}}
    if not os.path.exists(_PATH) or os.path.getsize(_PATH) == 0:
        return tables
    with gzip.open(_PATH, "rt", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if not line or line[0] == "#":
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 2:
                continue
            prefix = parts[0].strip()
            name = (parts[2] if len(parts) > 2 and parts[2].strip() else parts[1]).strip()
            bits = 24
            if "/" in prefix:
                prefix, _, b = prefix.partition("/")
                bits = int(b)
            hexs = prefix.replace(":", "").replace("-", "").upper()
            if bits not in tables:
                continue
            tables[bits][hexs[: bits // 4]] = name
    return tables


def is_random(mac: str) -> bool:
    """Yerel yönetimli (locally administered) adres mi? Telefonların "gizli/rastgele MAC"i böyledir."""
    try:
        return bool(int(mac.replace(":", "")[0:2], 16) & 0x02)
    except ValueError:
        return False


def vendor(mac: str) -> str:
    global _tables
    if _tables is None:
        _tables = _load()
    hexs = mac.replace(":", "").replace("-", "").upper()
    for bits in (36, 28, 24):
        name = _tables[bits].get(hexs[: bits // 4])
        if name:
            return name
    if hexs.startswith("525400"):
        return "QEMU/KVM sanal kart"
    return ""
