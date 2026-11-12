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

"""İşletim sistemine göre işlev seçimi (kullanıcı isteği 2026-11-12; tanım: platforms/catalog.json, platforms/README.md).

Hedef cihazın ailesi (linux | windows | macos | other) SQL ``device_os_family(id)`` ile belirlenir (göç 052 — PHP
BoardsApi ile aynı ölçüt); bilinmiyorsa kataloğun ``default_family``'si. Bir görev türü kataloğun hangi işlevine bağlıysa
(``functions[].jobs``) o işlevin ``impl``'inde adı olan aileler desteklenir; katalogda olmayan görev türü
``unknown_function_families``'de (Linux) çalışır. Hazır işlemde ayrıca o ailenin betiği bulunmalıdır
(``families[aile].script`` — run.sh / run.ps1 / run.macos.sh).
"""

from __future__ import annotations

import base64
import json
import logging
import os

log = logging.getLogger(__name__)

_FALLBACK = {
    "families": {"linux": {"label": "Linux", "shell": "bash", "script": "run.sh"}},
    "family_order": ["linux"], "default_family": "linux", "unknown_function_families": ["linux"], "functions": [],
}
_catalog: dict | None = None


def _catalog_path() -> str:
    explicit = os.environ.get("PLATFORMS_DIR")
    if explicit:
        return os.path.join(explicit, "catalog.json")
    actions = os.environ.get("ACTIONS_DIR", "/opt/ankamon/app/actions")
    return os.path.join(os.path.dirname(actions.rstrip("/")), "platforms", "catalog.json")


def catalog() -> dict:
    global _catalog
    if _catalog is None:
        try:
            with open(_catalog_path(), encoding="utf-8") as f:
                _catalog = json.load(f)
        except (OSError, ValueError):
            log.exception("platform kataloğu okunamadı (%s); yalnız Linux varsayılıyor", _catalog_path())
            _catalog = _FALLBACK
    return _catalog


def label(family: str | None) -> str:
    fam = catalog()["families"].get(family or "")
    return fam["label"] if fam else (family or "bilinmiyor")


def families(conn, board_ids: list[int]) -> dict[int, str]:
    """Kart başına aile; bilinmeyene ``default_family``."""
    if not board_ids:
        return {}
    default = catalog().get("default_family", "linux")
    rows = conn.execute("SELECT id, device_os_family(id) AS family FROM boards WHERE id = ANY(%s)", (list(board_ids),)).fetchall()
    found = {r["id"]: (r["family"] or default) for r in rows}
    return {bid: found.get(bid, default) for bid in board_ids}


def function_for_job(job_type: str) -> dict | None:
    for fn in catalog().get("functions", []):
        if job_type in (fn.get("jobs") or []):
            return fn
    return None


def job_supported(job_type: str, family: str) -> bool:
    fn = function_for_job(job_type)
    if fn is None:
        return family in catalog().get("unknown_function_families", ["linux"])
    return family in (fn.get("impl") or {})


def script_name(family: str) -> str | None:
    fam = catalog()["families"].get(family) or {}
    return fam.get("script")


def shell(family: str) -> str | None:
    fam = catalog()["families"].get(family) or {}
    return fam.get("shell")


def action_script(action_dir: str, family: str) -> str | None:
    """Hazır işlemin bu aile için betiğinin yolu; yoksa None (işlem o ailede tanımlı değil)."""
    name = script_name(family)
    if not name:
        return None
    path = os.path.join(action_dir, name)
    return path if os.path.isfile(path) else None


def unsupported_text(what: str, family: str) -> str:
    return (f"Atlandı: «{what}» işlevinin {label(family)} için uygulaması tanımlı değil "
            "(bkz. platforms/catalog.json — işletim sistemi Düzenle ▸ İşletim sistemi ile değiştirilebilir).")


def powershell_command(script: str) -> str:
    """PowerShell betiğini SSH komut satırına güvenle taşır: UTF-16LE + base64 (-EncodedCommand; tırnak/kaçış sorunu yok)."""
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    return f"powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {encoded}"
