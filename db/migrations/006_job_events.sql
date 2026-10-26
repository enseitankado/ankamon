-- Görev olay akışı: komut/işlem görevlerinin tahta başına canlı ayrıntısı (bağlanılıyor, bağlandı,
-- çıktı satırları, çıkış kodu…). Görev yürütücüsü (worker/ankamon/runner) olayları oluştukça yazar;
-- arayüzün canlı çıktı penceresi /api/jobs/{id}/events?after=<son id> ile artımlı okur.
-- job_targets.output yine özet (son hâl) olarak tutulur; bu tablo ayrıntılı zaman çizelgesidir.
CREATE TABLE IF NOT EXISTS job_events (
    id       bigserial PRIMARY KEY,
    job_id   bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    board_id integer,                       -- NULL: görevin geneline ait olay
    time     timestamptz NOT NULL DEFAULT now(),
    kind     text NOT NULL DEFAULT 'info',  -- info | out | err | ok | fail
    text     text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS job_events_job_idx ON job_events (job_id, id);
