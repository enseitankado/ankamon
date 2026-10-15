-- Kullanıcı başına küçük arayüz tercihleri (anahtar → JSON değer), ör. "boards.columns.widths"
-- (kullanıcının sürükleyerek ayarladığı sütun genişlikleri) ve "boards.columns.hidden" (gizlenen
-- sütunlar) — bkz. frontend page/Base.js _createTable(storageKey) ve AuthApi::prefs. Tarayıcıdan
-- bağımsız, oturumlar arası kalıcıdır.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
