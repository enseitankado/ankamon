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

"""MAC adresinden ETAP akıllı tahta modeli ve FATİH fazı (ankamon faz veritabanı).

Veri (depoda, bu dizinde):
  etap_prefixes.tsv — maskelenmiş MAC öneki (6–10 onaltılık hane; tam MAC YOK) → anakart modeli.
                      Ülke çapı ETAP envanterinden scripts/build-etap-phases.py ile üretilir; envanterin
                      kendisi (okul adları, tam MAC'ler) depoya girmez.
  etap_models.json  — anakart modeli → faz, marka, işlemci, güven (elle bakılır).

En uzun önek kazanır. Dönen kayıt:
  {"model", "ad", "faz", "marka", "islemci", "guven", "tahta", "kaynak", "onek", "onek_tahta"}
kaynak: "mac" (önek tahmini) ya da "donanım" (SSH ile okunan anakart modeli — bkz. resolve; kesin).
"tahta": model etap_models.json'daki bilinen tahta modellerinden biri mi (değilse: ETAP'a kayıtlı ama
akıllı tahta olduğu bilinmeyen cihaz bloğu — ör. ETAP kurulu laboratuvar PC'si).
Doğruluk (envanterin %20'si dışarıda bırakılarak ölçüldü): kapsama %99,6, model doğruluğu %99,9.
"""

from __future__ import annotations

import json
import os
import re

_DIR = os.path.dirname(__file__)
_prefixes: dict[str, tuple[str, int]] | None = None
_models: dict[str, dict] | None = None
_MIN, _MAX = 6, 10


def _load() -> None:
    global _prefixes, _models
    prefixes: dict[str, tuple[str, int]] = {}
    path = os.path.join(_DIR, "etap_prefixes.tsv")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("#") or not line.strip():
                    continue
                prefix, model, count = line.rstrip("\n").split("\t")
                prefixes[prefix] = (model, int(count))
    models_path = os.path.join(_DIR, "etap_models.json")
    models = json.load(open(models_path, encoding="utf-8"))["modeller"] if os.path.exists(models_path) else {}
    _prefixes, _models = prefixes, models


def lookup(mac: str) -> dict | None:
    """MAC (iki nokta/tire/ayraçsız, büyük/küçük harf farketmez) → faz kaydı; eşleşme yoksa None."""
    if _prefixes is None:
        _load()
    hexs = mac.replace(":", "").replace("-", "").upper()
    if len(hexs) != 12:
        return None
    for depth in range(_MAX, _MIN - 1, -1):
        hit = _prefixes.get(hexs[:depth])
        if hit:
            model, count = hit
            return _record(model, "mac", onek=hexs[:depth], onek_tahta=count)
    return None


def model_key(text: str) -> str:
    """Anakart adı ("VESTEL 14MB57" — hwfacts motherboard_model) → model anahtarı ("vestel-14mb57").
    scripts/build-etap-phases.py model_key ile AYNI kural."""
    return re.sub(r"[^a-z0-9]+", "-", (text or "").strip().lower()).strip("-")


def by_model(motherboard: str) -> dict | None:
    """SSH ile okunan anakart modelinden (kesin) faz kaydı; tabloda bilinen bir tahta modeli değilse None."""
    if _prefixes is None:
        _load()
    key = model_key(motherboard)
    return _record(key, "donanım") if key in _models else None


def resolve(mac: str | None, motherboard: str | None = None) -> dict | None:
    """Anakart modeli biliniyorsa ondan (kesin), bilinmiyorsa MAC önekinden faz kaydı."""
    return (by_model(motherboard) if motherboard else None) or (lookup(mac) if mac else None)


def _record(model: str, source: str, **extra) -> dict:
    info = _models.get(model, {})
    return {
        "model": model,
        "ad": info.get("ad") or model,
        "faz": info.get("faz"),
        "marka": info.get("marka"),
        "islemci": info.get("islemci"),
        "guven": info.get("guven"),
        "tahta": model in _models,
        "kaynak": source,
        **extra,
    }


def label(info: dict | None) -> str:
    """Grid'de gösterilecek kısa metin: "Faz 2 · Vestel", "Faz 3 · Arçelik? (çıkarım)", "ETAP cihazı"…"""
    if not info:
        return ""
    if not info["tahta"]:
        return "ETAP cihazı"
    faz = f"Faz {info['faz']}" if info["faz"] else "Faz ?"
    text = f"{faz} · {info['marka']}" if info.get("marka") else faz
    return text + (" (çıkarım)" if info.get("guven") == "cikarim" else "")
