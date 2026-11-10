#!/usr/bin/env python3
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

"""Ulusal ETAP envanterinin ÜRETİCİ (OUI) düzeyinde özeti → worker/ankamon/netscan/etap_vendors.json (+ belge).

Kullanıcı isteği (2026-11-10): MEB akıllı tahtalarını ve fazlarını MAC'ten tanımak için envanterin (private repo
enseitankado/etapi: all_boards.json.gz, motherboard_catalog.json, manuf) üretici kısımlarının özeti. Çıktıda yalnız
toplu sayılar vardır (OUI, üretici, kayıt sayısı, anakart modeli / faz dağılımı) — tam MAC, okul adı/kodu YOK; depoya
girebilir. Envanter biraz kirlidir (az sayıda farklı türde cihaz): kayıt sayısı küçük ya da bilinen bir tahta modeline
düşmeyen OUI'ler "kirli" işaretlenir.

"ayrik" (MEB tahtasına ayrılmış OUI): kaydı çok (≥ AYRIK_MIN) ve kayıtlarının ≥ AYRIK_PAY'ı bilinen tahta modelinde, ve
üretici genel PC/anakart üreticisi DEĞİL (bkz. GENEL_URETICI). Ayrık OUI'nin her MAC'i tahta sayılabilir (worker
netscan/boardmac); ayrık olmayanlarda (ör. GIGABYTE OPS) tahta kararı için etap_prefixes.tsv bloğu gerekir — aynı OUI
okulun sıradan PC'lerinde de görülür.

Kullanım: python3 scripts/build-etap-vendors.py <etapi-dizini>   (all_boards.json.gz, motherboard_catalog.json, manuf)
"""

from __future__ import annotations

import collections
import importlib.util
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NETSCAN = os.path.join(ROOT, "worker", "ankamon", "netscan")
AYRIK_MIN = 1000
AYRIK_PAY = 0.95
KIRLI_MIN = 50
# Genel PC / anakart / ağ kartı üreticileri: bu OUI'ler okulun sıradan bilgisayarlarında da bulunur.
GENEL_URETICI = ("giga-byte", "gigabyte", "asustek", "micro-star", "msi", "intel", "elitegroup", "realtek", "hewlett",
                 "dell", "lenovo", "acer", "fujitsu", "asrock", "biostar", "foxconn", "pegatron", "quanta", "wistron",
                 "liteon", "azurewave", "tp-link", "d-link", "huawei", "xiaomi", "samsung", "apple")


def _phases_module():
    spec = importlib.util.spec_from_file_location("build_etap_phases", os.path.join(ROOT, "scripts", "build-etap-phases.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _manuf(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            key = parts[0].strip().upper()
            if len(key) == 8:  # yalnız 24 bit OUI
                out[key.replace(":", "")] = (parts[2] if len(parts) > 2 and parts[2].strip() else parts[-1]).strip()
    return out


def main(data_dir: str) -> None:
    rows = _phases_module().load(data_dir)  # [(MAC hex, model anahtarı)] — tekil MAC
    models = json.load(open(os.path.join(NETSCAN, "etap_models.json"), encoding="utf-8"))["modeller"]
    vendors = _manuf(os.path.join(data_dir, "manuf"))
    by_oui: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for mac, model in rows:
        by_oui[mac[:6]][model] += 1
    out, total = [], len(rows)
    for oui, counts in sorted(by_oui.items(), key=lambda kv: -sum(kv[1].values())):
        n = sum(counts.values())
        tahta = sum(c for m, c in counts.items() if m in models)
        fazlar = collections.Counter()
        for m, c in counts.items():
            faz = models.get(m, {}).get("faz") if m in models else "tahta değil"
            fazlar["?" if faz is None else str(faz)] += c
        vendor = vendors.get(oui, "")
        # Kelime başı/sonu eşleşmesi ("Intelligent" Intel, "Comsis" MSI sayılmasın).
        genel = any(re.search(r"\b" + re.escape(g) + r"\b", vendor.lower()) for g in GENEL_URETICI)
        pay = tahta / n
        ayrik = n >= AYRIK_MIN and pay >= AYRIK_PAY and not genel
        kirli = n < KIRLI_MIN or tahta == 0
        out.append({
            "oui": ":".join(oui[i:i + 2] for i in range(0, 6, 2)).lower(),
            "uretici": vendor,
            "kayit": n,
            "tahta_payi": round(pay, 4),
            "modeller": dict(counts.most_common(8)),
            "fazlar": dict(fazlar.most_common()),
            "ayrik": ayrik,
            "genel_uretici": genel,
            "kirli": kirli,
        })
    doc = {
        "_aciklama": "ETAP ulusal envanterinin OUI (MAC'in ilk 3 baytı) özeti — scripts/build-etap-vendors.py üretir. "
                     "ayrik: OUI MEB akıllı tahtalarına ayrılmış (bütün MAC'leri tahta sayılır). Ayrık olmayan OUI'de tahta "
                     "kararı ve faz için etap_prefixes.tsv bloğu gerekir. kirli: kayıt < %d ya da bilinen tahta modeli yok "
                     "(envanterdeki az sayıdaki farklı türde cihaz). Tam MAC / okul bilgisi içermez." % KIRLI_MIN,
        "kayit": total,
        "oui_sayisi": len(out),
        "ouis": out,
    }
    path = os.path.join(NETSCAN, "etap_vendors.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    _write_markdown(doc, os.path.join(NETSCAN, "ETAP-URETICI-OZETI.md"))
    print(f"{total} kayıt, {len(out)} OUI → {path}")
    print("ayrık:", ", ".join(f"{o['oui']} {o['uretici']} ({o['kayit']})" for o in out if o["ayrik"]))
    print("kirli:", sum(1 for o in out if o["kirli"]), "OUI,", sum(o["kayit"] for o in out if o["kirli"]), "kayıt")


def _write_markdown(doc: dict, path: str) -> None:
    """İnsan okuyacağı özet: ayrık ve büyük OUI'ler tablosu + kirli kayıtlar. etap_vendors.json'la aynı veriden."""
    def num(n):
        return f"{n:,}".replace(",", ".")

    def fazlar(o):
        return ", ".join(f"Faz {k}: {num(v)}" if k.isdigit() else f"{k}: {num(v)}" for k, v in o["fazlar"].items())

    lines = [
        "<!-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com> -->",
        "<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->",
        "",
        "# ETAP akıllı tahtaları — üretici (OUI) özeti",
        "",
        f"Kaynak: ulusal ETAP envanteri (private enseitankado/etapi), {num(doc['kayit'])} tekil MAC, {doc['oui_sayisi']} OUI. "
        "`scripts/build-etap-vendors.py` üretir; makine okur hâli `etap_vendors.json`. Yalnız toplu sayılar — tam MAC ve okul "
        "bilgisi yok.",
        "",
        "- **Ayrık**: OUI MEB akıllı tahtalarına ayrılmış — bütün MAC'leri tahta sayılır (`boardmac.is_board_mac`). Faz, OUI'nin "
        "kayıtları tek fazdaysa OUI'den, değilse `etap_prefixes.tsv` bloğundan (`etap_phase.lookup`).",
        "- **Genel üretici**: GIGABYTE / Elitegroup / Realtek gibi OUI'ler okulun sıradan bilgisayarlarında da görülür — tahta "
        "kararı yalnız `etap_prefixes.tsv` bloğuyla.",
        "- **Kirli**: envanterde az (< 50) kaydı olan ya da bilinen bir tahta modeline düşmeyen OUI (kayıtlı ama tahta olmayan "
        "cihazlar: laboratuvar PC'leri, USB ağ kartları …).",
        "",
        "| OUI | Üretici | Kayıt | Tahta payı | Faz dağılımı | Baskın modeller | Durum |",
        "|---|---|---:|---:|---|---|---|",
    ]
    for o in doc["ouis"]:
        if o["kirli"] or (o["kayit"] < 300 and not o["ayrik"]):
            continue
        state = "ayrık" if o["ayrik"] else ("genel üretici" if o["genel_uretici"] else "—")
        lines.append(f"| `{o['oui']}` | {o['uretici']} | {num(o['kayit'])} | %{o['tahta_payi'] * 100:.1f} | {fazlar(o)} | "
                     f"{', '.join(list(o['modeller'])[:3])} | {state} |")
    dirty = [o for o in doc["ouis"] if o["kirli"]]
    lines += ["", f"## Kirli kayıtlar: {len(dirty)} OUI, {num(sum(o['kayit'] for o in dirty))} kayıt", "",
              "En kalabalık 15'i (bunlara dayanılarak tahta kararı verilmez):", "",
              "| OUI | Üretici | Kayıt | Tahta payı |", "|---|---|---:|---:|"]
    for o in sorted(dirty, key=lambda o: -o["kayit"])[:15]:
        lines.append(f"| `{o['oui']}` | {o['uretici'] or '?'} | {o['kayit']} | %{o['tahta_payi'] * 100:.0f} |")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
