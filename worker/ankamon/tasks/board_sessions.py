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

"""Tahta (greeter) oturumlarını logs tablosundan çıkarıp board_sessions'a işler.

Gerçek kullanıcı girişi/çıkışı lightdm'in PAM mesajlarından okunur:
    pam_unix(lightdm:session): session opened for user <ad>(uid=<uid>) by (uid=0)
    pam_unix(lightdm:session): session closed for user <ad>
(Otomatik girişte — ör. TiHA'nın profil geçişi — servis adı "lightdm-autologin:session" olur;
o da gerçek kullanıcı oturumudur.)
Ankamon'un "Oturum aç" hesap işlemi (executor/accounts.py) LightDM autologin'i kullanır; o girişler
"pam_unix(lightdm-autologin:session)" ile gelir ve aynı şekilde sayılır.
("lightdm-greeter:session" biçimi greeter'ın KENDİ arka plan oturumudur — "lightdm" sistem
hesabıyla, gerçek kullanıcı değildir; hariç tutulur.)

logs hypertable'ında satır kimliği yoktur; bu yüzden task_cursors'ta son işlenen received_at
zaman damgası tutulur, her turda yalnız ondan sonrakiler (en çok _BATCH kadar) okunur — aynı
satır iki kez işlenmez, büyük geçmiş birikintisi birkaç tura yayılarak işlenir.

Kapanış mesajı HER ZAMAN gelmez (elektrik kesintisi, fiziksel güç düğmesiyle zorla kapatma, çok
hızlı "Kapat" komutu — PAM'ın kapanış mesajı sunucuya yetişemeyebilir). Bu yüzden ayrıca:
  - tahtası ÇEVRİMDIŞI olan ama hâlâ "açık" görünen oturumlar en iyi tahminle kapatılır
    (end_reason='offline', bkz. _close_offline) — elektrik kesintisi/zorla kapatma/çok hızlı
    kapanma hep burada toplanır;
  - kapanış mesajı hiç gelmeden AYNI tahtada yeni bir oturum açılırsa öncekini "superseded"
    sayıp yeninin başlangıcında kapatır (kapanış mesajı kaybolmuş, tahta hemen yeniden kullanılmış).

__main__.py'de board_status ile AYNI hızlı döngüde (STATUS_TICK_SECONDS) çalışır ki oturum
açma/kapama grid'e "anında" yansısın, TICK_SECONDS'ı (varsayılan 60 sn) beklemesin.
"""

import logging
import re

log = logging.getLogger(__name__)

_CURSOR = "board_sessions.watermark"
_GREETER_USER = "lightdm"
_BATCH = 2000

_OPEN_RE = re.compile(r"^pam_unix\(lightdm(?:-autologin)?:session\): session opened for user (\S+)\(uid=(\d+)\) by")
_CLOSE_RE = re.compile(r"^pam_unix\(lightdm(?:-autologin)?:session\): session closed for user (\S+)")

RECENT = """
    SELECT host, message, received_at
    FROM logs
    WHERE program = 'lightdm' AND received_at > %(since)s
    ORDER BY received_at ASC
    LIMIT {batch}
""".format(batch=_BATCH)


def run(conn) -> None:
    since = _cursor(conn) or "1970-01-01"
    rows = conn.execute(RECENT, {"since": since}).fetchall()
    for row in rows:
        _handle(conn, row)
    if rows:
        _save_cursor(conn, rows[-1]["received_at"])
    # Büyük bir geçmiş birikintisi varsa (ör. ilk çalıştırma) _close_offline'ı henüz çalıştırma:
    # tam o anda işlenmemiş ama ileride gelecek bir 'logout' mesajını "offline" sayıp yanlış
    # kapatmasın. Parti tam doluysa (daha işlenecek satır var demektir) bir sonraki tura bırakılır;
    # güncel satırlara yetiştiğimizde (parti _BATCH'ten küçük) normal şekilde her tur çalışır.
    if len(rows) < _BATCH:
        _close_offline(conn)
    _link_orphans(conn)


def _link_orphans(conn) -> None:
    """Tahta kaydı oturumdan SONRA açılmışsa (silinip loglardan yeniden açılan ya da elle eklenen tahta)
    o adın tahtasız oturumlarını tahtaya bağlar — Oturumlar'da tahtanın takma adıyla görünsünler."""
    linked = conn.execute(
        """UPDATE board_sessions s SET board_id = b.id FROM boards b
           WHERE s.board_id IS NULL AND lower(b.hostname) = lower(s.host)""").rowcount
    if linked:
        log.info("%d tahtasız oturum tahtasına bağlandı", linked)


def _cursor(conn):
    row = conn.execute("SELECT value FROM task_cursors WHERE name = %s", (_CURSOR,)).fetchone()
    return row["value"] if row else None


def _save_cursor(conn, value) -> None:
    conn.execute(
        """INSERT INTO task_cursors (name, value, updated_at) VALUES (%s, %s, now())
           ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
        (_CURSOR, value))


def _board_id(conn, host):
    row = conn.execute("SELECT id FROM boards WHERE lower(hostname) = lower(%s)", (host,)).fetchone()
    return row["id"] if row else None


def _handle(conn, row) -> None:
    host, message, when = row["host"], row["message"], row["received_at"]

    m = _OPEN_RE.match(message)
    if m:
        username, uid = m.group(1), int(m.group(2))
        if username == _GREETER_USER:
            return  # greeter'ın kendi arka plan oturumu — gerçek kullanıcı değil
        # İmleç geri sarılıp aynı satır yeniden işlenirse (geçmişi doldurma) çift kayıt açma.
        if conn.execute(
                """SELECT 1 FROM board_sessions WHERE host = %s AND username = %s AND started_at = %s""",
                (host, username, when)).fetchone():
            return
        # Bu tahtada hâlâ "açık" görünen başka bir oturum varsa: kapanış mesajı kaybolmuş sayılır.
        conn.execute(
            """UPDATE board_sessions SET ended_at = %s, end_reason = 'superseded'
               WHERE host = %s AND ended_at IS NULL""",
            (when, host))
        conn.execute(
            """INSERT INTO board_sessions (board_id, host, username, uid, started_at)
               VALUES (%s, %s, %s, %s, %s)""",
            (_board_id(conn, host), host, username, uid, when))
        log.info("oturum açıldı: %s @ %s", username, host)
        return

    m = _CLOSE_RE.match(message)
    if m:
        username = m.group(1)
        if username == _GREETER_USER:
            return
        updated = conn.execute(
            """UPDATE board_sessions SET ended_at = %s, end_reason = 'logout'
               WHERE id = (SELECT id FROM board_sessions
                           WHERE host = %s AND username = %s AND ended_at IS NULL
                           ORDER BY started_at DESC LIMIT 1)""",
            (when, host, username)).rowcount
        if updated:
            log.info("oturum kapandı: %s @ %s", username, host)


_STALE = "15 minutes"  # boards_from_logs.py'nin RECENT penceresiyle aynı eşik


def _close_offline(conn) -> None:
    """Tahtası çevrimdışı olan ama hâlâ 'açık' görünen oturumları en iyi tahminle kapatır.

    board_status (aynı hızlı döngüde, bu görevden önce — bkz. tasks/__init__.py sırası)
    `boards.online`'ı STATUS_TICK_SECONDS'ta bir günceller; bu yüzden bir oturumun "fark
    edilmeden" açık kalma süresi en kötü durumda bir STATUS_TICK_SECONDS kadardır.

    İki durum ayrı ele alınır: (1) oturumun board_id'si var ve o tahta artık çevrimdışı
    (board_status'a göre); (2) hostname `boards`'ta hiç yok (ör. kaydı henüz açılmamış
    ya da silinmiş ama cihaz hâlâ log gönderiyor) — bu durumda tahtanın kendi
    "online" kaydı olmadığından, hostname'in son _STALE süresinde hiç log göndermemiş olması
    çevrimdışı sayılır.
    """
    conn.execute("""
        UPDATE board_sessions s SET
            ended_at = GREATEST(b.last_seen_at, b.last_log_at, s.started_at),
            end_reason = 'offline'
        FROM boards b
        WHERE s.ended_at IS NULL AND s.board_id = b.id AND b.online = false
    """)
    conn.execute(f"""
        UPDATE board_sessions s SET ended_at = now(), end_reason = 'offline'
        WHERE s.ended_at IS NULL AND s.board_id IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM logs l
              WHERE lower(l.host) = lower(s.host) AND l.received_at > now() - interval '{_STALE}'
          )
    """)
