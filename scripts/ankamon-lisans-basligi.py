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

"""Ankamon lisans başlığı aracı: dosyalara AGPL-3.0-or-later SPDX/telif başlığı ekler ya da denetler.

    ankamon-lisans-basligi.py --ekle    [dosya…]   başlıksız dosyalara başlık ekler (dosya yoksa: tüm git dosyaları)
    ankamon-lisans-basligi.py --denetle [dosya…]   başlıksız dosya varsa listeler, çıkış kodu 1 (pre-commit/CI)

Neden ayrı araç: `reuse annotate` Türkçe tam bildirimi, PHP'de `<?php`'den sonra, HTML'de doctype'tan sonra,
Dockerfile ayrıştırıcı yönergesinden (`# syntax=`) sonra yerleştirme ve ";" yorumlu ini dosyaları gibi
kurallarımızı tek seferde uygulamıyor. Yorum taşıyamayan dosyalar (JSON, sertifika, yama, .gitkeep) burada
atlanır, lisansları kökteki REUSE.toml'dadır — `reuse lint` ikisini birlikte doğrular.

Tam başlık ana program kodunda (py/php/js/sh, ≥ ANKAMON_TAM_BASLIK_ESIGI satır, actions/ dışı); kısa
SPDX başlığı yapılandırma, SQL, CSS, belge ve tahtaya gönderilen actions/ betiklerinde.
Telif yılı dosyanın ilk git commit yılıdır; sonraki yıllarda değişmişse aralık ("2026-2027").
"""
# REUSE-IgnoreStart — aşağıdaki SPDX dizgileri üretilecek başlıklardır, bu dosyanın değil.
import fnmatch
import os
import re
import subprocess
import sys
import time
import tomllib

# Eklenti depoları (ext/<ad>) aynı aracı kendi proje satırı ve adresiyle kullanır (ortam değişkenleri).
ANKAMON_PROJE_SATIRI = os.environ.get(
    "ANKAMON_PROJE_SATIRI", "Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu")
ANKAMON_TELIF_SAHIBI = "Özgür Koca <ozgurkoca@gmail.com>"
ANKAMON_DEPO_URL = os.environ.get("ANKAMON_DEPO_URL", "https://github.com/enseitankado/ankamon")
ANKAMON_SPDX = "AGPL-3.0-or-later"
ANKAMON_TAM_BASLIK_ESIGI = 40  # satır; daha kısa yardımcı dosyalar kısa başlık alır

ANKAMON_TAM_BILDIRIM = """\
Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
değiştirebilirsiniz.

Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.

Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
adresine bakınız.

Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13)."""

# Yorum biçimi: (satır öneki) ya da (blok açılış, satır öneki, blok kapanış)
_DIYEZ, _NOKTALI_VIRGUL, _CIFT_TIRE = "#", ";", "--"
_C_BLOK = ("/*", " *", " */")
_HTML_BLOK = ("<!--", "", "-->")
_NOKTALI_VIRGUL_DOSYALAR = {"php.ini", "php-fpm.conf", "supervisord.conf"}
_DIYEZ_UZANTILAR = {".py", ".sh", ".yml", ".yaml", ".conf", ".star", ".tsv", ".txt", ".toml", ".ini"}
_DIYEZ_ADLAR = {"Dockerfile", ".gitignore", ".dockerignore", ".gitattributes", ".env.example", "pre-push",
                "pre-commit"}
_TAM_BASLIK_UZANTILAR = {".py", ".php", ".js", ".sh"}


def ankamon_yorum_bicimi(yol):
    ad, uz = os.path.basename(yol), os.path.splitext(yol)[1]
    if ad in _NOKTALI_VIRGUL_DOSYALAR:
        return _NOKTALI_VIRGUL
    if uz in (".js", ".css", ".php"):
        return _C_BLOK
    if uz == ".sql":
        return _CIFT_TIRE
    if uz in (".html", ".md"):
        return _HTML_BLOK
    if uz in _DIYEZ_UZANTILAR or ad in _DIYEZ_ADLAR:
        return _DIYEZ
    return None


def ankamon_reuse_kapsami(kok):
    """REUSE.toml'daki yol kalıpları — bu dosyaların lisansı orada, başlık beklenmez."""
    try:
        with open(os.path.join(kok, "REUSE.toml"), "rb") as fh:
            veri = tomllib.load(fh)
    except FileNotFoundError:
        return []
    kaliplar = []
    for ann in veri.get("annotations", []):
        p = ann.get("path", [])
        kaliplar += [p] if isinstance(p, str) else p
    return kaliplar


def ankamon_lisans_metni_mi(yol):
    """LICENSE/COPYING ve LICENSES/ altındaki lisans metinleri başlık almaz (REUSE de onları atlar)."""
    return yol.startswith("LICENSES/") or re.match(r"(LICENSE|COPYING)(\.|$)", yol) is not None


def _kalip_eslesir(yol, kalip):
    # REUSE "**" = alt dizinler dahil; fnmatch "*" zaten "/" geçer, yeterli.
    return fnmatch.fnmatch(yol, kalip.replace("**", "*"))


def ankamon_telif_yili(kok, yol):
    def yil(*args):
        r = subprocess.run(["git", "-C", kok, "log", *args, "--format=%ad", "--date=format:%Y", "--", yol],
                           capture_output=True, text=True)
        satirlar = r.stdout.split()
        return satirlar
    ilk = yil("--diff-filter=A", "--follow")
    bas = ilk[-1] if ilk else time.strftime("%Y")
    tum = yil()
    son = max(tum + [bas]) if tum else bas
    return bas if son == bas else f"{bas}-{son}"


def ankamon_baslik_metni(bicim, tam, yil):
    if tam:
        govde = [f"SPDX-License-Identifier: {ANKAMON_SPDX}", "", ANKAMON_PROJE_SATIRI,
                 f"Copyright (C) {yil} {ANKAMON_TELIF_SAHIBI}", ANKAMON_DEPO_URL, ""] + \
                ANKAMON_TAM_BILDIRIM.split("\n")
    else:
        govde = [f"SPDX-FileCopyrightText: {yil} {ANKAMON_TELIF_SAHIBI}",
                 f"SPDX-License-Identifier: {ANKAMON_SPDX}"]
    if isinstance(bicim, tuple):
        acilis, onek, kapanis = bicim
        if bicim == _HTML_BLOK:
            return [acilis] + govde + [kapanis]
        return [acilis] + [(onek + " " + s).rstrip() for s in govde] + [kapanis]
    return [(bicim + " " + s).rstrip() for s in govde]


def ankamon_baslik_var_mi(metin):
    return "SPDX-License-Identifier:" in "\n".join(metin.split("\n")[:40])


def _ekleme_noktasi(yol, satirlar):
    """Başlığın gireceği satır: shebang, kodlama satırı, Dockerfile yönergesi, <?php, doctype korunur."""
    i = 0
    if satirlar and satirlar[0].startswith("#!"):
        i = 1
    if yol.endswith(".py") and len(satirlar) > i and re.match(r"#.*coding[:=]", satirlar[i]):
        i += 1
    if os.path.basename(yol) == "Dockerfile":
        while len(satirlar) > i and re.match(r"#\s*(syntax|escape|check)\s*=", satirlar[i], re.I):
            i += 1
    if yol.endswith(".php") and satirlar and satirlar[0].strip() == "<?php":
        i = 1
    if yol.endswith(".html") and satirlar and satirlar[0].lower().startswith("<!doctype"):
        i = 1
    return i


def ankamon_baslik_ekle(kok, yol):
    tam_yol = os.path.join(kok, yol)
    with open(tam_yol, encoding="utf-8") as fh:
        metin = fh.read()
    if ankamon_baslik_var_mi(metin):
        return False
    bicim = ankamon_yorum_bicimi(yol)
    satirlar = metin.split("\n")
    tam = (os.path.splitext(yol)[1] in _TAM_BASLIK_UZANTILAR and not yol.startswith("actions/")
           and len(satirlar) >= ANKAMON_TAM_BASLIK_ESIGI)
    baslik = ankamon_baslik_metni(bicim, tam, ankamon_telif_yili(kok, yol))
    i = _ekleme_noktasi(yol, satirlar)
    ayirici = [""] if len(satirlar) > i and satirlar[i].strip() else []
    satirlar[i:i] = baslik + ayirici
    with open(tam_yol, "w", encoding="utf-8") as fh:
        fh.write("\n".join(satirlar))
    return True


def main(argv):
    if not argv or argv[0] not in ("--ekle", "--denetle"):
        print(__doc__, file=sys.stderr)
        return 2
    kip, dosyalar = argv[0], argv[1:]
    kok = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True,
                         check=True).stdout.strip()
    if not dosyalar:
        dosyalar = subprocess.run(["git", "-C", kok, "ls-files"], capture_output=True, text=True,
                                  check=True).stdout.split("\n")
    kapsam = ankamon_reuse_kapsami(kok)
    eksik = []
    for yol in filter(None, dosyalar):
        yol = os.path.relpath(os.path.abspath(yol), kok) if os.path.isabs(yol) else yol
        if not os.path.isfile(os.path.join(kok, yol)) or any(_kalip_eslesir(yol, k) for k in kapsam):
            continue
        if ankamon_lisans_metni_mi(yol):
            continue
        if ankamon_yorum_bicimi(yol) is None:
            eksik.append(f"{yol} (yorum biçimi bilinmiyor — başlık ekleyin ya da REUSE.toml'a yazın)")
            continue
        if kip == "--ekle":
            if ankamon_baslik_ekle(kok, yol):
                print(f"başlık eklendi: {yol}")
        else:
            with open(os.path.join(kok, yol), encoding="utf-8") as fh:
                if not ankamon_baslik_var_mi(fh.read()):
                    eksik.append(yol)
    if eksik:
        print("Lisans başlığı eksik (scripts/ankamon-lisans-basligi.py --ekle <dosya>):", file=sys.stderr)
        for y in eksik:
            print(f"  {y}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
# REUSE-IgnoreEnd
