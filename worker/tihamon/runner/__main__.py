"""Görev yürütücüsü süreci (supervisord: runner). Bkz. paket açıklaması."""

from __future__ import annotations

import json
import logging
import os
import select
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from .. import activity, db
from ..executor import accounts, backup, cast, diagnose, display, hwfacts, session_probe, tools, whoami, wol
from ..executor.jobs import ACTIONS_DIR, _board_access, _claim, _targets, _write_one, _write_results
from . import stream

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("tihamon.runner")

JOB_THREADS = int(os.environ.get("RUNNER_JOB_THREADS", "8"))  # aynı anda çalışan görev
POLL_SECONDS = 3


def _job_text(job) -> tuple[str, dict | None, int]:
    """Görev türüne göre tahtada çalışacak betik, ortam değişkenleri ve zaman aşımı."""
    params = job["params"] or {}
    if job["type"] == "command":
        return params["command"], None, 120
    action_dir = os.path.join(ACTIONS_DIR, params["action"])
    with open(os.path.join(action_dir, "action.json"), encoding="utf-8") as f:
        timeout = int(json.load(f).get("timeout", 120))
    with open(os.path.join(action_dir, "run.sh"), encoding="utf-8") as f:
        script = f.read()
    return script, {k: str(v) for k, v in (params.get("values") or {}).items()}, timeout


def _action_def(job) -> dict:
    """Hazır işlemin action.json tanımı (command görevlerinde boş)."""
    if job["type"] != "action":
        return {}
    with open(os.path.join(ACTIONS_DIR, (job["params"] or {})["action"], "action.json"), encoding="utf-8") as f:
        return json.load(f)


def _scrub_secrets(conn, job) -> None:
    """"password" türündeki parametre değerlerini (ör. BIOS parolası) görev bitince jobs.params'tan siler:
    yalnız görev beklerken/çalışırken saklanır (API ve audit_log zaten maskeli görür — Core\\Actions::redactParams)."""
    try:
        keys = [p["key"] for p in _action_def(job).get("params", []) if p.get("type") == "password"]
    except (OSError, ValueError, KeyError):
        return
    for key in keys:
        conn.execute(
            """UPDATE jobs SET params = jsonb_set(params, ARRAY['values', %s], '"***"')
               WHERE id = %s AND COALESCE(params->'values'->>%s, '') <> ''""",
            (key, job["id"], key))


def _board_event(conn, job_id: int, board_id: int, kind: str, text: str) -> None:
    """Paralel çalışan dallarda (whoami/login/logout) canlı pencereye tahta başına satır yazar —
    yoksa bu görevlerin penceresi boş kalıyordu (kullanıcı bildirdi). Ana iş parçacığında çağrılır."""
    ev = stream.Events(conn, job_id, board_id)
    ev.add(kind, text)
    ev.close()


def _run_job(job) -> None:
    conn = db.connect()
    general = stream.Events(conn, job["id"], None)
    try:
        targets = _targets(conn, job["id"])
        names = {t["board_id"]: t["name"] for t in targets}
        general.add("info", f"Görev başladı: {job['title']} — {len(targets)} tahta")
        general.flush()
        activity.record(conn, f"Görev başladı: {job['title']} ({job['username'] or '—'})")
        # Komut/hazır işlemde tahtalar grup grup çalışır: sıra gelene kadar "queued" kalır, her tahta
        # kendi işi başlarken "running" olur (canlı pencerede çalışan/sırada/biten ayrımı — bkz. ui/Jobs.js).
        if job["type"] not in ("command", "action"):
            conn.execute("UPDATE job_targets SET status = 'running', started_at = now() WHERE job_id = %s", (job["id"],))
        results: dict[int, dict] = {}

        if job["type"] == "wol":
            for t in targets:
                ev = stream.Events(conn, job["id"], t["board_id"])
                ev.add("info", f"Uyandırma paketi gönderiliyor: MAC {t['mac'] or '—'}")
                ok, msg = wol.wake(t["mac"], t["ip"])
                ev.add("ok" if ok else "fail", msg)
                ev.close()
                results[t["board_id"]] = {"status": "ok" if ok else "failed", "rc": 0 if ok else None, "output": msg}
                _write_one(conn, job, t["board_id"], results[t["board_id"]], names.get(t["board_id"], ""))
        elif job["type"] in ("command", "action"):
            user, password = _board_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            body, env, timeout = _job_text(job)
            # Tahtaya taşınacak dış araçlar (action.json "tools", ör. eta-112): sunucu kopyası bir kez
            # hazırlanır (günün ilk kullanımında sürüm denetimi), her tahtaya gerekirse SFTP ile gider.
            try:
                prepared = {name: tools.ensure(name, general) for name in _action_def(job).get("tools", [])}
            except tools.ToolError as e:
                raise RuntimeError(str(e)) from e

            # Tahtalar PARALEL çalışır, aynı anda en çok `n` tahta (kullanıcı isteği): n konteynerin o anki
            # CPU/RAM boşluğuna göre (whoami.dynamic_concurrency) — kaynak azsa tahtalar grup grup işlenir,
            # biten tahtanın yerine sıradaki başlar. Her iş parçacığı KENDİ veritabanı bağlantısını açar:
            # tek bağlantının iş parçacıkları arasında paylaşılması güvenli değildi (eskiden bu yüzden
            # sıralıydı — birden fazla tahtada yalnız biri tamamlanıyordu). Çıktı tahta başına ayrı tutulur
            # (job_events.board_id), pencerede tahta seçilerek okunur.
            action = (job["params"] or {}).get("action") if job["type"] == "action" else None

            def work(t):
                wconn = db.connect()
                try:
                    wconn.execute("UPDATE job_targets SET status = 'running', started_at = now() WHERE job_id = %s AND board_id = %s",
                                  (job["id"], t["board_id"]))
                    ev = stream.Events(wconn, job["id"], t["board_id"])
                    try:
                        if not t["ip"]:
                            ev.add("fail", "Tahtanın IP adresi yok.")
                            result = {"status": "unreachable", "rc": None, "output": "Tahtanın IP adresi yok."}
                        else:
                            result = None
                            for name, local in prepared.items():
                                try:
                                    tools.upload(t, user, password, name, local, ev)
                                except (tools.ToolError, OSError, subprocess.TimeoutExpired) as e:
                                    ev.add("fail", f"{tools.TOOLS[name]['title']} tahtaya kopyalanamadı: {e}")
                                    result = {"status": "unreachable", "rc": None, "output": f"Araç kopyalanamadı: {e}"}
                                    break
                            if result is None:
                                result = stream.run(t, user, password, body=body, env=env, timeout=timeout, events=ev)
                    except Exception as e:  # tek tahtanın beklenmedik hatası diğerlerini durdurmasın
                        log.exception("görev #%s tahta %s", job["id"], t["board_id"])
                        ev.add("fail", f"Beklenmeyen hata: {e}")
                        result = {"status": "failed", "rc": None, "output": f"Beklenmeyen hata: {e}"}
                    finally:
                        ev.close()
                    _write_one(wconn, job, t["board_id"], result, names.get(t["board_id"], ""))
                    # Wi-Fi aç/kapat: grid'in "Wi-Fi" sütunu ve Bilgi kartı yeni durumu hemen göstersin.
                    if action in hwfacts.WIFI_ACTIONS and result["status"] == "ok":
                        hwfacts.mark_wifi_radio(wconn, t["board_id"], hwfacts.WIFI_ACTIONS[action])
                    # Kullanıcı sil: "Oturum aç"/"Yedekle"/"Kullanıcı sil" listeleri silineni göstermesin
                    # (kısmi başarıda da — bazı hesaplar silinmiş olabilir).
                    if action == "user-delete":
                        accounts.invalidate(wconn, t["board_id"])
                    return result
                finally:
                    wconn.close()

            n = max(1, min(whoami.dynamic_concurrency(), len(targets)))
            if len(targets) > 1:
                general.add("info", f"{len(targets)} tahtada paralel çalışıyor — aynı anda en çok {n} tahta"
                            + (" (sistem kaynaklarına göre; diğerleri sırada bekler)" if n < len(targets) else ""))
                general.flush()
            with ThreadPoolExecutor(max_workers=n) as pool:
                futures = {pool.submit(work, t): t for t in targets}
                for future in as_completed(futures):
                    results[futures[future]["board_id"]] = future.result()
        elif job["type"] == "whoami":
            user, password = _board_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            # Burada (command/action'ın aksine) tahtalar PARALEL sorgulanır: her tahta bağımsız,
            # tek satırlık bir sonuç üretir — sırayla okunacak bir çıktı akışı yok, önizleme
            # kutucuklarının hepsi aynı anda "sorgulanıyor" göstermesi de bunu gerektiriyor (bkz.
            # frontend). Eşzamanlılık konteynerin o anki CPU/RAM yüküne göre dinamik (kullanıcı
            # isteği — bkz. whoami.dynamic_concurrency). Yalnız asıl SSH alt süreçleri iş
            # parçacıklarında çalışır; `conn`'a dokunan her şey (_write_one) ana iş parçacığında
            # SIRAYLA yapılır — tek bağlantının iş parçacıkları arasında eşzamanlı paylaşılması
            # command/action'da (bkz. yukarıdaki not) güvenli değildi, burada da aynı kısıtlama geçerli.
            for t in targets:
                _board_event(conn, job["id"], t["board_id"], "info", f"Oturumlar sorgulanıyor: root@{t['ip'] or '—'} …")
            n = whoami.dynamic_concurrency()
            with ThreadPoolExecutor(max_workers=max(1, min(n, len(targets)))) as pool:
                futures = {pool.submit(whoami.query, t, user, password): t for t in targets}
                for future in as_completed(futures):
                    t = futures[future]
                    result = future.result()
                    _write_one(conn, job, t["board_id"], result, names.get(t["board_id"], ""))
                    results[t["board_id"]] = result
                    if result["status"] != "ok":
                        _board_event(conn, job["id"], t["board_id"], "fail", f"Sorgulanamadı: {result['output']}")
                    elif result["output"]:
                        _board_event(conn, job["id"], t["board_id"], "ok", f"Açık oturum: {result['output']}")
                    else:
                        _board_event(conn, job["id"], t["board_id"], "ok", "Açık kullanıcı oturumu yok (tahta giriş ekranında).")
                    if result["status"] == "ok":   # grid'in "Oturum" sütunu (kilidi `who` bilmez: None)
                        session_probe.store(conn, t["board_id"], result["output"], None)
        elif job["type"] == "facts":
            # "Bilgi kartı": tahta başına 60dk önbellek (bkz. hwfacts.CACHE_SECONDS) — önbellekte
            # taze bir değer varsa SSH'a hiç gidilmez, hemen o değer yazılır. Geri kalanlar whoami ile
            # aynı desende PARALEL toplanır (bağımsız, kısa, tek betiklik sorgular).
            now_ts = int(time.time())
            cutoff = now_ts - hwfacts.CACHE_SECONDS
            pending = []
            for t in targets:
                cached = hwfacts.cached(conn, t["board_id"], cutoff)
                if cached is None:
                    pending.append(t)
                    continue
                result = {"status": "ok", "rc": 0, "output": json.dumps(cached, ensure_ascii=False)}
                _write_one(conn, job, t["board_id"], result, names.get(t["board_id"], ""))
                results[t["board_id"]] = result
            if pending:
                user, password = _board_access(conn)
                if not password:
                    raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
                n = whoami.dynamic_concurrency()
                with ThreadPoolExecutor(max_workers=max(1, min(n, len(pending)))) as pool:
                    futures = {pool.submit(hwfacts.query, t, user, password): t for t in pending}
                    for future in as_completed(futures):
                        t = futures[future]
                        result = future.result()
                        if result["status"] == "ok":
                            hwfacts.store(conn, t["board_id"], json.loads(result["output"]), now_ts)
                        _write_one(conn, job, t["board_id"], result, names.get(t["board_id"], ""))
                        results[t["board_id"]] = result
        elif job["type"] == "accounts":
            # "Oturum aç" alt menüsünün hesap listesi (bkz. executor/accounts.py): 24 saat önbellek.
            now_ts = int(time.time())
            for t in targets:
                listed = accounts.cached(conn, t["board_id"], now_ts - accounts.CACHE_SECONDS)
                if listed is not None:
                    result = {"status": "ok", "rc": 0, "output": json.dumps(listed, ensure_ascii=False)}
                else:
                    user, password = _board_access(conn)
                    if not password:
                        raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
                    result = accounts.list_accounts(t, user, password)
                    if result["status"] == "ok":
                        accounts.store(conn, t["board_id"], json.loads(result["output"]), now_ts)
                _write_one(conn, job, t["board_id"], result, names.get(t["board_id"], ""))
                results[t["board_id"]] = result
        elif job["type"] in ("login", "logout", "lock", "wake"):
            # Seçilen hesapla oturum açma / açık oturumu kapatma ya da kilitleme — tahtalar bağımsız,
            # PARALEL (whoami deseni). logout/lock'ta username isteğe bağlı (Oturumlar grid'i belirli
            # kullanıcıyı hedefler; boşsa tahtadaki etkin oturum).
            username = (job["params"] or {}).get("username", "")
            user, password = _board_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            if job["type"] == "login":
                def work(t):
                    return accounts.login(t, user, password, username)
            elif job["type"] == "logout":
                def work(t):
                    return accounts.logout(t, user, password, username)
            elif job["type"] == "lock":
                def work(t):
                    return accounts.lock(t, user, password, username)
            else:
                # Ekran ▸ Uyandır: güç tasarrufundaki ekranı uyandırır (bkz. executor/display.py).
                def work(t):
                    return display.wake(t, user, password)
            who = f"{username} oturumu" if username else "Açık oturum"
            start = {"login": f"{username} hesabıyla oturum açılıyor…",
                     "logout": f"{who} kapatılıyor…", "lock": f"{who} kilitleniyor…",
                     "wake": "Ekran uyandırılıyor…"}[job["type"]]
            for t in targets:
                _board_event(conn, job["id"], t["board_id"], "info", f"Bağlanılıyor: root@{t['ip'] or '—'} — {start}")
            n = whoami.dynamic_concurrency()
            with ThreadPoolExecutor(max_workers=max(1, min(n, len(targets)))) as pool:
                futures = {pool.submit(work, t): t for t in targets}
                for future in as_completed(futures):
                    t = futures[future]
                    result = future.result()
                    _write_one(conn, job, t["board_id"], result, names.get(t["board_id"], ""))
                    results[t["board_id"]] = result
                    ev = stream.Events(conn, job["id"], t["board_id"])
                    for line in (result["output"] or "").splitlines():
                        if line.strip():
                            ev.add("out", line)
                    ev.add("ok" if result["status"] == "ok" else "fail",
                           "Bitti." if result["status"] == "ok" else f"Başarısız ({result['status']}).")
                    ev.close()
                    # Tahtalar grid'inin "Oturum" sütunu hemen güncellensin (bkz. executor/session_probe.py).
                    if result["status"] == "ok" and job["type"] == "wake":
                        # Ekranlar'daki "güç tasarrufu" yazısı bir sonraki yoklamayı beklemeden kalksın.
                        session_probe.store_display(conn, t["board_id"], "On")
                    elif result["status"] == "ok":
                        if job["type"] == "login":
                            session_probe.store(conn, t["board_id"], username, False)
                        else:
                            # Kapatılan/kilitlenen oturum etkin olan olmayabilir (arka planda başka
                            # oturumlar kalabilir): tahmin etmek yerine gerçek durumu yeniden yokla.
                            st = session_probe.probe(t, user, password)
                            if st["ok"]:
                                session_probe.store(conn, t["board_id"], st["user"], st["locked"])
                                session_probe.store_display(conn, t["board_id"], st["display"])
        elif job["type"] == "backup_home":
            # "Yedekle": tahtalar SIRAYLA (command/action gibi) — her tahtanın canlı raporu ve ilerlemesi
            # okunaklı aksın, aynı anda onlarca tahtanın ağ/disk yükü birikmesin; `conn` da yalnız bu
            # iş parçacığında kullanılır (bkz. yukarıdaki not). Eski yedekler önce temizlenir.
            username = (job["params"] or {}).get("username", "")
            user, password = _board_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            removed = backup.cleanup()
            if removed:
                general.add("info", f"{removed} eski yedek dizini silindi ({backup.KEEP_HOURS} saatten eski).")
            for t in targets:
                ev = stream.Events(conn, job["id"], t["board_id"])
                try:
                    result = backup.backup(t, user, password, username, job["id"], ev)
                finally:
                    ev.close()
                _write_one(conn, job, t["board_id"], result, names.get(t["board_id"], ""))
                results[t["board_id"]] = result
        elif job["type"] in ("cast_start", "cast_stop", "cast_volume"):
            # "Ekranımı yansıt" (bkz. executor/cast.py): tahtalar bağımsız, PARALEL (login deseni) —
            # yayın bütün sınıflarda aynı anda başlasın. conn yalnız bu iş parçacığında kullanılır.
            params = job["params"] or {}
            user, password = _board_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            if job["type"] == "cast_start":
                def work(t):
                    return cast.start(t, user, password, params.get("stream", ""), bool(params.get("audio")),
                                      params.get("volume"))
            elif job["type"] == "cast_volume":
                def work(t):
                    return cast.volume(t, user, password, int(params.get("volume", 100)))
            else:
                def work(t):
                    return cast.stop(t, user, password)
            n = whoami.dynamic_concurrency()
            with ThreadPoolExecutor(max_workers=max(1, min(n, len(targets)))) as pool:
                futures = {pool.submit(work, t): t for t in targets}
                for future in as_completed(futures):
                    t = futures[future]
                    result = future.result()
                    ev = stream.Events(conn, job["id"], t["board_id"])
                    for line in (result.get("output") or "").splitlines():
                        ev.add("out", line)
                    ev.add("ok" if result["status"] == "ok" else "fail",
                           "Tamam." if result["status"] == "ok" else "Başarısız.")
                    ev.close()
                    _write_one(conn, job, t["board_id"], result, names.get(t["board_id"], ""))
                    results[t["board_id"]] = result
        elif job["type"] == "diagnose":
            # "Bakım" taraması (bkz. executor/diagnose.py; elle "Şimdi tara" ya da haftalık otomatik): tahtalar
            # PARALEL, aynı anda en çok `n` tahta — n konteynerin o anki CPU/RAM boşluğuna göre
            # (whoami.dynamic_concurrency, kullanıcı isteği); biten tahtanın yerine sıradaki başlar. Her
            # tahta bitince sonucu hemen yazılır (arayüzdeki ilerleme çubuğu job_targets durumlarından
            # ilerler). Her iş parçacığı KENDİ veritabanı bağlantısını açar (command/action'daki not).
            user, password = _board_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            # Görev başında hepsi "running" işaretlendi; sırası gelmeyenler "Sırada" görünsün.
            conn.execute("UPDATE job_targets SET status = 'queued' WHERE job_id = %s", (job["id"],))

            def scan(t):
                wconn = db.connect()
                try:
                    wconn.execute("UPDATE job_targets SET status = 'running' WHERE job_id = %s AND board_id = %s",
                                  (job["id"], t["board_id"]))
                    ev = stream.Events(wconn, job["id"], t["board_id"])
                    try:
                        ev.add("info", "Denetleniyor…")
                        ev.flush()
                        try:
                            result = diagnose.run(wconn, t, user, password)
                        except Exception as e:  # bir tahtanın hatası diğerlerinin taramasını düşürmesin
                            log.exception("bakım taraması: tahta %s", t["board_id"])
                            result = {"status": "failed", "rc": None, "output": f"Denetim hatası: {e}"}
                        if result["status"] == "ok":
                            report = json.loads(result["output"])
                            bad = sum(c["level"] == "bad" for c in report["checks"])
                            warn = sum(c["level"] == "warn" for c in report["checks"])
                            ev.add("ok", f"Bitti: {bad} acil, {warn} dikkat gerektiren bulgu.")
                        else:
                            ev.add("fail", result["output"])
                    finally:
                        ev.close()
                    _write_one(wconn, job, t["board_id"], result, names.get(t["board_id"], ""))
                    return result
                finally:
                    wconn.close()

            n = max(1, min(whoami.dynamic_concurrency(), len(targets)))
            if len(targets) > 1:
                general.add("info", f"{len(targets)} tahta paralel denetleniyor — aynı anda en çok {n} tahta"
                            + (" (sistem kaynaklarına göre; diğerleri sırada bekler)" if n < len(targets) else ""))
                general.flush()
            with ThreadPoolExecutor(max_workers=n) as pool:
                futures = {pool.submit(scan, t): t for t in targets}
                for future in as_completed(futures):
                    results[futures[future]["board_id"]] = future.result()
        else:
            raise RuntimeError(f"Bilinmeyen görev türü: {job['type']}")

        summary = _write_results(conn, job, results, targets)
        general.add("info", f"Görev bitti: {summary}")
        activity.record(conn, f"Görev bitti: {job['title']} — {summary}")
    except Exception as exc:
        log.exception("görev #%s hatası", job["id"])
        conn.execute("UPDATE jobs SET status = 'failed', finished_at = now(), summary = %s WHERE id = %s",
                     (f"Hata: {exc}"[:200], job["id"]))
        conn.execute("UPDATE job_targets SET status = 'failed', finished_at = now() WHERE job_id = %s"
                     " AND status IN ('queued', 'running')", (job["id"],))
        general.add("fail", f"Görev hatası: {exc}")
        activity.record(conn, f"Görev hatası: {job['title']} — {exc}"[:200], "error")
    finally:
        _scrub_secrets(conn, job)
        general.close()
        conn.close()


def main() -> None:
    listen = db.connect()
    listen.execute("LISTEN tihamon_jobs")
    with db.connect() as conn:
        # Yürütücü bir görevin ortasında durduysa (yeniden başlatma) o görev sonsuza dek "çalışıyor" kalmasın.
        n = conn.execute(
            "UPDATE jobs SET status = 'failed', finished_at = now(), summary = 'Yürütücü yeniden başladı; görev yarıda kaldı.'"
            " WHERE status = 'running'").rowcount
        if n:
            log.warning("%d yarım görev başarısız işaretlendi", n)
        # Tahta satırları da kapatılır: yoksa görev "başarısız" olsa da satır sonsuza dek "running" kalıyor,
        # Bakım raporu tahtayı "Denetleniyor…" gösteriyordu (2026-10-16, yeniden build sırasında yaşandı).
        # Yürütücü yeni açıldı: biten (kuyrukta olmayan) görevlerin queued/running satırları kesinlikle yarımdır.
        n = conn.execute(
            "UPDATE job_targets t SET status = 'failed', finished_at = coalesce(t.finished_at, now()),"
            " output = coalesce(nullif(t.output, ''), 'Yürütücü yeniden başladı; bu tahtada görev yarıda kaldı.')"
            " FROM jobs j WHERE j.id = t.job_id AND j.status NOT IN ('queued', 'running')"
            " AND t.status IN ('queued', 'running')").rowcount
        if n:
            log.warning("%d yarım tahta sonucu başarısız işaretlendi", n)
        # Eski görev olayları birikmesin (görevin kendisi ve tahta sonuçları kalır).
        conn.execute("DELETE FROM job_events WHERE job_id IN (SELECT id FROM jobs WHERE created_at < now() - interval '30 days')")
    log.info("görev yürütücüsü hazır (LISTEN tihamon_jobs; %d görev eşzamanlı)", JOB_THREADS)

    pool = ThreadPoolExecutor(max_workers=JOB_THREADS)
    while True:
        with db.connect() as conn:
            while True:
                job = _claim(conn)
                if job is None:
                    break
                log.info("görev alındı: #%s (%s)", job["id"], job["type"])
                pool.submit(_run_job, job)
        # Yeni görev bildirimi ya da POLL_SECONDS (yedek yoklama) beklenir.
        readable, _, _ = select.select([listen.fileno()], [], [], POLL_SECONDS)
        if readable:
            listen.execute("SELECT 1")  # bekleyen bildirimleri tüket (yoksa soket okunur kalır)


if __name__ == "__main__":
    main()
