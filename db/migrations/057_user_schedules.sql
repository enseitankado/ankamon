-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Kullanıcı tanımlı zamanlanmış görevler (kullanıcı isteği 2026-11-13): Sistem ▸ Zamanlanmış işler ▸ Görevler.
-- Bir zamanlama, JobsApi'nin doğruladığı görev tanımını (job_type/job_title/job_params — /api/jobs gövdesinin
-- işlenmiş hali) ve hedefleri saklar; zamanı gelince worker (tasks/user_schedules.py) jobs + job_targets'a AYNI
-- görevi yazar — sonuç elle başlatılan görevle aynı yoldan işlenir ve olağan yerlerine yansır (SSH denetimi
-- Sağlık ▸ Denetle/Durum, anomali taraması Sağlık ekranları, komut çıktısı görev penceresi).
CREATE TABLE IF NOT EXISTS user_schedules (
    id               serial PRIMARY KEY,
    name             text NOT NULL,
    enabled          boolean NOT NULL DEFAULT true,
    job_type         text NOT NULL,
    job_title        text NOT NULL,
    job_params       jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Düzenleme penceresinin yeniden doldurulması için /api/jobs gövdesi (cihaz listesi hariç).
    job_request      jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- devices: device_ids; all_online: çalışma anında çevrimiçi bütün cihazlar; none: cihazsız görev.
    target_mode      text NOT NULL DEFAULT 'devices' CHECK (target_mode IN ('devices', 'all_online', 'none')),
    device_ids       integer[] NOT NULL DEFAULT '{}',
    -- once: run_at'te bir kez; interval: run_at'ten başlayarak interval_minutes'te bir;
    -- weekly: seçili günlerde (weekdays, ISO 1=Pazartesi … 7=Pazar) time_of_day'de (her gün = 7 günün hepsi).
    repeat           text NOT NULL CHECK (repeat IN ('once', 'interval', 'weekly')),
    run_at           timestamptz,
    interval_minutes integer CHECK (interval_minutes IS NULL OR interval_minutes >= 5),
    time_of_day      time,
    weekdays         smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
    next_run_at      timestamptz,
    last_run_at      timestamptz,
    last_job_id      bigint,
    -- "Şimdi çalıştır": worker bir sonraki turda (≤10 sn) zamanlamaya dokunmadan bir kez çalıştırır.
    run_requested    boolean NOT NULL DEFAULT false,
    created_by       integer REFERENCES users(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_schedules_due_idx ON user_schedules (next_run_at) WHERE enabled;

-- Her çalıştırma (zamanı gelen ya da "Şimdi çalıştır"): görev yoksa (ör. çevrimiçi cihaz yok) job_id boş, note dolu.
CREATE TABLE IF NOT EXISTS user_schedule_runs (
    id            bigserial PRIMARY KEY,
    schedule_id   integer REFERENCES user_schedules(id) ON DELETE SET NULL,
    schedule_name text NOT NULL,
    job_id        bigint REFERENCES jobs(id) ON DELETE CASCADE,
    fired_at      timestamptz NOT NULL DEFAULT now(),
    manual        boolean NOT NULL DEFAULT false,
    note          text
);
CREATE INDEX IF NOT EXISTS user_schedule_runs_fired_idx ON user_schedule_runs (fired_at DESC);
CREATE INDEX IF NOT EXISTS user_schedule_runs_schedule_idx ON user_schedule_runs (schedule_id, fired_at DESC);
