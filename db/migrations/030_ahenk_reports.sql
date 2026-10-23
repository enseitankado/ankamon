-- Ahenk kontrol (hazır işlem actions/ahenk-check, araç enseitankado/ahenk-debug): tahta başına SON rapor.
-- Runner iş bitince tahtadaki /opt/ahenk-debug/son-rapor.json'u okuyup buraya yazar (bkz. worker
-- executor/ahenk.py); Bakım ▸ Ahenk sekmesi summary'den tablo, report'tan ayrıntı gösterir. Yalnız son
-- rapor tutulur (tahta başına bir satır) — geçmiş, görevin kendi kaydında (Komut logları) durur.
-- exit_code: 0 sorun yok · 1 uyarı · 2 kritik.
CREATE TABLE IF NOT EXISTS ahenk_reports (
    board_id   integer PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
    checked_at timestamptz NOT NULL DEFAULT now(),
    job_id     bigint,
    exit_code  integer,
    tool_commit text,
    summary    jsonb NOT NULL DEFAULT '{}'::jsonb,
    report     jsonb NOT NULL DEFAULT '{}'::jsonb
);
