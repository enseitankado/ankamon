-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Elektrik kesintisi anomalileri (kullanıcı isteği 2026-11-13; worker anomaly/power_loss.py, power_outage_area.py):
-- cihaz her açılıştan sonra bir kez SSH ile yoklanır (worker tasks/power_probe.py). Satır = cihazın bir açılışı (boot_id).
--   power_cycles / unsafe_shutdowns: sistem diskinin SMART sayaçları (açılış sayısı; ani güç kaybı sayacı — SATA 235
--     POR_Recovery_Count / 174 Unexpect_Power_Loss_Ct / 192 Unsafe_Shutdown_Count, NVMe unsafe_shutdowns). İki ardışık
--     yoklama arasındaki fark, aradaki kapanışların kaçının diske güç kesilerek olduğunu verir: işletim sisteminin
--     kapatması (menü, ETAP zorla kapat / otomatik kapanma — poweroff -f) diski durdurur, sayaç artmaz; fiş çekilince artar.
--   prev_*: ÖNCEKİ açılışın cihazın kendi (kalıcı) journal'ındaki başı/sonu ve kapanış izi var mı (prev_clean).
--     Son satırın zamanı kesinti anına ~30 sn yakındır (session_probe 30 sn'de bir sshd satırı yazdırır).
--   eta_shutdown: /etc/pardus/eta-shutdown.conf (otomatik kapanma ayarı) — SMART'ı olmayan diskte ipucu.
CREATE TABLE IF NOT EXISTS device_power_probes (
    device_id        integer NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    boot_id          text NOT NULL,
    booted_at        timestamptz NOT NULL,
    first_probed_at  timestamptz NOT NULL DEFAULT now(),
    probed_at        timestamptz NOT NULL DEFAULT now(),
    disk             text,
    disk_model       text,
    power_cycles     bigint,
    unsafe_shutdowns bigint,
    unsafe_attr      text,
    prev_started_at  timestamptz,
    prev_ended_at    timestamptz,
    prev_clean       boolean,
    prev_kind        text,
    prev_last_line   text,
    eta_shutdown     jsonb,
    PRIMARY KEY (device_id, boot_id)
);
CREATE INDEX IF NOT EXISTS device_power_probes_booted_idx ON device_power_probes (device_id, booted_at DESC);
