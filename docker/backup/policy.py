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

"""Yedekleme planını (settings.backup_policy — Sistem ▸ Yedekler) backup.sh için kabuk değişkenlerine çevirir.

Girdi (stdin): settings tablosundaki JSON (yoksa boş). Eksik/geçersiz alan ortam değişkenindeki kurulum varsayılanına
düşer (BACKUP_CONFIG_EVERY_HOURS, BACKUP_FULL_AT, BACKUP_KEEP_CONFIG, BACKUP_KEEP_FULL, HOME_BACKUP_KEEP_HOURS). Aynı
varsayılanlar backend Core\\BackupPolicy'de de vardır — biri değişirse öteki de. Çıktı: `eval` edilecek KEY='değer' satırları.
"""
import json
import os
import re
import sys


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def clock(value, default):
    return value if isinstance(value, str) and re.fullmatch(r"([01][0-9]|2[0-3]):[0-5][0-9]", value) else default


def number(value, default, lo, hi):
    return value if isinstance(value, int) and not isinstance(value, bool) and lo <= value <= hi else default


def main():
    try:
        policy = json.loads(sys.stdin.read() or "{}") or {}
    except ValueError:
        policy = {}
    if not isinstance(policy, dict):
        policy = {}
    part = lambda key: policy.get(key) if isinstance(policy.get(key), dict) else {}  # noqa: E731
    config, full, files, home = part("config"), part("full"), part("files"), part("home")
    full_at = clock(os.environ.get("BACKUP_FULL_AT", "03:30"), "03:30")
    out = {
        "CONFIG_ON": 0 if config.get("enabled") is False else 1,
        "CONFIG_EVERY": number(config.get("every_hours"), env_int("BACKUP_CONFIG_EVERY_HOURS", 6), 1, 168),
        "CONFIG_KEEP": number(config.get("keep"), env_int("BACKUP_KEEP_CONFIG", 28), 1, 1000),
        "FULL_ON": 0 if full.get("enabled") is False else 1,
        "FULL_AT": clock(full.get("at"), full_at),
        "FULL_KEEP": number(full.get("keep"), env_int("BACKUP_KEEP_FULL", 7), 1, 365),
        "FILES_ON": 0 if files.get("enabled") is False else 1,
        "FILES_AT": clock(files.get("at"), "04:00"),
        "FILES_KEEP": number(files.get("keep"), 7, 1, 365),
        "HOME_KEEP_HOURS": number(home.get("keep_hours"), env_int("HOME_BACKUP_KEEP_HOURS", 72), 1, 24 * 90),
    }
    for key, value in out.items():
        print(f"{key}='{value}'")


if __name__ == "__main__":
    main()
