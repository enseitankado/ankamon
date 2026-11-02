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

"""Runner dalları: ekran görüntüsü, giriş kilidi, ekran aktarımı, ev dizini boyutları, yönetici parolası.

Hepsi tahta başına bağımsız kısa işlerdir: tahtalar PARALEL çalışır (whoami deseni); SSH iş parçacıklarında,
`conn`'a dokunan her şey ana iş parçacığında sırayla (tek bağlantı paylaşılmaz). Veritabanı gereken işler kendi
bağlantısını açar.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

from .. import db
from ..executor import board_password, homesize, inputlock, relay, screenshot, whoami
from ..executor.jobs import _board_access, _write_one
from . import stream

TYPES = ("screenshot", "input_lock", "relay_start", "relay_stop", "home_sizes",
         "password_status", "password_verify", "password_change")

# Çıktısı JSON olan görevlerde canlı pencereye yazılmaz (arayüz okur, pencere açılmaz).
_QUIET = ("home_sizes", "password_status")


def _parallel(conn, job, targets, names, results, work, after=None) -> None:
    n = max(1, min(whoami.dynamic_concurrency(), len(targets)))
    with ThreadPoolExecutor(max_workers=n) as pool:
        futures = {pool.submit(work, t): t for t in targets}
        for future in as_completed(futures):
            t = futures[future]
            result = future.result()
            ev = stream.Events(conn, job["id"], t["board_id"])
            if job["type"] not in _QUIET:
                for line in (result.get("output") or "").splitlines():
                    if line.strip() and not (job["type"] == "input_lock" and line.startswith("I")):
                        ev.add("out", line)
            ev.add("ok" if result["status"] == "ok" else "fail", "Tamam." if result["status"] == "ok" else "Başarısız.")
            ev.close()
            _write_one(conn, job, t["board_id"], result, names.get(t["board_id"], ""))
            results[t["board_id"]] = result
            if after and result["status"] == "ok":
                after(t, result)


def _own_conn(fn):
    """Veritabanı da gereken iş: iş parçacığı kendi bağlantısıyla çalışır, hata tahtayı başarısız sayar."""
    def run(t):
        conn = db.connect()
        try:
            return fn(conn, t)
        except Exception as e:  # noqa: BLE001 — bir tahtanın hatası diğerlerini düşürmesin
            return {"status": "failed", "rc": None, "output": f"Hata: {e}"}
        finally:
            conn.close()
    return run


def run(conn, job, targets, names, results) -> None:
    params = job["params"] or {}
    kind = job["type"]
    user, password = _board_access(conn)
    if not password:
        raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")

    if kind == "screenshot":
        taken_by = job["username"] or "?"
        _parallel(conn, job, targets, names, results,
                  _own_conn(lambda c, t: screenshot.take(c, t, user, password, taken_by)))
    elif kind == "input_lock":
        device, lock = params.get("device", ""), bool(params.get("lock", True))
        _parallel(conn, job, targets, names, results, lambda t: inputlock.apply(t, user, password, device, lock),
                  after=lambda t, r: inputlock.store(conn, t["board_id"], inputlock.parse(r["output"])))
    elif kind == "relay_start":
        def fan_out(work):
            done = {}
            _parallel(conn, job, targets, names, done, work)
            results.update(done)
            return done
        relay.start(conn, int(params["source_board_id"]), targets, params.get("stream", ""), job["username"] or "?",
                    user, password, fan_out)
    elif kind == "relay_stop":
        # Sırayla: durdurma aynı satırlara dokunabilir (seçimde hem kaynak hem hedef olabilir).
        for t in targets:
            result = relay.stop(conn, t, user, password)
            ev = stream.Events(conn, job["id"], t["board_id"])
            for line in (result.get("output") or "").splitlines():
                ev.add("out", line)
            ev.add("ok" if result["status"] == "ok" else "fail", "Tamam." if result["status"] == "ok" else "Başarısız.")
            ev.close()
            _write_one(conn, job, t["board_id"], result, names.get(t["board_id"], ""))
            results[t["board_id"]] = result
    elif kind == "home_sizes":
        _parallel(conn, job, targets, names, results, lambda t: homesize.query(t, user, password))
    elif kind == "password_status":
        _parallel(conn, job, targets, names, results, lambda t: board_password.status(t, user, password))
    elif kind == "password_verify":
        account, current = params.get("account", ""), params.get("current", "")
        _parallel(conn, job, targets, names, results,
                  _own_conn(lambda c, t: board_password.verify(c, t, user, password, account, current)))
    elif kind == "password_change":
        account, current, new = params.get("account", ""), params.get("current", ""), params.get("new", "")
        _parallel(conn, job, targets, names, results,
                  _own_conn(lambda c, t: board_password.change(c, t, user, password, account, current, new)))
    else:
        raise RuntimeError(f"Bilinmeyen görev türü: {kind}")


def scrub(conn, job) -> None:
    """Yönetici parolası görevlerinin parolaları görev bitince silinir (bkz. JobsApi::adminPasswordJob)."""
    if job["type"] in ("password_verify", "password_change"):
        conn.execute("UPDATE jobs SET params = params - 'current' - 'new' WHERE id = %s", (job["id"],))
