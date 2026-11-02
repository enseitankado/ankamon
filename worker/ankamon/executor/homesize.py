# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Yedekle/Geri al penceresi: tahtadaki hesapların ev dizini boyutu (MB, du). Önbelleksiz: yedek kararı güncel boyutla verilir."""

from __future__ import annotations

import json

from .accounts import _ssh

# Hesap ölçütü "accounts" göreviyle aynı (UID 1000-59999, oturum açabilen); dizin yoksa satır yazılmaz.
_SCRIPT = r"""
getent passwd | awk -F: '$3 >= 1000 && $3 < 60000 && $7 !~ /(nologin|false)$/ {print $1 ":" $6}' | while IFS=: read -r name home; do
  [ -d "$home" ] || continue
  mb=$(du -sm --one-file-system "$home" 2>/dev/null | cut -f1)
  [ -n "$mb" ] && printf '%s\t%s\n' "$name" "$mb"
done
"""


def query(board: dict, user: str, password: str) -> dict:
    """Çıktı JSON: {"<hesap>": <MB>}."""
    res = _ssh(board, user, password, _SCRIPT, timeout=120)
    if res["status"] != "ok":
        return res
    sizes = {}
    for line in res["output"].splitlines():
        name, _, mb = line.partition("\t")
        if name and mb.isdigit():
            sizes[name] = int(mb)
    return {"status": "ok", "rc": 0, "output": json.dumps(sizes)}
