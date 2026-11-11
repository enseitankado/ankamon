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
 * Wi-Fi Monitör grid'lerinin modeli (bkz. ui.boards.WifiMonitor). Pencerede iki sekme (kullanıcı isteği 2026-11-10):
 * "Tespitler" (varsayılan; bulgular, satır başında onay kutusu) ve "Sensörler" (seçili tahtaların tarama/izleme durumu).
 * Hücre değerleri düz metindir (sütun süzgeçleri, hazır değer listeleri ve sıralama onu kullanır); renkli/zengin görünüm ve
 * ipuçları satır kimliğine bağlı ek veriden (ui.boards.WifimonCellRenderer).
 */
qx.Class.define("ankamon.ui.boards.WifimonRender", {
  type: "static",

  statics: {
    LEVELS: {
      phone: { label: "Telefon", color: "#d93025", tip: "Güvenilir değil ve telefon olduğuna dair güçlü kanıt var." },
      maybe: { label: "Olası", color: "#e8710a", tip: "Güvenilir değil; telefon/tablet olabilir (zayıf kanıt)." },
      foreign: { label: "Yabancı", color: "#b08000", tip: "Güvenilir listesinde değil." },
      common: { label: "Ortak", color: "#6b7280", tip: "Güvenilir değil ama aynı erişim noktası (aynı MAC) sensörlerin çoğunca duyuluyor: okulun AP'si olası." },
      fixed: { label: "Güvenilir", color: "#6b7280", tip: "Güvenilir listesinde (MAC adresiyle), sensörün bağlı olduğu ağ ya da bir Ankamon tahtası." }
    },
    KIND_LABEL: { wifi: "Wi-Fi ağı", probe: "Wi-Fi arayan cihaz", client: "Wi-Fi'ye bağlı cihaz" },
    PROBE_NOTE: {
      nodev: "Wi-Fi kartı yok; Wi-Fi trafiği dinlenemedi.",
      tools: "Tahtada iw ya da python3 yok; Wi-Fi trafiği dinlenemedi.",
      radio: "Wi-Fi açılamadığından Wi-Fi trafiği dinlenemedi.",
      busy: "Wi-Fi kartı bir ağa bağlı/bağlanıyor; bağlantı kesilmesin diye Wi-Fi trafiği dinlenmedi.",
      nomon: "Wi-Fi kartı monitör kipini desteklemiyor; Wi-Fi trafiği dinlenemedi.",
      shared: "Bu tahtada başka bir pencere Wi-Fi trafiğini dinliyor; bu turda atlandı.",
      monfail: "Monitör arabirimi kurulamadı; Wi-Fi trafiği dinlenemedi.",
      sshwifi: "Tahtaya SSH bağlantısı Wi-Fi kartı üzerinden; erişim kesilmesin diye monitör kipine alınmadı."
    },

    /** "Tespitler" grid'inin sütunları (sırası kullanıcıca değiştirilebilir — "wifimon.columns" tercihi). */
    COLUMNS: [
      { id: "level", label: "Durum", width: 110, choices: true, hint: "Bulgunun öne çıkma düzeyi" },
      { id: "sensor", label: "Sensör", width: 150, choices: true, hint: "Vericiyi duyan Ankamon tahtası (Wi-Fi kartıyla dinleyen)" },
      { id: "device", label: "Tespit edilen cihaz", width: 170,
        hint: "Duyulan vericinin MAC adresi (N× = aynı cihaz sayılan N rastgele adres; ipucunda hepsi)" },
      { id: "kind", label: "Tür", width: 170, choices: true },
      { id: "name", label: "Ad", width: 170, hint: "Ağ adı (SSID); bağlı cihazda bağlı olduğu ağ" },
      { id: "signal", label: "Sinyal", width: 175, hint: "Sinyal gücü ve kaba yakınlık" },
      { id: "evidence", label: "Kanıt", width: 300 },
      { id: "vendor", label: "Üretici", width: 140, choices: true, hint: "MAC adresinin üretici kodundan (OUI) bulunan üretici" },
      { id: "seen", label: "Son görülme", width: 130, choices: false }
    ],

    /** "Sensörler" grid'inin sütunları ("wifimon.sensors.columns" tercihi). */
    SENSOR_COLUMNS: [
      { id: "state", label: "Durum", width: 130, choices: true, hint: "Tarama/izleme durumu" },
      { id: "sensor", label: "Sensör", width: 160, choices: true, hint: "Wi-Fi kartıyla çevreyi dinleyen Ankamon tahtası" },
      { id: "mode", label: "Kip", width: 150, choices: true, hint: "Monitör kipi: Wi-Fi trafiği dinleniyor; Ağ taraması: yalnız çevredeki Wi-Fi ağları listeleniyor" },
      { id: "card", label: "Wi-Fi kartı", width: 190, choices: true, hint: "Kart adı ve bağlı olduğu ağ" },
      { id: "findings", label: "Bulgular", width: 260, hint: "Bu sensörün tespitlerinin düzeylere göre sayısı" },
      { id: "probes", label: "Arayan", width: 80, hint: "Son dinlemede ağ arayan cihaz kestirimi" },
      { id: "clients", label: "Bağlı", width: 80, hint: "Son dinlemede bir ağa bağlı ve veri gönderen cihaz sayısı" },
      { id: "notes", label: "Notlar", width: 300 },
      { id: "seen", label: "Son tarama", width: 110, choices: false }
    ],

    chip(text, color, tip) {
      return `<span title="${qx.bom.String.escape(tip || "")}" style="display:inline-block;padding:0 7px;border-radius:9px;font-size:12px;` +
        `line-height:18px;font-weight:600;color:${color};border:1px solid ${color}66;white-space:nowrap">${qx.bom.String.escape(text)}</span>`;
    },

    /** Sinyal göstergesi: çubuk, yüzde (sabit genişlikte — çubuklar alt alta hizalı kalsın) ve yakınlık. Hücrede sola yaslı. */
    bar(signal) {
      if (signal === null || signal === undefined || signal === "") {
        return "";
      }
      const color = signal >= 60 ? "#2fa84a" : signal >= 35 ? "#e8a200" : "#d93025";
      return `<span style="display:inline-block;width:50px;height:8px;background:rgba(127,127,127,.25);border-radius:4px;vertical-align:middle">` +
        `<span style="display:block;width:${signal}%;height:100%;background:${color};border-radius:4px"></span></span>` +
        `<span style="display:inline-block;width:40px;text-align:right;margin-right:6px">${signal}%</span>` +
        `<span style="opacity:.7">${ankamon.ui.boards.WifimonClassify.proximity(signal)}</span>`;
    },

    __ago(ms, now) {
      const s = Math.max(0, Math.round((now - ms) / 1000));
      return s < 60 ? s + " sn önce" : s < 3600 ? Math.round(s / 60) + " dk önce" : Math.round(s / 3600) + " sa önce";
    },

    /**
     * Kanıt terimleri [{text, tip}]: kısa terim hücrede, açıklaması hücre ipucunda. "x sensörde": aynı MAC adresini duyan
     * sensörler (ağ adına göre değil); ipucunda adres ve duyan sensörler.
     */
    __evidence(item) {
      const row = item.row;
      const terms = [];
      const add = (text, tip) => terms.push({ text, tip: tip || text });
      if (item.fixed) {
        add("güvenilir", "Güvenilir listesinde: MAC " + item.fixed.value + (item.fixed.board_id ? " (bu sınıf)" : " (okul geneli)"));
      }
      const probing = row.kind === "probe" || (row.also || []).includes("probe");
      if (row.kind === "client") {
        add("ağa bağlı", "Bir erişim noktasına bağlı ve veri gönderiyor (içerik şifreli; yalnız adresler görülür). " +
          `Ağ: ${row.name || "(adı bilinmiyor)"} · erişim noktası ${row.bssid || "?"}` + (row.chan ? ` · kanal ${row.chan}` : ""));
      }
      if (probing) {
        const ssids = row.ssids || [];
        add("Cihaz ağ arıyor", "Bağlanacak ağ araştırıyor (Wi-Fi yoklaması)." +
          (row.kind !== "probe" && ssids.length ? `\nAradığı ağlar (${ssids.length}):\n` + ssids.join("\n") : ""));
      }
      const addrs = row.addrs || [];
      if (addrs.length > 1) {
        const why = (row.why || []).map(w => ankamon.ui.boards.WifimonClassify.MERGE_REASON[w] || w);
        add(`${addrs.length} adres`, `Aynı cihaz sayılan ${addrs.length} rastgele adres (telefon her taramada yeni adres alır)` +
          (why.length ? " — gerekçe: " + why.join(", ") : "") + ". Kestirimdir.\n" + addrs.join("\n"));
      }
      (row.hints || []).forEach(h => {
        if (/^rastgele adres/.test(h)) {
          return; // Üretici sütunu "Rastgele" gösteriyor (kullanıcı isteği 2026-11-10)
        }
        if (/paylaşım noktasına benziyor/.test(h)) {
          add("hotspot adı", h);
          return;
        }
        const m = /^(.*?)\s*\((.+)\)$/.exec(h); // "rastgele adres (telefon/tablet olağan)" → "rastgele adres" + açıklama
        add(m ? m[1] : h, h);
      });
      if (row.kind === "client" && row.count) {
        add(`${row.count} çerçeve`, "Dinleme süresince bu cihazdan duyulan veri çerçevesi sayısı.");
      }
      const probes = row.kind === "probe" ? row.count : row.probeCount;
      if (probing && probes) {
        add(`${probes} yoklama`, "Dinleme süresince duyulan yoklama sayısı.");
      }
      const heard = item.heard || [];
      if (heard.length >= 2) {
        add(`${heard.length} sensörde`, `Bu MAC adresini (${row.addr}) ${heard.length} sensör duyuyor:\n` +
          heard.map(h => `${h.name} — ${h.signal === null || h.signal === undefined ? "?" : h.signal + "%"}`).join("\n"));
      }
      return terms;
    },

    /**
     * "Tespit edilen cihaz" ipucu: rastgele adresli arayan cihazda birleşen adresler ve aynı cihaz sayma ölçütleri
     * (✓ bu satırda eşleşen, – eşleşmeyen); diğer satırlarda adresin türü.
     */
    __deviceHint(row) {
      const Classify = ankamon.ui.boards.WifimonClassify;
      const addrs = row.addrs || [];
      const probing = row.kind === "probe" || (row.also || []).includes("probe");
      if (!(row.random && probing) && addrs.length <= 1) {
        return row.random ? "Rastgele (yerel yönetimli) adres" : null;
      }
      const why = new Set(row.why || []);
      const head = addrs.length > 1 ? `Aynı cihaz sayılan ${addrs.length} rastgele adres:\n` + addrs.join("\n")
        : `Rastgele (yerel yönetimli) adres: ${row.addr} — başka bir adresle aynı cihaz sayılmadı.`;
      return head + "\n\nAynı cihaz sayma ölçütleri (✓ bu satırda eşleşen):\n" +
        Classify.MERGE_CRITERIA.map(([code, text]) => (why.has(code) ? "✓ " : "– ") + text).join("\n") +
        "\n\nAranan ağ listeleri çelişen adresler birleşmez; kalıcı (üretici) adresler birleştirilmez. Kestirimdir: " +
        "aynı model iki telefon yan yanaysa birleşebilir.";
    },

    __vendorText(row) {
      return row.vendor || (row.random ? "Rastgele" : "—");
    },

    __kindText(row) {
      const label = this.KIND_LABEL[row.kind] || row.kind;
      if (row.kind === "probe") {
        const n = (row.ssids || []).length;
        return n ? `${label} (${n})` : label;
      }
      return label + (row.active ? " (sensör bağlı)" : "");
    },

    __kindHint(row) {
      if (row.kind === "probe") {
        const ssids = row.ssids || [];
        return ssids.length ? `Aradığı ağlar (${ssids.length}):\n` + ssids.join("\n") : "Ağ adı vermeden arıyor (çevredeki bütün ağları soruyor).";
      }
      if (row.kind === "client") {
        return `Bağlı olduğu ağ: ${row.name || "(adı bilinmiyor)"}\nErişim noktası: ${row.bssid || "?"}` + (row.chan ? `\nKanal: ${row.chan}` : "");
      }
      return [row.chan ? "Kanal " + row.chan : "", row.freq, row.security ? "Güvenlik: " + row.security : "Açık ağ"].filter(Boolean).join(" · ");
    },

    __nameText(row) {
      if (row.kind === "probe") {
        const w = row.wps || {};
        return Array.from(new Set([w.name, w.model, w.number].filter(Boolean))).join(" "); // WPS öğesindeki cihaz adı
      }
      if (row.kind === "client") {
        return (row.board_name ? row.board_name + " " : "") + "→ " + (row.name || "(ağ adı bilinmiyor)");
      }
      return row.name || "(gizli ağ)";
    },

    /**
     * "Sensörler" grid'inin satırları. entries: [{feed, view}] — feed: WifiMonitor'deki sensör durumu {board, name, watching,
     * ws, error, statusText, notes, data, probeInfo, sniffing, forced, at}; view: Classify.board().
     * @return {Map} {rows: Array, meta: Map}
     */
    sensorModel(entries) {
      const esc = qx.bom.String.escape;
      const L = this.LEVELS;
      const rows = [];
      const meta = new Map();
      entries.forEach(({ feed, view }) => {
        const c = view.counts;
        let state;
        let stateHtml;
        const spinner = ankamon.ui.JobSpinner.html();
        if (feed.error) {
          state = feed.statusText || "Hata";
          stateHtml = `<span style="color:#d93025">${esc(state)}</span>`;
        } else if (feed.watching && feed.ws) {
          state = "İzleniyor";
          stateHtml = `${spinner} <span style="color:#1e8e3e">İzleniyor</span>`;
        } else if (feed.ws) {
          state = feed.statusText || "Taranıyor…";
          stateHtml = `${spinner} ${esc(state)}`;
        } else {
          state = feed.statusText || "Bitti";
          stateHtml = `<span style="opacity:.75">${esc(state)}</span>`;
        }
        const d = feed.data;
        let card = d ? (d.device ? d.device + " · " + (d.connection ? "bağlı: " + d.connection : "bağlı değil") : "Wi-Fi kartı yok") : "";
        if (feed.forced) {
          card += " · bağlantı kesildi (onaylı)";
        }
        const mode = feed.sniffing ? "Monitör kipi" : d ? "Ağ taraması" : "";
        const parts = [];
        const counted = [["phone", c.phone], ["maybe", c.maybe], ["foreign", c.foreign], ["common", c.common], ["fixed", c.fixed]];
        counted.forEach(([lv, n]) => n && parts.push({ text: `${L[lv].label} ${n}`, color: L[lv].color, tip: L[lv].tip }));
        const pi = feed.probeInfo && !feed.probeInfo.note ? feed.probeInfo : null;
        const notes = (feed.notes || []).filter(Boolean);
        const id = `s|${feed.board.id}`;
        rows.push([id, state, feed.name, mode, card, parts.map(p => p.text).join(" · "), pi ? pi.devices ?? "" : "",
          pi ? pi.clients || 0 : "", notes.join(" "), feed.at ? new Date(feed.at).toLocaleTimeString("tr-TR") : ""]);
        meta.set(id, {
          sensor: true, feed, lastAt: feed.at || 0,
          html: {
            state: stateHtml,
            mode: feed.sniffing ? `<span style="color:#e8710a">● Monitör kipi</span>` : null,
            findings: parts.map(p => this.chip(p.text, p.color, p.tip)).join(" ")
          },
          hint: {
            state: [feed.watching ? "Sürekli izleniyor (liste kendiliğinden tazelenir)." : "Tek tarama."].concat(notes).join("\n"),
            mode: feed.sniffing ? "Wi-Fi kartı dinleme süresince monitör kipinde (Tahtalar listesinin Wi-Fi sütununda 'Monitör modu')."
              : "Kart monitör kipinde değil: yalnız çevredeki Wi-Fi ağları listeleniyor.",
            card: card || null,
            findings: parts.length ? parts.map(p => `${p.text}: ${p.tip}`).join("\n") : null,
            probes: pi ? `Son ${pi.secs || "?"} sn dinlemede ağ arayan cihaz kestirimi.` : null,
            clients: pi ? `Son ${pi.secs || "?"} sn dinlemede bir ağa bağlı ve veri gönderen cihaz sayısı.` : null,
            notes: notes.join("\n") || null
          }
        });
      });
      return { rows, meta };
    },

    /**
     * "Tespitler" grid'inin satırları (onay kutusu sütunu dahil — işaret `checked` kümesinden). entries: [{feed, view}].
     * @param opts {Map} {showFixed, now, checked: Set}
     * @return {Map} {rows: Array, meta: Map}
     */
    model(entries, opts) {
      const esc = qx.bom.String.escape;
      const rows = [];
      const meta = new Map();
      const now = opts.now;
      const findings = [];
      entries.forEach(({ feed, view }) => view.rows.forEach(item => {
        if (opts.showFixed || item.level !== "fixed") {
          findings.push({ item, feed });
        }
      }));
      const sig = it => (it.item.row.signal === null || it.item.row.signal === undefined ? -1 : it.item.row.signal);
      const Classify = ankamon.ui.boards.WifimonClassify;
      findings.sort((a, b) => Classify.LEVEL_ORDER[a.item.level] - Classify.LEVEL_ORDER[b.item.level] || sig(b) - sig(a));
      findings.forEach(({ item, feed }) => {
        const row = item.row;
        const lv = this.LEVELS[item.level];
        const terms = this.__evidence(item);
        const seen = [];
        if (item.isNew) {
          seen.push("yeni");
        }
        if (row.seen_days > 1) {
          seen.push(`${row.seen_days} günde`);
        }
        if (item.lastAt) {
          seen.push(this.__ago(item.lastAt, now));
        }
        const id = `${feed.board.id}|${item.key}`;
        const name = this.__nameText(row);
        const hasSignal = !(row.signal === null || row.signal === undefined);
        rows.push([id, opts.checked.has(id), lv.label, feed.name, row.addr || "", this.__kindText(row), name,
          hasSignal ? `${row.signal}% ${Classify.proximity(row.signal)}` : "", terms.map(t => t.text).join(" · "),
          this.__vendorText(row), seen.join(" · ")]);
        meta.set(id, {
          sensor: false, feed, item, lastAt: item.lastAt || 0, level: item.level, signal: hasSignal ? row.signal : -1,
          html: {
            level: this.chip(lv.label, lv.color, lv.tip),
            sensor: `${feed.watching && feed.ws ? '<span style="color:#1e8e3e">●</span> ' : ""}${esc(feed.name)}`,
            device: ((row.addrs || []).length > 1 ? `<span style="color:#1a73e8;font-weight:600">${row.addrs.length}×</span> ` : "") +
              `<span style="font-family:monospace;font-size:12px">${esc(row.addr || "")}</span>`,
            signal: this.bar(row.signal),
            evidence: terms.map(t => esc(t.text)).join(" · "),
            vendor: row.vendor ? `<b>${esc(row.vendor)}</b>` : `<span style="opacity:.6">${esc(this.__vendorText(row))}</span>`,
            seen: (item.isNew ? this.chip("yeni", "#1a73e8", "Bu sensörde son 24 saatte ilk kez görüldü ya da pencere açıldıktan sonra belirdi.") + " " : "") +
              esc(seen.filter(x => x !== "yeni").join(" · "))
          },
          hint: {
            // Durum ipucunda satırın Son görülme değeri (kullanıcı isteği 2026-11-10: bütün grid'lerde Durum ipucu = Son görülme).
            level: lv.tip + (seen.length ? `\nSon görülme: ${seen.join(" · ")}` : ""),
            sensor: feed.watching && feed.ws ? `${feed.name} — sürekli izleniyor` : feed.name,
            device: this.__deviceHint(row),
            kind: this.__kindHint(row),
            name: name || null,
            signal: hasSignal ? `Sinyal %${row.signal} — ${Classify.proximity(row.signal)} (kaba yakınlık ipucu)` +
              (typeof row.rssi === "number" ? `\n${row.rssi} dBm${row.rssi_est ? " (yüzdeden tahmini)" : ""}` : "") +
              (row.band && row.band !== "?" ? ` · ${row.band === "2.4" ? "2,4" : row.band} GHz` : "") : null,
            evidence: terms.length ? terms.map(t => t.tip === t.text ? t.text : `${t.text}: ${t.tip}`).join("\n") : null,
            vendor: row.vendor || (row.random ? "Rastgele (yerel yönetimli) adres: üretici kodu (OUI) taşımaz, üretici belirlenemez."
              : "Adresin üretici kodu (OUI) listede bulunamadı."),
            seen: row.first_seen ? "İlk görülme: " + new Date(row.first_seen * 1000).toLocaleString("tr-TR") : null
          }
        });
      });
      return { rows, meta };
    },

    /**
     * Sütunlara hücre çizicisi ve sıralama kuralı bağlar. Sıralama: Durum öne çıkma sırasıyla, Sinyal sayıyla, zaman
     * sütunları zamanla, Arayan/Bağlı sayıyla, ötekiler Türkçe metin sırasıyla.
     * @param table {qx.ui.table.Table} page.Base._createTable'ın tablosu (offset: kimlik [+ onay kutusu] sütunları)
     * @param columns {Array} COLUMNS ya da SENSOR_COLUMNS
     * @param getMeta {Function} (satır kimliği) → ek veri
     */
    attach(table, columns, getMeta) {
      const cm = table.getTableColumnModel();
      const model = table.getTableModel();
      const offset = table.getUserData("offset") || 1;
      const Classify = ankamon.ui.boards.WifimonClassify;
      columns.forEach((column, i) => {
        const index = i + offset;
        const metaOf = cellInfo => getMeta(cellInfo.rowData && cellInfo.rowData[0]) || null;
        cm.setDataCellRenderer(index, new ankamon.ui.boards.WifimonCellRenderer(
          cellInfo => {
            const m = metaOf(cellInfo);
            const html = m && m.html ? m.html[column.id] : undefined;
            return html === undefined ? null : html;
          },
          cellInfo => {
            const m = metaOf(cellInfo);
            const hint = m && m.hint ? m.hint[column.id] : undefined;
            if (hint !== undefined) {
              return hint;
            }
            const text = cellInfo.value === null || cellInfo.value === undefined ? "" : String(cellInfo.value);
            return text.length > 18 ? text : null; // kırpılabilecek uzun metnin tamamı
          }));
        const key = row => {
          const m = getMeta(row[0]) || {};
          if (column.id === "level") {
            return Classify.LEVEL_ORDER[m.level] ?? 9;
          }
          if (column.id === "signal") {
            return m.signal ?? -1;
          }
          if (column.id === "seen") {
            return m.lastAt || 0;
          }
          if (column.id === "probes" || column.id === "clients") {
            return row[index] === "" ? -1 : Number(row[index]);
          }
          return String(row[index] ?? "");
        };
        const compare = asc => (a, b) => {
          const ka = key(a);
          const kb = key(b);
          const r = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb), "tr", { numeric: true });
          return asc ? r : -r;
        };
        model.setSortMethods(index, { ascending: compare(true), descending: compare(false) });
      });
    }
  }
});
