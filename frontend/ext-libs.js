/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Eklentilerin arayüz kısmını derlemeye katar (bkz. ext/README.md, ankamon.ext.Extensions):
// <ext dizini>/<ad>/frontend/Manifest.json olan her eklenti compile.json'a qooxdoo kütüphanesi olarak
// eklenir ve "ankamonext.*" sınıfları pakete dahil edilir (çekirdek onları adıyla anmadığı için
// qooxdoo kendiliğinden katmazdı). Eklenti yoksa compile.json değişmez.
// Kullanım (Dockerfile "frontend" aşaması): node ext-libs.js <ext dizini>
const fs = require("fs");
const path = require("path");

const extDir = process.argv[2];
const libs = (fs.existsSync(extDir) ? fs.readdirSync(extDir) : [])
  .filter(name => fs.existsSync(path.join(extDir, name, "frontend", "Manifest.json")))
  .map(name => path.join(extDir, name, "frontend"));
if (libs.length) {
  const config = JSON.parse(fs.readFileSync("compile.json", "utf8"));
  config.libraries.push(...libs);
  config.applications.forEach(app => {
    app.include = [...(app.include || []), "ankamonext.*"];
  });
  fs.writeFileSync("compile.json", JSON.stringify(config, null, 2));
}
console.log("Eklenti kütüphaneleri: " + (libs.join(", ") || "yok"));
