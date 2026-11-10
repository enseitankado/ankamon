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

"""SSH etkinlik kaydı — sshpass sarmalayıcısından (docker/rootfs/ankamon-sshpass.sh) GEÇMEYEN bağlantılar için.

Alt çubuk ▸ SSH paneli (kullanıcı isteği 2026-11-10) Ankamon'un dışarıya açtığı bütün SSH bağlantılarını ve gönderdiği
komutları canlı gösterir. Kayıtların çoğunu sarmalayıcı yazar; sshfs (dosya yöneticisi — kendi ssh sürecini başlatır)
gibi onu atlayan yollar aynı dosyaya aynı biçimde buradan yazar. Okuyan: backend SshActivityApi.

Satır biçimi (JSON, satır başına bir olay):
  {"ev":"start","ts":<epoch sn>,"pid":<anahtar>,"src":"files","tool":"sshfs","target":"root@ip","port":"",
   "tunnel":"","cmd":"…"}
  {"ev":"end","ts":<epoch sn>,"pid":<anahtar>,"start":<başlangıç ts>}
Kayıt hatası işi asla bozmaz (yutulur).
"""

import json
import os
import time

DIR = "/run/ankamon/ssh-activity"
LOG = os.path.join(DIR, "log")
MAX_BYTES = 3_000_000


def _append(entry: dict) -> None:
    try:
        os.makedirs(DIR, exist_ok=True)
        try:
            if os.path.getsize(LOG) > MAX_BYTES:
                os.replace(LOG, LOG + ".1")
        except OSError:
            pass
        line = (json.dumps(entry, ensure_ascii=False) + "\n").encode("utf-8")
        fd = os.open(LOG, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            os.write(fd, line)
        finally:
            os.close(fd)
    except Exception:  # noqa: BLE001 — kayıt işi bozmasın
        pass


def start(key: str, src: str, tool: str, target: str, cmd: str = "") -> int:
    """Bağlantı başladı; döner: başlangıç zamanı (end()'e verilir)."""
    ts = int(time.time())
    _append({"ev": "start", "ts": ts, "pid": key, "src": src, "tool": tool, "target": target,
             "port": "", "tunnel": "", "cmd": cmd[:3000]})
    return ts


def end(key: str, started: int | None) -> None:
    _append({"ev": "end", "ts": int(time.time()), "pid": key, "start": started or 0})
