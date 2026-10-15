#!/bin/sh
# Topluluk temalarını themes.txt'teki sabit commit'lerden indirir ve qooxdoo kütüphanesi olarak kurar:
#   fetch-themes.sh <themes.txt dizini> <çıktı dizini>
# Her tema için yalnız LICENSE, Manifest.json ve listelenen source/ yolları alınır; Manifest'teki demo
# bağımlılıkları (qxl.formdemo vb.) silinir — yalnız @qooxdoo/framework kalır; <ad>.patch varsa uygulanır.
# Gereken: curl, tar, patch, node (Dockerfile'ın node:alpine "frontend" aşaması).
set -eu
SRC=$1
OUT=$2
mkdir -p "$OUT"

grep -vE '^[[:space:]]*(#|$)' "$SRC/themes.txt" | while read -r name repo commit paths; do
    tmp=$(mktemp -d)
    curl -fsSL --retry 3 --retry-delay 5 "https://codeload.github.com/$repo/tar.gz/$commit" \
        | tar -xz -C "$tmp" --strip-components=1
    dst="$OUT/$name"
    mkdir -p "$dst"
    cp "$tmp/LICENSE" "$tmp/Manifest.json" "$dst/"
    for p in $(echo "$paths" | tr ',' ' '); do
        mkdir -p "$dst/source/$(dirname "$p")"
        cp -R "$tmp/source/$p" "$dst/source/$p"
    done
    # Demo/test uygulamaları ve macOS artıkları alınmaz.
    rm -rf "$dst"/source/class/*/demo "$dst"/source/class/*/test "$dst"/source/class/*/resource
    find "$dst" -name .DS_Store -delete
    node -e '
        const fs = require("fs"), f = process.argv[1], m = JSON.parse(fs.readFileSync(f, "utf8"));
        m.requires = { "@qooxdoo/framework": m.requires["@qooxdoo/framework"] };
        fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");' "$dst/Manifest.json"
    if [ -f "$SRC/$name.patch" ]; then
        patch -s -p1 -d "$dst" < "$SRC/$name.patch"
    fi
    rm -rf "$tmp"
    echo "tema: $name ($repo@$(echo "$commit" | cut -c1-7))"
done
