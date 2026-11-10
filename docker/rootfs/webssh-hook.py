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

"""Ankamon kancası: web terminal (webssh) oturumlarının gerçek açılış/kapanış zamanlarını
webshell_sessions tablosuna yazar (bkz. db/migrations/011_webshell_sessions.sql). İmaja
webssh/ankamon_hook.py olarak kopyalanır; çağrı noktalarını webssh-race-fix.py ekler:
  - handler.WsockHandler.open: WebSocket worker'a iliştiğinde → opened(worker)
  - worker.Worker.close: worker kapanınca → closed(worker)

Kanca webssh'i ASLA bozmamalı: her hata yutulur (yalnız loglanır). Veritabanı yazımı tornado
döngüsünde eşzamanlı yapılır — yerel soket, tek satırlık sorgu, oturum başına iki kez; ayrı bir
iş parçacığına değmez.
"""

import json
import logging
import os
import time

try:
    import psycopg
except ImportError:  # pragma: no cover — imajda py3-psycopg kurulu
    psycopg = None

_DSN = "host={} port={} dbname={} user={} password={} connect_timeout=2".format(
    os.environ.get("PG_HOST", "127.0.0.1"),
    os.environ.get("PG_PORT", "5432"),
    os.environ.get("PG_DB", "ankamon"),
    os.environ.get("PG_USER", "ankamon"),
    os.environ.get("PG_PASSWORD", ""),
)


def _exec(sql, params=()):
    if psycopg is None:
        return
    try:
        with psycopg.connect(_DSN, autocommit=True) as conn:
            conn.execute(sql, params)
    except Exception as exc:  # noqa: BLE001 — kanca webssh'i bozmamalı
        logging.warning("ankamon webshell kancası: %s", exc)


_SSH_LOG_DIR = "/run/ankamon/ssh-activity"
_ssh_started = {}


def _ssh_log(entry):
    """SSH etkinlik kaydı (alt çubuk ▸ SSH; biçim: worker/ankamon/sshactivity.py) — webssh paramiko ile bağlanır,
    sshpass sarmalayıcısından geçmez. Hata yutulur."""
    try:
        os.makedirs(_SSH_LOG_DIR, exist_ok=True)
        fd = os.open(os.path.join(_SSH_LOG_DIR, "log"), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            os.write(fd, (json.dumps(entry, ensure_ascii=False) + "\n").encode("utf-8"))
        finally:
            os.close(fd)
    except Exception as exc:  # noqa: BLE001
        logging.warning("ankamon ssh kaydı: %s", exc)


def opened(worker):
    """Bu IP için henüz eşleşmemiş en eski isteği (son 2 dk) bu worker'a bağlar."""
    try:
        user = worker.ssh.get_transport().get_username() or ""
    except Exception:  # noqa: BLE001
        user = ""
    try:
        host, port = worker.dst_addr[0], worker.dst_addr[1]
        ts = int(time.time())
        _ssh_started[worker.id] = ts
        _ssh_log({"ev": "start", "ts": ts, "pid": "webssh:" + str(worker.id), "src": "webssh", "tool": "ssh",
                  "target": (user + "@" if user else "") + str(host), "port": "" if str(port) == "22" else str(port),
                  "tunnel": "", "cmd": "(web terminal — etkileşimli kabuk)"})
    except Exception as exc:  # noqa: BLE001
        logging.warning("ankamon ssh kaydı: %s", exc)
    _exec(
        """UPDATE webshell_sessions SET worker_id = %s, started_at = now()
           WHERE id = (SELECT id FROM webshell_sessions
                       WHERE ip = %s AND worker_id IS NULL AND requested_at > now() - interval '2 minutes'
                       ORDER BY requested_at LIMIT 1)""",
        (worker.id, str(worker.dst_addr[0])),
    )
    # Bağlantısı hiç kurulamamış eski istekler birikmesin.
    _exec("DELETE FROM webshell_sessions WHERE worker_id IS NULL AND requested_at < now() - interval '1 day'")


def closed(worker):
    if worker.id in _ssh_started:
        _ssh_log({"ev": "end", "ts": int(time.time()), "pid": "webssh:" + str(worker.id),
                  "start": _ssh_started.pop(worker.id)})
    _exec(
        "UPDATE webshell_sessions SET ended_at = now(), end_reason = 'closed' WHERE worker_id = %s AND ended_at IS NULL",
        (worker.id,),
    )


def startup():
    """webssh (yeniden) başladı: önceki süreçteki açık oturumların hepsi kopmuştur."""
    _exec(
        """UPDATE webshell_sessions SET ended_at = now(), end_reason = 'restart'
           WHERE ended_at IS NULL AND started_at IS NOT NULL"""
    )


startup()
