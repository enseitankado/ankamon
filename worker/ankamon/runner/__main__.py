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

"""Görev yürütücüsü süreci (supervisord: runner). Bkz. paket açıklaması."""

from __future__ import annotations

import json
import logging
import os
import select
import subprocess
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

from .. import activity, db
from ..executor import (accounts, backup, device_password, cast, diagnose, display, home_restore, hwfacts, screenlock, session_probe,
                        tools, whoami, wol)
from ..anomaly import scan as anomaly_scan_mod
from ..executor.jobs import _action_dir, _device_access, _claim, _targets, _write_one, _write_results
from .. import platforms
from . import device_media_jobs, stream

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ankamon.runner")


def _load_job_done_hooks() -> tuple[dict, dict]:
    """Eklentilerin iş-bitiş kancaları: ext/<ad>/worker/job_hooks.py içindeki
    JOB_DONE = {action_id: fn}: fn(conn, device, user, password, job_id, events) — ilgili işlem 'ok' bitince;
    JOB_FINISHED = {action_id: fn}: fn(conn, device, user, password, job_id, events, result) — betik cihazda
    çalışıp bittiğinde ('ok' ya da 'failed'; bağlanılamayan cihazda çağrılmaz). Cihazdaki aracın kendi çıkış
    kodunu taşıyan işlemler başarısızlıkta da sonuç dosyasını okuyabilsin diye. Çekirdek hiçbir eklentiyi
    adıyla bilmez; bir action id için kayıtlı callback varsa çalıştırır (ör. rapor okuyup yazma).
    """
    import glob
    import importlib.util
    import sys
    hooks: dict = {}
    finished: dict = {}
    for path in glob.glob("/opt/ankamon/ext/*/worker/job_hooks.py"):
        worker_dir = os.path.dirname(path)
        if worker_dir not in sys.path:
            sys.path.insert(0, worker_dir)
        try:
            spec = importlib.util.spec_from_file_location(
                "ext_job_hooks_" + os.path.basename(os.path.dirname(worker_dir)), path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            hooks.update(getattr(mod, "JOB_DONE", {}) or {})
            finished.update(getattr(mod, "JOB_FINISHED", {}) or {})
        except Exception:
            log.exception("eklenti iş-bitiş kancası yüklenemedi: %s", path)
    return hooks, finished


_JOB_DONE_HOOKS, _JOB_FINISHED_HOOKS = _load_job_done_hooks()


def _legacy_target(t: dict) -> dict:
    """Eklenti kancalarına giden hedef: eski anahtar adları da (board_id/board_name — terim geçişi 2026-11-12)."""
    return {**t, "board_id": t.get("device_id"), "board_name": t.get("device_name", t.get("name"))}

JOB_THREADS = int(os.environ.get("RUNNER_JOB_THREADS", "8"))  # aynı anda çalışan görev
# Cihaz iş parçacıklarının (her biri kendi bağlantısı, SSH süresince tutar) TÜM görevler toplamında aynı anda
# tutabileceği veritabanı bağlantısı. Paralellik görev başına yüke göre 20'ye çıkar, görevler de 8'e kadar eşzamanlı:
# kotasız, açık cihazlarla 5 toplu işte tepe 89/100 ölçüldü (2026-11-05). Kota dolunca sıradaki cihaz bekler.
# Bütçe: 40 + görevlerin kendi bağlantıları (~16) + diğer servisler (~14) + PHP-FPM (12) < max_connections 100.
DEVICE_DB_SLOTS = int(os.environ.get("RUNNER_DEVICE_DB_SLOTS", "40"))
_device_db_slots = threading.BoundedSemaphore(DEVICE_DB_SLOTS)


def _device_conn():
    _device_db_slots.acquire()
    try:
        return db.connect()
    except BaseException:
        _device_db_slots.release()
        raise


def _device_conn_close(conn) -> None:
    try:
        conn.close()
    finally:
        _device_db_slots.release()
POLL_SECONDS = 3


def _command_for(params: dict, family: str) -> str | None:
    """Serbest komutun bu aile için metni: aile başına "commands" (Komut çalıştır'da her aileye ayrı kutu), yoksa eski
    tek "command" — yalnız bash kabuklu ailelerde (Linux/macOS); Windows'a bash komutu gönderilmez."""
    per = params.get("commands") or {}
    text = (per.get(family) or "").strip()
    if text:
        return text
    legacy = (params.get("command") or "").strip()
    return legacy if legacy and platforms.shell(family) == "bash" else None


def _job_text(job, family: str = "linux") -> tuple[str, dict | None, int]:
    """Görev türüne ve hedefin işletim sistemi ailesine göre cihazda çalışacak betik, ortam değişkenleri ve zaman aşımı
    (kullanıcı isteği 2026-11-12: işlev adı aynı, uygulaması aileye göre — run.sh | run.ps1 | run.macos.sh)."""
    params = job["params"] or {}
    if job["type"] == "command":
        return _command_for(params, family) or "", None, 120
    action_dir = _action_dir(params["action"])  # çekirdek ya da eklenti (ext/<ad>/actions)
    with open(os.path.join(action_dir, "action.json"), encoding="utf-8") as f:
        timeout = int(json.load(f).get("timeout", 120))
    path = platforms.action_script(action_dir, family)
    if path is None:
        raise ValueError(f"işlemin {platforms.label(family)} betiği yok")
    with open(path, encoding="utf-8") as f:
        script = f.read()
    return script, {k: str(v) for k, v in (params.get("values") or {}).items()}, timeout


def _platform_skip(job, family: str) -> str | None:
    """Hedef bu ailede bu görevi çalıştıramıyorsa "Atlandı: …" metni; çalıştırabiliyorsa None."""
    params = job["params"] or {}
    if job["type"] == "command":
        if not platforms.job_supported("command", family):
            return platforms.unsupported_text("Serbest komut", family)
        if _command_for(params, family) is None:
            return (f"Atlandı: {platforms.label(family)} cihazları için komut yazılmadı "
                    f"(Komut çalıştır penceresinde {platforms.label(family)} kutusu).")
        return None
    if job["type"] == "action":
        try:
            path = platforms.action_script(_action_dir(params.get("action", "")), family)
        except OSError:
            path = None
        return None if path else platforms.unsupported_text(job["title"], family)
    return None if platforms.job_supported(job["type"], family) else platforms.unsupported_text(job["title"], family)


def _action_def(job) -> dict:
    """Hazır işlemin action.json tanımı (command görevlerinde boş)."""
    if job["type"] != "action":
        return {}
    with open(os.path.join(_action_dir((job["params"] or {})["action"]), "action.json"), encoding="utf-8") as f:
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


def _device_event(conn, job_id: int, device_id: int, kind: str, text: str) -> None:
    """Paralel çalışan dallarda (whoami/login/logout) canlı pencereye cihaz başına satır yazar —
    yoksa bu görevlerin penceresi boş kalıyordu (kullanıcı bildirdi). Ana iş parçacığında çağrılır."""
    ev = stream.Events(conn, job_id, device_id)
    ev.add(kind, text)
    ev.close()


def _run_job(job) -> None:
    conn = db.connect()
    general = stream.Events(conn, job["id"], None)
    try:
        targets = _targets(conn, job["id"])
        names = {t["device_id"]: t["name"] for t in targets}
        general.add("info", f"Görev başladı: {job['title']} — {len(targets)} cihaz")
        # İşletim sistemine göre (kullanıcı isteği 2026-11-12; platforms/README.md): işlevin hedefin ailesinde uygulaması
        # yoksa o hedef çalıştırılmaz, "Atlandı" yazılır; kalanlar aşağıdaki dallarda kendi ailelerine göre çalışır.
        families = platforms.families(conn, [t["device_id"] for t in targets])
        skipped_results: dict[int, dict] = {}
        runnable = []
        for t in targets:
            text = _platform_skip(job, families[t["device_id"]])
            if text is None:
                runnable.append(t)
                continue
            ev = stream.Events(conn, job["id"], t["device_id"])
            ev.add("info", text)
            ev.close()
            skipped_results[t["device_id"]] = {"status": "skipped", "rc": None, "output": text}
            _write_one(conn, job, t["device_id"], skipped_results[t["device_id"]], names.get(t["device_id"], ""))
        if skipped_results:
            by_family: dict[str, int] = {}
            for bid in skipped_results:
                by_family[families[bid]] = by_family.get(families[bid], 0) + 1
            general.add("info", "İşletim sistemine göre atlanan: " + ", ".join(
                f"{n} {platforms.label(f)}" for f, n in by_family.items()) + " cihaz (bu işlevin o sistemde uygulaması yok)")
        targets = runnable
        general.flush()
        # Komut/hazır işlemde cihazlar grup grup çalışır: sıra gelene kadar "queued" kalır, her cihaz
        # kendi işi başlarken "running" olur (canlı pencerede çalışan/sırada/biten ayrımı — bkz. ui/Jobs.js).
        if job["type"] not in ("command", "action"):
            conn.execute("UPDATE job_targets SET status = 'running', started_at = now() WHERE job_id = %s AND device_id = ANY(%s)",
                         (job["id"], [t["device_id"] for t in targets]))
        results: dict[int, dict] = dict(skipped_results)

        if job["type"] == "wol":
            for t in targets:
                ev = stream.Events(conn, job["id"], t["device_id"])
                ev.add("info", f"Uyandırma paketi gönderiliyor: MAC {t['mac'] or '—'}")
                ok, msg = wol.wake(t["mac"], t["ip"])
                ev.add("ok" if ok else "fail", msg)
                ev.close()
                results[t["device_id"]] = {"status": "ok" if ok else "failed", "rc": 0 if ok else None, "output": msg}
                _write_one(conn, job, t["device_id"], results[t["device_id"]], names.get(t["device_id"], ""))
        elif job["type"] in ("command", "action"):
            user, password = _device_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            # Betik/komut hedefin ailesine göre (Linux: bash run.sh, Windows: PowerShell run.ps1, macOS: bash run.macos.sh).
            texts = {f: _job_text(job, f) for f in {families[t["device_id"]] for t in targets}}
            env = next(iter(texts.values()))[1] if texts else None
            # SSH etkinlik kaydında (alt çubuk ▸ SSH) "password" türü parametrelerin değerleri görünmesin: komut satırında
            # export AD='değer' olarak gider; sshpass sarmalayıcısı bunları kayda yazmadan önce *** yapar.
            try:
                secret_keys = [p["key"] for p in _action_def(job).get("params", []) if p.get("type") == "password"]
            except (OSError, ValueError, KeyError):
                secret_keys = []
            secrets = [env[k] for k in secret_keys if env and env.get(k)]
            # Cihaza taşınacak dış araçlar (action.json "tools", ör. eta-112): sunucu kopyası bir kez
            # hazırlanır (günün ilk kullanımında sürüm denetimi), her cihaza gerekirse SFTP ile gider.
            try:
                # Dış araçlar Linux ikilileridir (ör. eta-112): yalnız Linux hedef varsa hazırlanır ve yalnız onlara gider.
                need_tools = any(families[t["device_id"]] == "linux" for t in targets)
                prepared = {name: tools.ensure(name, general) for name in _action_def(job).get("tools", [])} if need_tools else {}
            except tools.ToolError as e:
                raise RuntimeError(str(e)) from e

            # Cihazlar PARALEL çalışır, aynı anda en çok `n` cihaz (kullanıcı isteği): n konteynerin o anki
            # CPU/RAM boşluğuna göre (whoami.dynamic_concurrency) — kaynak azsa cihazlar grup grup işlenir,
            # biten cihazın yerine sıradaki başlar. Her iş parçacığı KENDİ veritabanı bağlantısını açar:
            # tek bağlantının iş parçacıkları arasında paylaşılması güvenli değildi (eskiden bu yüzden
            # sıralıydı — birden fazla cihazda yalnız biri tamamlanıyordu). Çıktı cihaz başına ayrı tutulur
            # (job_events.device_id), pencerede cihaz seçilerek okunur.
            action = (job["params"] or {}).get("action") if job["type"] == "action" else None

            def work(t):
                wconn = _device_conn()
                try:
                    wconn.execute("UPDATE job_targets SET status = 'running', started_at = now() WHERE job_id = %s AND device_id = %s",
                                  (job["id"], t["device_id"]))
                    ev = stream.Events(wconn, job["id"], t["device_id"])
                    try:
                        if not t["ip"]:
                            ev.add("fail", "Cihazın IP adresi yok.")
                            result = {"status": "unreachable", "rc": None, "output": "Cihazın IP adresi yok."}
                        else:
                            result = None
                            family = families[t["device_id"]]
                            body, env, timeout = texts[family]
                            for name, local in (prepared.items() if family == "linux" else ()):
                                try:
                                    tools.upload(t, user, password, name, local, ev)
                                except (tools.ToolError, OSError, subprocess.TimeoutExpired) as e:
                                    ev.add("fail", f"{tools.TOOLS[name]['title']} cihaza kopyalanamadı: {e}")
                                    result = {"status": "unreachable", "rc": None, "output": f"Araç kopyalanamadı: {e}"}
                                    break
                            if result is None:
                                result = stream.run(t, user, password, body=body, env=env, timeout=timeout, events=ev,
                                                    secrets=secrets, shell=platforms.shell(family) or "bash")
                                # İşlem bitiş kancaları (eklenti-farkında): bir eklenti worker'ı bir action id
                                # için callback kaydettiyse 'ok' bitişte çalıştırılır (ör. rapor okuyup tabloya
                                # yazma). Çekirdek hiçbir eklentiyi adıyla bilmez (bkz. _JOB_DONE_HOOKS).
                                # Kapatma cihazda başarıyla bitti: SSH'e ulaşılamayınca cihaz beklemeden çevrim dışı
                                # sayılsın (bkz. tasks/device_status SHUTDOWN_GRACE, DevicesApi alive; göç 051).
                                if result["status"] == "ok" and action == "shutdown":
                                    wconn.execute("UPDATE devices SET shutdown_at = now() WHERE id = %s", (t["device_id"],))
                                if result["status"] == "ok" and action in _JOB_DONE_HOOKS:
                                    try:
                                        _JOB_DONE_HOOKS[action](wconn, _legacy_target(t), user, password, job["id"], ev)
                                    except Exception:
                                        log.exception("işlem bitiş kancası hatası: %s", action)
                                if result["status"] in ("ok", "failed") and action in _JOB_FINISHED_HOOKS:
                                    try:
                                        _JOB_FINISHED_HOOKS[action](wconn, _legacy_target(t), user, password, job["id"], ev, result)
                                    except Exception:
                                        log.exception("işlem bitiş kancası hatası: %s", action)
                    except Exception as e:  # tek cihazın beklenmedik hatası diğerlerini durdurmasın
                        log.exception("görev #%s cihaz %s", job["id"], t["device_id"])
                        ev.add("fail", f"Beklenmeyen hata: {e}")
                        result = {"status": "failed", "rc": None, "output": f"Beklenmeyen hata: {e}"}
                    finally:
                        ev.close()
                    _write_one(wconn, job, t["device_id"], result, names.get(t["device_id"], ""))
                    # Wi-Fi aç/kapat: grid'in "Wi-Fi" sütunu ve Bilgi kartı yeni durumu hemen göstersin.
                    if action in hwfacts.WIFI_ACTIONS and result["status"] == "ok":
                        hwfacts.mark_wifi_radio(wconn, t["device_id"], hwfacts.WIFI_ACTIONS[action])
                    # Kullanıcı ekle/sil: "Oturum aç"/"Yedekle"/"Kullanıcı sil" listeleri güncel hesapları
                    # göstersin (kısmi başarıda da — bazı hesaplar silinmiş olabilir).
                    if action in ("user-add", "user-delete"):
                        accounts.invalidate(wconn, t["device_id"])
                    # Parola ayarla ile root değişti: Ankamon'un bağlantısı kopmasın, cihaza özel kaydedilir.
                    if action == "user-password" and result["status"] == "ok" and user == "root":
                        values = (job["params"] or {}).get("values") or {}
                        if "root" in str(values.get("KULLANICILAR", "")).split():
                            device_password.remember_root(wconn, t, str(values.get("PAROLA", "")), password)
                    return result
                finally:
                    _device_conn_close(wconn)

            n = max(1, min(whoami.dynamic_concurrency(), len(targets)))
            if len(targets) > 1:
                general.add("info", f"{len(targets)} cihazda paralel çalışıyor — aynı anda en çok {n} cihaz"
                            + (" (sistem kaynaklarına göre; diğerleri sırada bekler)" if n < len(targets) else ""))
                general.flush()
            with ThreadPoolExecutor(max_workers=n) as pool:
                futures = {pool.submit(work, t): t for t in targets}
                for future in as_completed(futures):
                    results[futures[future]["device_id"]] = future.result()
        elif job["type"] == "whoami":
            user, password = _device_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            # Burada (command/action'ın aksine) cihazlar PARALEL sorgulanır: her cihaz bağımsız,
            # tek satırlık bir sonuç üretir — sırayla okunacak bir çıktı akışı yok, önizleme
            # kutucuklarının hepsi aynı anda "sorgulanıyor" göstermesi de bunu gerektiriyor (bkz.
            # frontend). Eşzamanlılık konteynerin o anki CPU/RAM yüküne göre dinamik (kullanıcı
            # isteği — bkz. whoami.dynamic_concurrency). Yalnız asıl SSH alt süreçleri iş
            # parçacıklarında çalışır; `conn`'a dokunan her şey (_write_one) ana iş parçacığında
            # SIRAYLA yapılır — tek bağlantının iş parçacıkları arasında eşzamanlı paylaşılması
            # command/action'da (bkz. yukarıdaki not) güvenli değildi, burada da aynı kısıtlama geçerli.
            for t in targets:
                _device_event(conn, job["id"], t["device_id"], "info", f"Oturumlar sorgulanıyor: root@{t['ip'] or '—'} …")
            n = whoami.dynamic_concurrency()
            with ThreadPoolExecutor(max_workers=max(1, min(n, len(targets)))) as pool:
                futures = {pool.submit(whoami.query, t, user, password): t for t in targets}
                for future in as_completed(futures):
                    t = futures[future]
                    result = future.result()
                    _write_one(conn, job, t["device_id"], result, names.get(t["device_id"], ""))
                    results[t["device_id"]] = result
                    if result["status"] != "ok":
                        _device_event(conn, job["id"], t["device_id"], "fail", f"Sorgulanamadı: {result['output']}")
                    elif result["output"]:
                        _device_event(conn, job["id"], t["device_id"], "ok", f"Açık oturum: {result['output']}")
                    else:
                        _device_event(conn, job["id"], t["device_id"], "ok", "Açık kullanıcı oturumu yok (cihaz giriş ekranında).")
                    if result["status"] == "ok":   # grid'in "Oturum" sütunu (kilidi `who` bilmez: None)
                        session_probe.store(conn, t["device_id"], result["output"], None)
        elif job["type"] == "anomaly_scan":
            # Anomaliler ▸ Tarama (bkz. anomaly/scan.py): seçilen kurallar seçilen cihazlarda anlık yoklanır.
            # whoami/facts deseni: cihazlar PARALEL (dinamik eşzamanlılık); her iş parçacığı evaluate'in
            # okumaları için kendi bağlantısını açar, job_targets'a yazmak ana iş parçacığında sırayla.
            user, password = _device_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            kinds = list((job["params"] or {}).get("kinds") or [])
            hostnames = {r["id"]: r["hostname"] for r in conn.execute(
                "SELECT id, hostname FROM devices WHERE id = ANY(%s)", ([t["device_id"] for t in targets],)).fetchall()}

            def anomaly_scan(t):
                wconn = _device_conn()
                try:
                    return anomaly_scan_mod.run(wconn, dict(t, hostname=hostnames.get(t["device_id"])), kinds, user, password)
                except Exception as e:  # noqa: BLE001 — bir cihazın hatası diğerlerini düşürmesin
                    log.exception("anomali taraması: cihaz %s", t["device_id"])
                    return {"status": "failed", "rc": None, "output": f"Hata: {e}"}
                finally:
                    _device_conn_close(wconn)

            n = whoami.dynamic_concurrency()
            with ThreadPoolExecutor(max_workers=max(1, min(n, len(targets)))) as pool:
                futures = {pool.submit(anomaly_scan, t): t for t in targets}
                for future in as_completed(futures):
                    t = futures[future]
                    result = future.result()
                    _write_one(conn, job, t["device_id"], result, names.get(t["device_id"], ""))
                    results[t["device_id"]] = result
        elif job["type"] == "facts":
            # "Bilgi kartı": cihaz başına 60dk önbellek (bkz. hwfacts.CACHE_SECONDS) — önbellekte
            # taze bir değer varsa SSH'a hiç gidilmez, hemen o değer yazılır. Geri kalanlar whoami ile
            # aynı desende PARALEL toplanır (bağımsız, kısa, tek betiklik sorgular).
            now_ts = int(time.time())
            cutoff = now_ts - hwfacts.CACHE_SECONDS
            pending = []
            for t in targets:
                cached = hwfacts.cached(conn, t["device_id"], cutoff)
                if cached is None:
                    pending.append(t)
                    continue
                result = {"status": "ok", "rc": 0, "output": json.dumps(cached, ensure_ascii=False)}
                _write_one(conn, job, t["device_id"], result, names.get(t["device_id"], ""))
                results[t["device_id"]] = result
            if pending:
                user, password = _device_access(conn)
                if not password:
                    raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
                n = whoami.dynamic_concurrency()
                with ThreadPoolExecutor(max_workers=max(1, min(n, len(pending)))) as pool:
                    futures = {pool.submit(hwfacts.query, t, user, password): t for t in pending}
                    for future in as_completed(futures):
                        t = futures[future]
                        result = future.result()
                        if result["status"] == "ok":
                            hwfacts.store(conn, t["device_id"], json.loads(result["output"]), now_ts)
                        _write_one(conn, job, t["device_id"], result, names.get(t["device_id"], ""))
                        results[t["device_id"]] = result
        elif job["type"] == "accounts":
            # "Oturum aç" alt menüsünün hesap listesi (bkz. executor/accounts.py): 24 saat önbellek.
            now_ts = int(time.time())
            for t in targets:
                listed = accounts.cached(conn, t["device_id"], now_ts - accounts.CACHE_SECONDS)
                if listed is not None:
                    result = {"status": "ok", "rc": 0, "output": json.dumps(listed, ensure_ascii=False)}
                else:
                    user, password = _device_access(conn)
                    if not password:
                        raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
                    result = accounts.list_accounts(t, user, password)
                    if result["status"] == "ok":
                        accounts.store(conn, t["device_id"], json.loads(result["output"]), now_ts)
                _write_one(conn, job, t["device_id"], result, names.get(t["device_id"], ""))
                results[t["device_id"]] = result
        elif job["type"] in ("login", "logout", "lock", "wake", "sleep", "screen_lock", "screen_unlock"):
            # Seçilen hesapla oturum açma / açık oturumu kapatma ya da kilitleme — cihazlar bağımsız,
            # PARALEL (whoami deseni). logout/lock'ta username isteğe bağlı (Oturumlar grid'i belirli
            # kullanıcıyı hedefler; boşsa cihazdaki etkin oturum).
            username = (job["params"] or {}).get("username", "")
            user, password = _device_access(conn)
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
            elif job["type"] == "screen_lock":
                # Ekran ▸ Kilitle: "Kilidi aç"a dek tam ekran "Kilitli", giriş yakalanır (bkz. executor/screenlock.py).
                # Kilit ekranı cihazın kimliğini de yazar (takma ad, bilgisayar adı, ETAP, MAC, IP).
                identities = screenlock.identities(conn, [t["device_id"] for t in targets])

                def work(t):
                    return screenlock.lock(t, user, password, identities.get(t["device_id"]))
            elif job["type"] == "screen_unlock":
                def work(t):
                    return screenlock.unlock(t, user, password)
            elif job["type"] == "wake":
                # Ekran ▸ Uyandır: güç tasarrufundaki ekranı uyandırır (bkz. executor/display.py).
                def work(t):
                    return display.wake(t, user, password)
            else:
                # Ekran ▸ Uyut: ekranı DPMS ile kapatır (dokunulunca açılır).
                def work(t):
                    return display.sleep(t, user, password)
            who = f"{username} oturumu" if username else "Açık oturum"
            start = {"login": f"{username} hesabıyla oturum açılıyor…",
                     "logout": f"{who} kapatılıyor…", "lock": f"{who} kilitleniyor…",
                     "wake": "Ekran uyandırılıyor…", "sleep": "Ekran uyutuluyor…",
                     "screen_lock": "Ekran kilitleniyor…", "screen_unlock": "Ekran kilidi açılıyor…"}[job["type"]]
            for t in targets:
                _device_event(conn, job["id"], t["device_id"], "info", f"Bağlanılıyor: root@{t['ip'] or '—'} — {start}")
            n = whoami.dynamic_concurrency()
            with ThreadPoolExecutor(max_workers=max(1, min(n, len(targets)))) as pool:
                futures = {pool.submit(work, t): t for t in targets}
                for future in as_completed(futures):
                    t = futures[future]
                    result = future.result()
                    _write_one(conn, job, t["device_id"], result, names.get(t["device_id"], ""))
                    results[t["device_id"]] = result
                    ev = stream.Events(conn, job["id"], t["device_id"])
                    for line in (result["output"] or "").splitlines():
                        if line.strip():
                            ev.add("out", line)
                    ev.add("ok" if result["status"] == "ok" else "fail",
                           "Bitti." if result["status"] == "ok" else f"Başarısız ({result['status']}).")
                    ev.close()
                    # Cihazlar grid'inin "Oturum" sütunu hemen güncellensin (bkz. executor/session_probe.py).
                    if result["status"] == "ok" and job["type"] in ("wake", "sleep"):
                        # Ekranlar'daki "güç tasarrufu" yazısı bir sonraki yoklamayı beklemeden kalksın / çıksın.
                        session_probe.store_display(conn, t["device_id"], "On" if job["type"] == "wake" else "Off")
                    elif result["status"] == "ok" and job["type"] in ("screen_lock", "screen_unlock"):
                        # "Oturum" hücresindeki "/ Kilitli" bir sonraki yoklamayı beklemeden.
                        session_probe.store_screen_lock(conn, t["device_id"], job["type"] == "screen_lock")
                        if job["type"] == "screen_lock":
                            session_probe.store_display(conn, t["device_id"], "On")  # kilitleme ekranı uyandırır
                    elif result["status"] == "ok":
                        if job["type"] == "login":
                            session_probe.store(conn, t["device_id"], username, False)
                        else:
                            # Kapatılan/kilitlenen oturum etkin olan olmayabilir (arka planda başka
                            # oturumlar kalabilir): tahmin etmek yerine gerçek durumu yeniden yokla.
                            st = session_probe.probe(t, user, password)
                            if st["ok"]:
                                session_probe.store(conn, t["device_id"], st["user"], st["locked"])
                                session_probe.store_display(conn, t["device_id"], st["display"])
        elif job["type"] == "backup_home":
            # "Yedekle/Geri al" ▸ Yedekle: cihazlar SIRAYLA (command/action gibi) — her cihazın canlı raporu ve ilerlemesi
            # okunaklı aksın, aynı anda onlarca cihazın ağ/disk yükü birikmesin; `conn` da yalnız bu
            # iş parçacığında kullanılır (bkz. yukarıdaki not). Eski yedekler önce temizlenir.
            usernames = (job["params"] or {}).get("usernames") or []
            user, password = _device_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            keep = backup.keep_hours(conn)
            removed = backup.cleanup(keep_job=keep)
            if removed:
                general.add("info", f"{removed} eski yedek dizini silindi ({keep} saatten eski).")
            for t in targets:
                ev = stream.Events(conn, job["id"], t["device_id"])
                try:
                    parts = [backup.backup(t, user, password, name, job["id"], ev, (i, len(usernames)))
                             for i, name in enumerate(usernames)]
                finally:
                    ev.close()
                result = home_restore.merge_home_backup_results(parts)
                _write_one(conn, job, t["device_id"], result, names.get(t["device_id"], ""))
                results[t["device_id"]] = result
        elif job["type"] == "restore_home":
            # "Yedekle/Geri al" ▸ Geri al: yüklenen yedekten hesap + ev dizini + PIN anahtarı, cihazlar SIRAYLA.
            params = job["params"] or {}
            user, password = _device_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            backup.cleanup(keep_job=backup.keep_hours(conn))
            try:
                row = conn.execute("SELECT is_admin FROM users WHERE username = %s", (job["username"],)).fetchone()
                archive, meta = home_restore.prepare_home_restore(
                    params.get("token", ""), job["username"], bool(row and row["is_admin"]))
                for t in targets:
                    ev = stream.Events(conn, job["id"], t["device_id"])
                    try:
                        result = home_restore.restore_home(t, user, password, archive, meta, bool(params.get("overwrite")), ev)
                    finally:
                        ev.close()
                    accounts.invalidate(conn, t["device_id"])
                    _write_one(conn, job, t["device_id"], result, names.get(t["device_id"], ""))
                    results[t["device_id"]] = result
            except home_restore.HomeRestoreRefused as exc:
                raise RuntimeError(str(exc))
            finally:
                home_restore.discard_upload(params.get("token", ""))
        elif job["type"] in ("cast_start", "cast_stop", "cast_volume"):
            # "Ekranımı yansıt" (bkz. executor/cast.py): cihazlar bağımsız, PARALEL (login deseni) —
            # yayın bütün sınıflarda aynı anda başlasın. conn yalnız bu iş parçacığında kullanılır.
            params = job["params"] or {}
            user, password = _device_access(conn)
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
                    ev = stream.Events(conn, job["id"], t["device_id"])
                    for line in (result.get("output") or "").splitlines():
                        ev.add("out", line)
                    ev.add("ok" if result["status"] == "ok" else "fail",
                           "Tamam." if result["status"] == "ok" else "Başarısız.")
                    ev.close()
                    _write_one(conn, job, t["device_id"], result, names.get(t["device_id"], ""))
                    results[t["device_id"]] = result
        elif job["type"] in device_media_jobs.TYPES:
            device_media_jobs.run(conn, job, targets, names, results)
        elif job["type"] == "diagnose":
            # "Bakım" taraması (bkz. executor/diagnose.py; elle "Şimdi tara" ya da haftalık otomatik): cihazlar
            # PARALEL, aynı anda en çok `n` cihaz — n konteynerin o anki CPU/RAM boşluğuna göre
            # (whoami.dynamic_concurrency, kullanıcı isteği); biten cihazın yerine sıradaki başlar. Her
            # cihaz bitince sonucu hemen yazılır (arayüzdeki ilerleme çubuğu job_targets durumlarından
            # ilerler). Her iş parçacığı KENDİ veritabanı bağlantısını açar (command/action'daki not).
            user, password = _device_access(conn)
            if not password:
                raise RuntimeError("SSH parolası tanımlı değil (Ayarlar → SSH erişimi).")
            # Görev başında hepsi "running" işaretlendi; sırası gelmeyenler "Sırada" görünsün.
            conn.execute("UPDATE job_targets SET status = 'queued' WHERE job_id = %s", (job["id"],))

            def scan(t):
                wconn = _device_conn()
                try:
                    wconn.execute("UPDATE job_targets SET status = 'running' WHERE job_id = %s AND device_id = %s",
                                  (job["id"], t["device_id"]))
                    ev = stream.Events(wconn, job["id"], t["device_id"])
                    try:
                        ev.add("info", "Denetleniyor…")
                        ev.flush()
                        try:
                            result = diagnose.run(wconn, t, user, password)
                        except Exception as e:  # bir cihazın hatası diğerlerinin taramasını düşürmesin
                            log.exception("bakım taraması: cihaz %s", t["device_id"])
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
                    _write_one(wconn, job, t["device_id"], result, names.get(t["device_id"], ""))
                    return result
                finally:
                    _device_conn_close(wconn)

            n = max(1, min(whoami.dynamic_concurrency(), len(targets)))
            if len(targets) > 1:
                general.add("info", f"{len(targets)} cihaz paralel denetleniyor — aynı anda en çok {n} cihaz"
                            + (" (sistem kaynaklarına göre; diğerleri sırada bekler)" if n < len(targets) else ""))
                general.flush()
            with ThreadPoolExecutor(max_workers=n) as pool:
                futures = {pool.submit(scan, t): t for t in targets}
                for future in as_completed(futures):
                    results[futures[future]["device_id"]] = future.result()
        else:
            raise RuntimeError(f"Bilinmeyen görev türü: {job['type']}")

        summary = _write_results(conn, job, results, targets)
        general.add("info", f"Görev bitti: {summary}")
    except Exception as exc:
        log.exception("görev #%s hatası", job["id"])
        conn.execute("UPDATE jobs SET status = 'failed', finished_at = now(), summary = %s WHERE id = %s",
                     (f"Hata: {exc}"[:200], job["id"]))
        conn.execute("UPDATE job_targets SET status = 'failed', finished_at = now() WHERE job_id = %s"
                     " AND status IN ('queued', 'running')", (job["id"],))
        general.add("fail", f"Görev hatası: {exc}")
        # Ankamon logs: görev başlığıyla tek kayıt, traceback ayrıntıda (stderr'deki kopyası logwatch'ta atlanır).
        activity.record(conn, f"Görev hatası: {job['title']} — {exc}"[:200], "error", "runner", traceback.format_exc())
    finally:
        _scrub_secrets(conn, job)
        device_media_jobs.scrub(conn, job)
        general.close()
        conn.close()


def main() -> None:
    listen = db.connect()
    listen.execute("LISTEN ankamon_jobs")
    with db.connect() as conn:
        # Yürütücü bir görevin ortasında durduysa (yeniden başlatma) o görev sonsuza dek "çalışıyor" kalmasın.
        n = conn.execute(
            "UPDATE jobs SET status = 'failed', finished_at = now(), summary = 'Yürütücü yeniden başladı; görev yarıda kaldı.'"
            " WHERE status = 'running'").rowcount
        if n:
            log.warning("%d yarım görev başarısız işaretlendi", n)
        # Cihaz satırları da kapatılır: yoksa görev "başarısız" olsa da satır sonsuza dek "running" kalıyor,
        # Bakım raporu cihazı "Denetleniyor…" gösteriyordu (2026-10-16, yeniden build sırasında yaşandı).
        # Yürütücü yeni açıldı: biten (kuyrukta olmayan) görevlerin queued/running satırları kesinlikle yarımdır.
        n = conn.execute(
            "UPDATE job_targets t SET status = 'failed', finished_at = coalesce(t.finished_at, now()),"
            " output = coalesce(nullif(t.output, ''), 'Yürütücü yeniden başladı; bu cihazda görev yarıda kaldı.')"
            " FROM jobs j WHERE j.id = t.job_id AND j.status NOT IN ('queued', 'running')"
            " AND t.status IN ('queued', 'running')").rowcount
        if n:
            log.warning("%d yarım cihaz sonucu başarısız işaretlendi", n)
        # Eski görev olayları birikmesin (görevin kendisi ve cihaz sonuçları kalır).
        conn.execute("DELETE FROM job_events WHERE job_id IN (SELECT id FROM jobs WHERE created_at < now() - interval '30 days')")
    log.info("görev yürütücüsü hazır (LISTEN ankamon_jobs; %d görev eşzamanlı)", JOB_THREADS)

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
