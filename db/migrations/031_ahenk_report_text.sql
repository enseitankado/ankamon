-- Ahenk kontrol: ahenk-debug'ın renkli (ANSI) okunur raporu — Bakım ▸ Ahenk'te satıra çift tıklayınca
-- gösterilir (bkz. actions/ahenk-check/run.sh son-rapor.ansi, worker executor/ahenk.py).
ALTER TABLE ahenk_reports ADD COLUMN IF NOT EXISTS report_text text;
