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

"""ntfy (https://ntfy.sh, Apache-2.0/GPL-2.0; açık kaynak bildirim hizmeti) ile telefona bildirim.

Başlıklar UTF-8 taşıyamadığından JSON ile yayınlanır (sunucunun köküne POST, konu gövdede). Konu adı parola gibidir: adı
bilen herkes okuyabilir, bu yüzden tahmin edilemez olmalıdır (arayüz öneri üretir — bkz. ui.anomaly.Notifications).
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

TOPIC_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
DEFAULT_SERVER = "https://ntfy.sh"


def config(conn) -> dict:
    row = conn.execute("SELECT value FROM settings WHERE key = 'ntfy'").fetchone()
    value = (row["value"] if row else None) or {}
    return {"server": (value.get("server") or DEFAULT_SERVER).rstrip("/"), "topic": value.get("topic") or ""}


def publish(server: str, topic: str, title: str, body: str, tags: list[str] | None = None) -> str | None:
    """Gönderir. Döner: None (başarılı) ya da hata metni."""
    if not TOPIC_RE.match(topic or ""):
        return "Geçersiz konu adı."
    payload = {"topic": topic, "title": title[:200], "message": body[:3500], "tags": tags or ["warning"]}
    req = urllib.request.Request(server + "/", data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "Ankamon"})
    try:
        with urllib.request.urlopen(req, timeout=15):
            return None
    except urllib.error.HTTPError as e:
        return f"Sunucu yanıtı: HTTP {e.code}"
    except (urllib.error.URLError, OSError, ValueError) as e:
        return f"Bağlanılamadı: {getattr(e, 'reason', e)}"


def send_logged(conn, cfg: dict, rule_id, rule_name: str, title: str, body: str, board_id=None, kind=None, tags=None) -> bool:
    """Gönderir ve sonucu ntfy_messages'a yazar."""
    error = publish(cfg["server"], cfg["topic"], title, body, tags)
    conn.execute(
        """INSERT INTO ntfy_messages (rule_id, rule_name, topic, title, body, board_id, kind, status, error)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (rule_id, rule_name, cfg["topic"], title, body, board_id, kind, "failed" if error else "ok", error))
    return error is None
