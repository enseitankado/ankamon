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

"""Kullanıcı tanımlı zamanlanmış görevler (Sistem ▸ Zamanlanmış işler ▸ Görevler; göç 057, API SchedulesApi).

Zamanlama, JobsApi'nin kaydederken doğruladığı görev tanımını (tür/başlık/parametreler) saklar. Zamanı gelince bu
görev jobs + job_targets'a ELLE BAŞLATILANLA AYNI biçimde yazılır (pg_notify) — runner onu aynı yoldan çalıştırır,
sonuç olağan yerlerine yansır (SSH denetimi Sağlık ▸ Denetle/Durum, anomali taraması Sağlık, komut çıktısı görev
penceresi). Her çalıştırma user_schedule_runs'a yazılır (Sonuçlar listesi).

Zaman: konteynerin yerel saati (TZ, varsayılan Europe/Istanbul). Worker kapalıyken kaçırılan çalıştırmalar
birikmez: açılınca bir kez çalışır, sonraki zaman şimdiden hesaplanır. Hızlı turda (10 sn) çalışır.
"""

from __future__ import annotations

import datetime as dt
import json
import logging

from .. import activity

log = logging.getLogger(__name__)


def _local_now() -> dt.datetime:
    return dt.datetime.now().astimezone()


def next_after(s: dict, after: dt.datetime) -> dt.datetime | None:
    """Zamanlamanın `after`'dan SONRAKİ ilk çalışma anı (yoksa None)."""
    repeat = s["repeat"]
    if repeat == "once":
        run_at = s["run_at"]
        return run_at if run_at and run_at > after else None
    if repeat == "interval":
        step = dt.timedelta(minutes=max(5, int(s["interval_minutes"] or 60)))
        start = s["run_at"] or s["created_at"]
        if after < start:
            return start
        return start + step * ((after - start) // step + 1)
    if repeat == "weekly":
        days = set(s["weekdays"] or []) or set(range(1, 8))
        at = s["time_of_day"] or dt.time(0, 0)
        local = after.astimezone()
        for offset in range(0, 8):
            day = local.date() + dt.timedelta(days=offset)
            if day.isoweekday() not in days:
                continue
            cand = dt.datetime.combine(day, at).astimezone()
            if cand > after:
                return cand
    return None


def _targets(conn, s: dict) -> list[int]:
    if s["target_mode"] == "all_online":
        rows = conn.execute("SELECT id FROM devices WHERE online AND ip IS NOT NULL ORDER BY id").fetchall()
    elif s["target_mode"] == "devices":
        rows = conn.execute("SELECT id FROM devices WHERE id = ANY(%s::int[]) ORDER BY id", (s["device_ids"] or [],)).fetchall()
    else:
        return []
    return [r["id"] for r in rows]


def fire(conn, s: dict, manual: bool) -> int | None:
    """Zamanlamanın görevini kuyruğa yazar; döner: görev kimliği (hedef yoksa None — çalıştırma notla kaydedilir)."""
    ids = _targets(conn, s)
    with conn.transaction():
        if s["target_mode"] != "none" and not ids:
            note = "Çalışma anında çevrimiçi cihaz yoktu" if s["target_mode"] == "all_online" else "Hedef cihazların hiçbiri artık kayıtlı değil"
            conn.execute("INSERT INTO user_schedule_runs (schedule_id, schedule_name, manual, note) VALUES (%s, %s, %s, %s)",
                         (s["id"], s["name"], manual, note))
            conn.execute("UPDATE user_schedules SET last_run_at = now(), last_job_id = NULL WHERE id = %s", (s["id"],))
            log.info("zamanlanmış görev #%s (%s): hedef yok — %s", s["id"], s["name"], note)
            return None
        job_id = conn.execute(
            "INSERT INTO jobs (type, title, params, created_by) VALUES (%s, %s, %s::jsonb, %s) RETURNING id",
            (s["job_type"], f"{s['job_title']} (zamanlanmış: {s['name']})"[:200], json.dumps(s["job_params"] or {}),
             s["created_by"]),
        ).fetchone()["id"]
        if ids:
            conn.execute("INSERT INTO job_targets (job_id, device_id) SELECT %s, unnest(%s::int[])", (job_id, ids))
        conn.execute("INSERT INTO user_schedule_runs (schedule_id, schedule_name, job_id, manual) VALUES (%s, %s, %s, %s)",
                     (s["id"], s["name"], job_id, manual))
        conn.execute("UPDATE user_schedules SET last_run_at = now(), last_job_id = %s WHERE id = %s", (job_id, s["id"]))
        conn.execute("SELECT pg_notify('ankamon_jobs', %s)", (str(job_id),))
    activity.record(conn, f"Zamanlanmış görev çalıştı: {s['name']} ({len(ids)} cihaz{', elle' if manual else ''})")
    log.info("zamanlanmış görev #%s (%s) → iş #%s, %d cihaz%s", s["id"], s["name"], job_id, len(ids), " (elle)" if manual else "")
    return job_id


def run(conn) -> None:
    now = _local_now()
    # Yeni / düzenlenmiş zamanlamanın (next_run_at boş) ilk zamanı.
    for s in conn.execute("SELECT * FROM user_schedules WHERE enabled AND next_run_at IS NULL AND NOT run_requested").fetchall():
        nxt = next_after(s, now)
        if nxt is None:
            # Bir kezlik ve zamanı geçmiş (ör. hiç çalışmadan kapatılıp açıldı): kapatılır.
            conn.execute("UPDATE user_schedules SET enabled = false WHERE id = %s", (s["id"],))
        else:
            conn.execute("UPDATE user_schedules SET next_run_at = %s WHERE id = %s", (nxt, s["id"]))

    # "Şimdi çalıştır" (zamanlamaya dokunmaz; kapalı zamanlama da elle çalıştırılabilir).
    for s in conn.execute("SELECT * FROM user_schedules WHERE run_requested ORDER BY id").fetchall():
        conn.execute("UPDATE user_schedules SET run_requested = false WHERE id = %s", (s["id"],))
        try:
            fire(conn, s, manual=True)
        except Exception:  # noqa: BLE001 — bir zamanlamanın hatası diğerlerini durdurmasın
            log.exception("zamanlanmış görev #%s elle çalıştırılamadı", s["id"])

    # Zamanı gelenler.
    for s in conn.execute("SELECT * FROM user_schedules WHERE enabled AND next_run_at <= now() ORDER BY next_run_at").fetchall():
        nxt = next_after(s, now)
        # Önce sonraki zaman yazılır: görev yazılamasa da aynı zamanlama her turda yeniden denenmesin.
        conn.execute("UPDATE user_schedules SET next_run_at = %s, enabled = %s WHERE id = %s",
                     (nxt, nxt is not None, s["id"]))
        try:
            fire(conn, s, manual=False)
        except Exception:  # noqa: BLE001
            log.exception("zamanlanmış görev #%s çalıştırılamadı", s["id"])
