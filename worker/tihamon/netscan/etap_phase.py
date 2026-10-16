"""MAC adresinden ETAP akıllı tahta modeli ve FATİH fazı (tiha-mon faz veritabanı).

Veri (depoda, bu dizinde):
  etap_prefixes.tsv — maskelenmiş MAC öneki (6–10 onaltılık hane; tam MAC YOK) → anakart modeli.
                      Ülke çapı ETAP envanterinden scripts/build-etap-phases.py ile üretilir; envanterin
                      kendisi (okul adları, tam MAC'ler) depoya girmez.
  etap_models.json  — anakart modeli → faz, marka, işlemci, güven (elle bakılır).

En uzun önek kazanır. Dönen kayıt:
  {"model", "faz", "marka", "islemci", "guven", "tahta", "onek", "onek_tahta"}
"tahta": model etap_models.json'daki bilinen tahta modellerinden biri mi (değilse: ETAP'a kayıtlı ama
akıllı tahta olduğu bilinmeyen cihaz bloğu — ör. ETAP kurulu laboratuvar PC'si).
Doğruluk (envanterin %20'si dışarıda bırakılarak ölçüldü): kapsama %99,6, model doğruluğu %99,9.
"""

from __future__ import annotations

import json
import os

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
            info = _models.get(model, {})
            return {
                "model": model,
                "faz": info.get("faz"),
                "marka": info.get("marka"),
                "islemci": info.get("islemci"),
                "guven": info.get("guven"),
                "tahta": model in _models,
                "onek": hexs[:depth],
                "onek_tahta": count,
            }
    return None


def label(info: dict | None) -> str:
    """Grid'de gösterilecek kısa metin: "Faz 2 · Vestel", "Faz 3 · Arçelik? (çıkarım)", "ETAP cihazı"…"""
    if not info:
        return ""
    if not info["tahta"]:
        return "ETAP cihazı"
    faz = f"Faz {info['faz']}" if info["faz"] else "Faz ?"
    text = f"{faz} · {info['marka']}" if info.get("marka") else faz
    return text + (" (çıkarım)" if info.get("guven") == "cikarim" else "")
