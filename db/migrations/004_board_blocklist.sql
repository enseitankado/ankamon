-- Elle silinen tahtaların hostname'i: worker'ın logs tablosundan (boards_from_logs) aynı adla
-- otomatik yeni kayıt açmasını engeller. Tahta "Ekle" ile elle yeniden kaydedilince giriş kaldırılır
-- (bkz. BoardsApi::create). hostname küçük harfe çevrilerek saklanır (boards.hostname eşleşmesiyle
-- aynı biçimde, bkz. boards_hostname_idx).
CREATE TABLE IF NOT EXISTS board_blocklist (
    hostname   text PRIMARY KEY,
    deleted_at timestamptz NOT NULL DEFAULT now()
);
