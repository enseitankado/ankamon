-- Kullanıcı başına "Ekranlar" sekmesindeki önizleme kutucuklarının sürükle-bırakla değiştirilen sırası
-- (bkz. frontend docker/rootfs/screen/index.html + page/Boards.js __previewList). JSON dizi: tahta
-- id'leri, kullanıcının bıraktığı sırayla — tıpkı nav_order (008) gibi, burada OLMAYAN id'ler listenin
-- (süzgeç/sıralamadan gelen) doğal sırasıyla SONA eklenir; bu sütun yalnızca kullanıcının AÇIKÇA
-- değiştirdiği sırayı tutar, tam listeyi değil.
ALTER TABLE users ADD COLUMN IF NOT EXISTS screen_order jsonb NOT NULL DEFAULT '[]'::jsonb;
