/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
 * Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
 * https://github.com/enseitankado/ankamon
 *
 * Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
 * GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
 * daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
 * değiştirebilirsiniz.
 *
 * Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
 * YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
 * verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
 *
 * Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
 * dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
 * adresine bakınız.
 *
 * Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
 * parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
 * lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
 * korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
 * kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).
 */

/**
 * Grid yazdır / dışa aktar (kullanıcı isteği 2026-11-13; KALICI KURAL: bütün grid'lerde — bkz. page.Base._createTable).
 *
 * Erişim grid'in kendi üstündedir, grid dışında yer kaplayan düğme yoktur: tablo başlığının sağ üst köşesindeki
 * sütun düğmesinin (qx column-button) menüsüne "Yazdır…", "Dışa aktar ▸" (PDF, Excel, CSV, TXT, TSV, HTML, JSON,
 * Markdown) ve "Panoya kopyala" eklenir. Sütun menüsü olmayan grid'lerde düğme yalnız bu maddelerle görünür.
 *
 * Çıktı grid'in O ANKİ görünümüdür: süzülmüş satırlar ekrandaki sırayla (başlıkla yapılan sıralama dahil), görünür
 * sütunlar ekrandaki sırayla; hücre metni hücre çiziciden alınır (ekranda ne yazıyorsa o — simge/renk atılır).
 * İşaretli satır varsa "Yalnız işaretli satırlar" seçilebilir.
 *
 * Kütüphaneler (Dockerfile'da npm'den kaynak olarak kopyalanır, ilk kullanımda yüklenir):
 *   PDF  — pdfmake (MIT, https://pdfmake.github.io; gömülü Roboto Türkçe harfleri içerir)
 *   XLSX — ExcelJS (MIT, https://github.com/exceljs/exceljs)
 * Diğer biçimler ve yazdırma (tarayıcının yazdırma penceresi; oradan "PDF olarak kaydet" de olur) kütüphanesizdir.
 *
 * Grid başlığı: table.setUserData("exportTitle", "…") verilmişse o; yoksa grid bir penceredeyse pencere başlığı,
 * değilse üst yol (Ankamon > Ağ > Varlıklar).
 *
 * @asset(ankamon/pdfmake/*)
 * @asset(ankamon/exceljs/*)
 */
qx.Class.define("ankamon.ui.table.GridExport", {
  type: "static",

  statics: {
    /** [kimlik, menü metni, uzantı] — menü sırası. */
    FORMATS: [
      ["pdf", "PDF belgesi (.pdf)", "pdf"],
      ["xlsx", "Excel çalışma kitabı (.xlsx)", "xlsx"],
      ["csv", "CSV — virgülle ayrılmış (.csv)", "csv"],
      ["txt", "Düz metin, hizalı (.txt)", "txt"],
      ["tsv", "Sekmeyle ayrılmış (.tsv)", "tsv"],
      ["html", "Web sayfası (.html)", "html"],
      ["json", "JSON (.json)", "json"],
      ["md", "Markdown tablo (.md)", "md"]
    ],

    __libs: null,
    __installed: false,

    /**
     * Uygulama açılışında bir kez (bkz. Application.main): Ankamon'daki BÜTÜN qx tabloları — eklentilerinkiler ve
     * ileride yazılacaklar dahil — kendiliğinden bağlanır. Tablo kurucusu sütun düğmesini (column-button) kurarken
     * bağlama bir mikro görev sonraya bırakılır: kurucudan hemen sonraki .set({columnVisibilityButtonVisible})
     * ve sayfanın kendi sütun menüsü dinleyicileri önce yerleşsin. attach zaten bağlıysa bir şey yapmaz.
     * Bir tabloda istenmezse: table.setUserData("ankamon.gridExport", "off") (kurulduğu anda).
     */
    install() {
      if (this.__installed) {
        return;
      }
      this.__installed = true;
      const proto = qx.ui.table.Table.prototype;
      const create = proto._createChildControlImpl;
      proto._createChildControlImpl = function (id, hash) {
        const control = create.call(this, id, hash);
        if (id === "column-button") {
          Promise.resolve().then(() => {
            if (!this.isDisposed() && !this.getUserData("ankamon.gridExport")) {
              ankamon.ui.table.GridExport.attach(this);
            }
          });
        }
        return control;
      };
    },

    /**
     * Tabloya yazdır/dışa aktar menüsünü bağlar (bir kez). Sütun düğmesi kapalıysa açılır; o durumda menüde
     * sütun görünürlük maddeleri gösterilmez (o grid'in sütun menüsü yoktu), yalnız bu maddeler kalır.
     * @param table {qx.ui.table.Table}
     */
    attach(table) {
      if (table.getUserData("ankamon.gridExport")) {
        return;
      }
      table.setUserData("ankamon.gridExport", true);
      const exportOnly = !table.getColumnVisibilityButtonVisible();
      table.setColumnVisibilityButtonVisible(true);
      const button = table.getChildControl("column-button");
      button.setToolTipText(exportOnly ? "Yazdır / dışa aktar" : "Sütunlar, yazdır / dışa aktar");
      // Menü her açılışta yeniden kurulur (qx _initColumnMenu); maddeler o anda, menünün EN ÜSTÜNE eklenir (uzun
      // sütun listesinde kaydırmadan görünsün — canlı denemede altta kalıyordu).
      table.addListener("columnVisibilityMenuCreateEnd", e => {
        const menu = e.getData().menu;
        if (exportOnly) {
          // Sütun maddeleri gizlenir (silinmez: qx onları bir sonraki açılışta kendisi boşaltır/izler).
          menu.getChildren().forEach(child => child.exclude());
        }
        const items = this.__items(table);
        if (!exportOnly) {
          items.push(new qx.ui.menu.Separator());
        }
        items.forEach((item, i) => menu.addAt(item, i));
      });
    },

    /** Menü maddeleri (sırayla): [Yalnız işaretli satırlar], Yazdır…, Dışa aktar ▸, Panoya kopyala. */
    __items(table) {
      const menu = [];
      const checked = this.__checkedCount(table);
      let onlyChecked = null;
      if (checked) {
        onlyChecked = new qx.ui.menu.CheckBox(`Yalnız işaretli satırlar (${checked})`);
        onlyChecked.setToolTipText("İşaretsizse süzülmüş bütün satırlar alınır.");
        menu.push(onlyChecked);
      }
      const opts = () => ({ onlyChecked: !!(onlyChecked && onlyChecked.getValue()) });
      const print = new qx.ui.menu.Button("Yazdır…");
      print.setToolTipText("Grid'in sıralanmış/süzülmüş hâli yazıcı sayfası olarak; yazdırma penceresinden PDF de kaydedilebilir.");
      print.addListener("execute", () => this.print(table, opts()));
      menu.push(print);
      const sub = new qx.ui.menu.Menu();
      this.FORMATS.forEach(([id, label]) => {
        const item = new qx.ui.menu.Button(label);
        item.addListener("execute", () => this.download(table, id, opts()));
        sub.add(item);
      });
      menu.push(new qx.ui.menu.Button("Dışa aktar", null, null, sub));
      const copy = new qx.ui.menu.Button("Panoya kopyala");
      copy.setToolTipText("Sekmeyle ayrılmış (Excel/LibreOffice'e doğrudan yapıştırılır).");
      copy.addListener("execute", () => {
        const data = this.collect(table, opts());
        ankamon.util.Clipboard.copy(this.__delimited(data, "\t", false));
      });
      menu.push(copy);
      return menu;
    },

    __checkedCount(table) {
      if (table.getUserData("offset") !== 2) {
        return 0;
      }
      const tm = table.getTableModel();
      let n = 0;
      for (let row = 0; row < tm.getRowCount(); row++) {
        n += tm.getValue(1, row) ? 1 : 0;
      }
      return n;
    },

    /** Grid başlığı (bkz. sınıf açıklaması). */
    title(table) {
      const own = table.getUserData("exportTitle");
      if (own) {
        return own;
      }
      for (let w = table.getLayoutParent(); w; w = w.getLayoutParent()) {
        if (w instanceof qx.ui.window.Window && w.getCaption()) {
          return this.__text(w.getCaption());
        }
      }
      return ankamon.ui.ShellNavPath.currentText() || "Ankamon";
    },

    /**
     * Görünen grid → {title, at, columns:[ad], rows:[[metin]], sort}
     * @param opts {Map?} {onlyChecked}
     */
    collect(table, opts = {}) {
      const tm = table.getTableModel();
      const cm = table.getTableColumnModel();
      const lead = table.getUserData("offset") || 0; // kimlik / işaret sütunları
      const cols = [];
      for (let x = 0; x < cm.getOverallColumnCount(); x++) {
        const col = cm.getOverallColumnAtX(x);
        if (col >= lead && cm.isColumnVisible(col) && !(cm.getDataCellRenderer(col) instanceof ankamon.ui.table.CheckRenderer)) {
          cols.push({ col, x, name: this.__text(tm.getColumnName(col)) });
        }
      }
      const rows = [];
      for (let row = 0; row < tm.getRowCount(); row++) {
        if (opts.onlyChecked && !tm.getValue(1, row)) {
          continue;
        }
        const rowData = tm.getRowData ? tm.getRowData(row) : null;
        rows.push(cols.map(c => this.__cell(table, cm, c, row, tm.getValue(c.col, row), rowData)));
      }
      // Başlıksız, yalnız tek simge taşıyan arayüz sütunları (ör. Varlıklar'ın ▸ alt satır aç/kapa sütunu) çıktıya girmez.
      const keep = cols.map((c, i) => c.name !== "" || rows.some(r => r[i].length > 1));
      const pick = arr => arr.filter((_, i) => keep[i]);
      let sort = "";
      try {
        const sc = tm.getSortColumnIndex ? tm.getSortColumnIndex() : -1;
        if (sc >= 0) {
          sort = `${this.__text(tm.getColumnName(sc))} ${tm.isSortAscending() ? "↑" : "↓"}`;
        }
      } catch (e) {
        sort = "";
      }
      return { title: this.title(table), at: new Date(), columns: pick(cols.map(c => c.name)), rows: rows.map(pick), sort,
        onlyChecked: !!opts.onlyChecked };
    },

    /** Hücrenin ekranda görünen metni: çizicinin içerik HTML'i düz metne çevrilir; çizemezse ham değer. */
    __cell(table, cm, c, row, value, rowData) {
      const renderer = cm.getDataCellRenderer(c.col);
      let text = null;
      if (renderer && renderer._getContentHtml) {
        try {
          const html = renderer._getContentHtml({ table, row, col: c.col, xPos: c.x, value, rowData,
            styleLeft: 0, styleWidth: 100, styleHeight: 28, selected: false, focusedRow: false, editable: false });
          text = this.__text(html);
        } catch (e) {
          text = null;
        }
      }
      if (text === null || (text === "" && value !== null && value !== undefined && value !== "")) {
        if (typeof value === "boolean") {
          text = value ? "Evet" : "Hayır";
        } else if (value instanceof Date) {
          text = value.toLocaleString("tr-TR");
        } else {
          text = this.__text(value);
        }
      }
      return text;
    },

    /** HTML ya da değer → tek satırlık düz metin (svg/style atılır, boşluklar sadeleşir). */
    __text(v) {
      if (v === null || v === undefined) {
        return "";
      }
      let s = String(v);
      if (/[<&]/.test(s)) {
        const tpl = document.createElement("template");
        tpl.innerHTML = s;
        tpl.content.querySelectorAll("svg, style, script").forEach(n => n.remove());
        tpl.content.querySelectorAll("br").forEach(n => n.replaceWith(" "));
        s = tpl.content.textContent;
      }
      // Durum noktası gibi baştaki süs simgeleri ("●Çevrim içi") atılır.
      return s.replace(/\s+/g, " ").trim().replace(/^[●○◉•▸▾]\s*(?=\S)/u, "");
    },

    /** "varliklar-2026-11-13-1530.csv" */
    fileName(data, ext) {
      const map = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };
      const leaf = data.title.split(/\s*[>›▸]\s*/).filter(p => p && p !== "Ankamon").slice(-2).join("-") || "ankamon";
      const slug = leaf.replace(/[çğıİöşüÇĞÖŞÜ]/g, ch => map[ch]).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const d = data.at;
      const p2 = n => String(n).padStart(2, "0");
      return `${slug || "ankamon"}-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.${ext}`;
    },

    /** Başlık altındaki bilgi satırı: "13.11.2026 15:30 · 42 satır · sıralama: Ad ↑ · yalnız işaretli". */
    meta(data) {
      return [data.at.toLocaleString("tr-TR"), `${data.rows.length} satır`, data.sort ? `sıralama: ${data.sort}` : "",
        data.onlyChecked ? "yalnız işaretli satırlar" : ""].filter(Boolean).join(" · ");
    },

    /** @param format {String} FORMATS kimliği */
    async download(table, format, opts = {}) {
      const data = this.collect(table, opts);
      const ext = this.FORMATS.find(f => f[0] === format)[2];
      const name = this.fileName(data, ext);
      try {
        if (format === "pdf") {
          await this.__pdf(data, name);
          return;
        }
        if (format === "xlsx") {
          this.__save(await this.__xlsx(data), name);
          return;
        }
        const [body, type] = {
          csv: () => ["﻿" + this.__delimited(data, ",", true), "text/csv"],
          tsv: () => ["﻿" + this.__delimited(data, "\t", false), "text/tab-separated-values"],
          txt: () => [this.__txt(data), "text/plain"],
          html: () => [this.__html(data, false), "text/html"],
          json: () => [JSON.stringify(data.rows.map(r => Object.fromEntries(data.columns.map((c, i) => [c || `Sütun ${i + 1}`, r[i]]))), null, 1), "application/json"],
          md: () => [this.__md(data), "text/markdown"]
        }[format]();
        this.__save(new Blob([body], { type: type + ";charset=utf-8" }), name);
      } catch (e) {
        ankamon.ui.Dialog.alert("Dışa aktarılamadı: " + (e && e.message ? e.message : e));
      }
    },

    __save(blob, name) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    },

    /**
     * CSV (RFC 4180) / TSV. CSV'de formül enjeksiyonuna karşı = + - @ ile başlayan sayı olmayan hücreye ' eklenir.
     * @param quote {Boolean} CSV tırnaklaması (false: TSV — sekme/satır sonu boşluğa çevrilir)
     */
    __delimited(data, sep, quote) {
      const cell = v => {
        if (!quote) {
          return v.replace(/[\t\r\n]+/g, " ");
        }
        if (/^[=+\-@]/.test(v) && !/^[-+]?\d[\d.,\s]*%?$/.test(v)) {
          v = "'" + v;
        }
        return /[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      };
      return [data.columns].concat(data.rows).map(r => r.map(cell).join(sep)).join("\r\n") + "\r\n";
    },

    /** Hizalı düz metin: sütun genişliği en uzun hücre (en çok 60 karakter; uzunsa … ile kısaltılır). */
    __txt(data) {
      const MAX = 60;
      const cut = v => (v.length > MAX ? v.slice(0, MAX - 1) + "…" : v);
      const all = [data.columns].concat(data.rows).map(r => r.map(cut));
      const w = data.columns.map((_, i) => Math.max(...all.map(r => r[i].length)));
      const line = r => r.map((v, i) => v.padEnd(w[i])).join("  ").trimEnd();
      return [data.title, this.meta(data), "", line(all[0]), w.map(n => "-".repeat(n)).join("  ")]
        .concat(all.slice(1).map(line)).join("\n") + "\n";
    },

    __md(data) {
      const esc = v => v.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
      const row = r => "| " + r.map(esc).join(" | ") + " |";
      return [`# ${data.title}`, "", this.meta(data), "", row(data.columns), "|" + data.columns.map(() => " --- |").join("")]
        .concat(data.rows.map(row)).join("\n") + "\n";
    },

    /** Yazıcı dostu HTML belge (Yazdır ve .html). Çok sütunda sayfa yatay. */
    __html(data, forPrint) {
      const esc = s => qx.bom.String.escape(String(s));
      const landscape = data.columns.length > 6;
      const small = data.columns.length > 10;
      return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(data.title)}</title><style>
@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 12mm; }
body { font: ${small ? 9 : 10.5}pt "Segoe UI", Roboto, "DejaVu Sans", Arial, sans-serif; color: #111; margin: ${forPrint ? 0 : "16px"}; }
h1 { font-size: 14pt; margin: 0 0 2px; }
.meta { color: #555; font-size: 9pt; margin-bottom: 8px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #bbb; padding: 3px 5px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: #eee; }
tr:nth-child(even) td { background: #f7f7f7; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head><body><h1>${esc(data.title)}</h1><div class="meta">${esc(this.meta(data))}</div>
<table><thead><tr>${data.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
${data.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("\n")}
</tbody></table></body></html>`;
    },

    /** Gizli çerçevede yazıcı sayfası → tarayıcının yazdırma penceresi. */
    print(table, opts = {}) {
      const data = this.collect(table, opts);
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
      document.body.appendChild(frame);
      const doc = frame.contentWindow.document;
      doc.open();
      doc.write(this.__html(data, true));
      doc.close();
      const cleanup = () => setTimeout(() => frame.remove(), 1000);
      frame.contentWindow.addEventListener("afterprint", cleanup);
      setTimeout(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => frame.isConnected && frame.remove(), 120000);
      }, 50);
    },

    /** Kütüphaneyi (bir kez) yükler. @param kind {String} "pdfmake" | "exceljs" */
    __load(kind) {
      const libs = this.__libs || (this.__libs = {});
      if (!libs[kind]) {
        const rm = qx.util.ResourceManager.getInstance();
        const files = kind === "pdfmake" ? ["pdfmake.min.js", "vfs_fonts.js"] : ["exceljs.min.js"];
        libs[kind] = new Promise((resolve, reject) => {
          const loader = new qx.util.DynamicScriptLoader(files.map(f => rm.toUri(`ankamon/${kind}/${f}`)));
          loader.addListenerOnce("ready", () => resolve(kind === "pdfmake" ? window.pdfMake : window.ExcelJS));
          loader.addListenerOnce("failed", () => {
            libs[kind] = null;
            reject(new Error(kind + " yüklenemedi"));
          });
          loader.start();
        });
      }
      return libs[kind];
    },

    async __pdf(data, name) {
      const pdfMake = await this.__load("pdfmake");
      const n = data.columns.length;
      const landscape = n > 6;
      const pageSize = n > 14 ? "A3" : "A4";
      const fontSize = n > 10 ? 7 : (n > 6 ? 8 : 9);
      const [pw, ph] = pageSize === "A3" ? [842, 1191] : [595, 842];
      const avail = (landscape ? ph : pw) - 60;
      // Sütun genişliği içerik uzunluğuyla orantılı (başlık dahil; 4–40 karakter arasında sınırlanır).
      const weight = data.columns.map((c, i) => {
        const lens = data.rows.slice(0, 500).map(r => r[i].length).sort((a, b) => a - b);
        const p90 = lens.length ? lens[Math.floor(lens.length * 0.9)] : 0;
        return Math.min(40, Math.max(4, p90, Math.min(c.length, 16)));
      });
      const sum = weight.reduce((a, b) => a + b, 0) || 1;
      const widths = weight.map(w => Math.max(18, avail * w / sum - 8));
      const body = [data.columns.map(c => ({ text: c, bold: true, fillColor: "#eeeeee" }))]
        .concat(data.rows.map(r => r.map(v => ({ text: v }))));
      const doc = {
        pageSize, pageOrientation: landscape ? "landscape" : "portrait", pageMargins: [30, 30, 30, 30],
        info: { title: data.title, creator: "Ankamon" },
        defaultStyle: { font: "Roboto", fontSize },
        content: [
          { text: data.title, fontSize: 13, bold: true },
          { text: this.meta(data), fontSize: 8, color: "#555555", margin: [0, 2, 0, 8] },
          { table: { headerRows: 1, widths, body }, layout: {
            hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => "#bbbbbb", vLineColor: () => "#bbbbbb",
            fillColor: (row) => (row > 0 && row % 2 === 0 ? "#f7f7f7" : null),
            paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2 } }
        ],
        footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: "right", fontSize: 7, color: "#777777", margin: [0, 8, 30, 0] })
      };
      await pdfMake.createPdf(doc).download(name);
    },

    async __xlsx(data) {
      const ExcelJS = await this.__load("exceljs");
      const wb = new ExcelJS.Workbook();
      wb.creator = "Ankamon";
      wb.created = data.at;
      const sheetName = (data.title.split(/\s*[>›▸]\s*/).pop() || "Liste").replace(/[\[\]:*?/\\]/g, " ").slice(0, 31);
      const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
      ws.addRow(data.columns).font = { bold: true };
      // Yalnız düz sayı biçimindeki hücreler sayıya çevrilir (IP, MAC, tarih metin kalır).
      const num = v => (/^-?\d{1,15}([.,]\d+)?$/.test(v) && !/^0\d/.test(v) ? Number(v.replace(",", ".")) : v);
      data.rows.forEach(r => ws.addRow(r.map(num)));
      ws.columns.forEach((col, i) => {
        const longest = Math.max(data.columns[i].length, ...data.rows.slice(0, 1000).map(r => r[i].length));
        col.width = Math.min(60, Math.max(6, longest + 2));
      });
      if (data.columns.length) {
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: data.columns.length } };
      }
      const buf = await wb.xlsx.writeBuffer();
      return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    }
  }
});
