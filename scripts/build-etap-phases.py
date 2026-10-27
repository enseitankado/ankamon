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

"""ankamon ETAP faz veritabanını (maskelenmiş MAC önekleri → anakart modeli) üretir.

Girdi: ETAP arka ucundan alınmış tahta envanteri (all_boards.json[.gz] + motherboard_catalog.json) —
okul adları ve tam MAC'ler içerdiğinden DEPOYA GİRMEZ; bu betik yalnız yerelde çalıştırılır.
Çıktı (depoya girer): worker/ankamon/netscan/etap_prefixes.tsv — her satır
    <hex önek>\t<model anahtarı>\t<öneğin altındaki envanter tahtası sayısı>
Önek, MAC'in ilk 6–10 onaltılık hanesidir (24–40 bit): HİÇBİR tam MAC saklanmaz; en dar önek 256 adres
kapsar. Model anahtarının fazı/markası worker/ankamon/netscan/etap_models.json'da (elle bakılır).

Önek seçimi (hex haneli önek ağacında yukarıdan aşağı): bir düğüm şu koşullarda tek önek olarak
yazılır, yoksa alt düğümlere inilir —
  * altındaki tahtaların en az PURITY kadarı aynı modelde (karışık üretim bloklarında daha derine),
  * düğüm en az MIN_DEPTH hane ve adres alanının en az DENSITY kadarı envanterde tahta (seyrek
    geniş önekler aynı üreticinin başka cihazlarını — ör. Vestel TV, GIGABYTE masaüstü — kapsamasın).
En derinde (MAX_DEPTH) yine karışıksa baskın model yazılır (çok küçük azınlık atılır).

Kullanım:
    build-etap-phases.py <veri dizini> <çıktı.tsv> [--holdout 0.2]
--holdout: kayıtların bir kısmını dışarıda bırakıp tabloyu kalanla kurar ve dışarıda kalanlar
üzerinde (envanterde OLMAYAN tahtaları temsilen) kapsama ve doğruluğu ölçer; dosya yazılmaz.
"""
from __future__ import annotations

import collections
import gzip
import json
import os
import random
import re
import sys

PURITY = 0.995
DENSITY = 0.02
MIN_DEPTH = 7        # 28 bit: en geniş önek 2^20 ≈ 1M adres (yalnız çok yoğun üretim bloklarında)
MAX_DEPTH = 10       # 40 bit: en dar önek 256 adres — tam MAC asla yazılmaz
MIN_COUNT = 3        # bundan az tahtalı en derin önekler yazılmaz (tek tük sapmalar/yanlış kayıtlar)


def model_key(vendor: str, name: str) -> str:
    """Katalogdaki satıcı+ad → kararlı anahtar (ör. "VESTEL 14MB57" → "vestel-14mb57")."""
    s = f"{vendor} {name}".strip().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def load(data_dir: str) -> list[tuple[str, str]]:
    cat = {r["id"]: model_key(r["vendor"], r["name"])
           for r in json.load(open(os.path.join(data_dir, "motherboard_catalog.json")))["data"]}
    path = os.path.join(data_dir, "all_boards.json.gz")
    opener = gzip.open if os.path.exists(path) else open
    path = path if os.path.exists(path) else path[:-3]
    rec = re.compile(rb'"mac_id":"([0-9A-Fa-f:]{17})".{0,4000}?"motherboard_id":(\d+|null)')
    rows, buf = [], b""
    with opener(path, "rb") as fh:
        while True:
            chunk = fh.read(1 << 22)
            if not chunk:
                break
            buf += chunk
            last = 0
            for m in rec.finditer(buf):
                mb = m.group(2)
                if mb != b"null" and int(mb) in cat:
                    rows.append((m.group(1).decode().replace(":", "").upper(), cat[int(mb)]))
                last = m.end()
            buf = buf[last:] if last else buf[-300000:]
    # Aynı MAC birden çok kayıttaysa (taşınan/yeniden kaydedilen tahta) bir kez say.
    return list(dict(rows).items())


def build(rows: list[tuple[str, str]]) -> list[tuple[str, str, int]]:
    out: list[tuple[str, str, int]] = []

    def walk(prefix: str, items: list[tuple[str, str]]):
        depth = len(prefix)
        counts = collections.Counter(model for _, model in items)
        model, n = counts.most_common(1)[0]
        purity = n / len(items)
        density = len(items) / 16 ** (12 - depth)
        if depth >= MIN_DEPTH and purity >= PURITY and density >= DENSITY:
            out.append((prefix, model, len(items)))
            return
        if depth == MAX_DEPTH:
            if n >= MIN_COUNT:
                out.append((prefix, model, n))
            return
        children = collections.defaultdict(list)
        for mac, m in items:
            children[mac[depth]].append((mac, m))
        for digit in sorted(children):
            walk(prefix + digit, children[digit])

    by_oui = collections.defaultdict(list)
    for mac, model in rows:
        by_oui[mac[:6]].append((mac, model))
    for oui in sorted(by_oui):
        walk(oui, by_oui[oui])
    return out


def lookup(table: list[tuple[str, str, int]]):
    index = {p: m for p, m, _ in table}

    def find(mac: str) -> str | None:
        for depth in range(MAX_DEPTH, 5, -1):
            m = index.get(mac[:depth])
            if m:
                return m
        return None
    return find


def main() -> None:
    args = sys.argv[1:]
    holdout = 0.0
    if "--holdout" in args:
        i = args.index("--holdout")
        holdout = float(args[i + 1])
        del args[i:i + 2]
    data_dir, out_path = args
    rows = load(data_dir)
    print(f"envanter: {len(rows)} tekil MAC, {len({m for _, m in rows})} model", file=sys.stderr)

    if holdout:
        random.seed(1)
        random.shuffle(rows)
        cut = int(len(rows) * holdout)
        test, train = rows[:cut], rows[cut:]
        table = build(train)
        find = lookup(table)
        hit = right = 0
        for mac, model in test:
            got = find(mac)
            hit += got is not None
            right += got == model
        print(f"önek: {len(table)} | dışarıda kalan {len(test)} tahta: kapsama %{100 * hit / len(test):.2f}, "
              f"bulunanlarda doğruluk %{100 * right / max(hit, 1):.2f}", file=sys.stderr)
        return

    table = build(rows)
    space = sum(16 ** (12 - len(p)) for p, _, _ in table)
    print(f"önek: {len(table)} | kapsanan adres: {space:,} | uzunluk dağılımı: "
          f"{dict(sorted(collections.Counter(len(p) for p, _, _ in table).items()))}", file=sys.stderr)
    with open(out_path, "w") as fh:
        # REUSE-IgnoreStart — üretilen dosyanın başlığı, bu dosyanınki değil
        fh.write("# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>\n"
                 "# SPDX-License-Identifier: AGPL-3.0-or-later\n\n")
        # REUSE-IgnoreEnd
        fh.write("# ankamon ETAP faz veritabanı — maskelenmiş MAC öneki → anakart modeli (bkz. etap_models.json).\n")
        fh.write("# Üretici: scripts/build-etap-phases.py (envanterin kendisi depoda yoktur). Sütunlar: önek, model, tahta sayısı\n")
        for prefix, model, n in table:
            fh.write(f"{prefix}\t{model}\t{n}\n")


if __name__ == "__main__":
    main()
