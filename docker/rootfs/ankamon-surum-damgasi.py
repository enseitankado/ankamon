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

"""Üst çubuktaki sürüm/derleme bilgisi: imaj üretilirken bir kez /opt/ankamon/surum-damgasi.json'a yazılır.

Kaynak dizinde (Dockerfile'daki COPY) frontend/Manifest.json ile .git'ten yalnız HEAD, packed-refs ve
refs/heads içeriği bulunur; dal başvurusu oradan çözülür. .git yoksa (kaynak arşivinden derleme) commit boş
kalır, yalnız sürüm görünür. Kurulum `git clone --depth 1` yaptığından commit sayısı kullanılamaz.
Bu betiğin katmanı yalnız dal başvuruları ya da Manifest değişince yeniden çalışır: damga, imajın
gerçekten üretildiği zamanı gösterir.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SHA_RE = re.compile(r"^[0-9a-f]{40,64}$")


def resolve_commit(src: Path) -> str:
    """HEAD'in kısa commit kodu; çözülemezse boş metin."""
    try:
        head = (src / "HEAD").read_text().strip()
    except OSError:
        return ""
    sha = head
    if head.startswith("ref: "):
        ref = head[5:].strip()
        sha = ""
        loose = src / ref.removeprefix("refs/heads/")
        if loose.is_file():
            sha = loose.read_text().strip()
        else:
            try:
                for line in (src / "packed-refs").read_text().splitlines():
                    if line.endswith(f" {ref}"):
                        sha = line.split(" ", 1)[0]
                        break
            except OSError:
                pass
    return sha[:7] if SHA_RE.match(sha) else ""


def main() -> None:
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    manifest = json.loads((src / "Manifest.json").read_text())
    out.write_text(json.dumps({
        "version": manifest["info"]["version"],
        "commit": resolve_commit(src),
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }))


if __name__ == "__main__":
    main()
