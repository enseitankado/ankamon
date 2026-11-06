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
 * Wi-Fi Monitör grid'inin modeli (bkz. ui.boards.WifiMonitor): TEK grid — önce sensör satırları (seçili tahtalar: tarama/izleme
 * durumu, kart, sayılar; kullanıcı isteği 2026-11-06: eski üst şerit grid'e katıldı), sonra bulgular. Hücre değerleri düz metindir
 * (sütun süzgeçleri ve sıralama onu kullanır); renkli/zengin görünüm ve ipuçları satır kimliğine bağlı ek veriden
 * (ui.boards.WifimonCellRenderer). Sıralamada sensör satırları her zaman üstte kalır.
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

    /** Grid sütunları (sırası kullanıcıca değiştirilebilir — "wifimon.columns" tercihi). */
    COLUMNS: [
      { id: "level", label: "Durum", width: 120, hint: "Bulgunun öne çıkma düzeyi; sensör satırında tarama/izleme durumu" },
      { id: "sensor", label: "Sensör", width: 150, hint: "Vericiyi duyan Ankamon tahtası (Wi-Fi kartıyla dinleyen)" },
      { id: "device", label: "Tespit edilen cihaz", width: 150, hint: "Duyulan vericinin MAC adresi" },
      { id: "kind", label: "Tür", width: 170 },
      { id: "name", label: "Ad", width: 170, hint: "Ağ adı (SSID); bağlı cihazda bağlı olduğu ağ" },
      { id: "signal", label: "Sinyal", width: 150, choices: false },
      { id: "evidence", label: "Kanıt", width: 300 },
      { id: "vendor", label: "Üretici", width: 140, hint: "MAC adresinin üretici kodundan (OUI) bulunan üretici" },
      { id: "seen", label: "Son görülme", width: 130, choices: false }
    ],

    /** Sütun kimliğinden tablo sütun numarası (kimlik sütunu 0). */
    col(id) {
      return this.COLUMNS.findIndex(c => c.id === id) + 1;
    },

    chip(text, color, tip) {
      return `<span title="${qx.bom.String.escape(tip || "")}" style="display:inline-block;padding:0 7px;border-radius:9px;font-size:12px;` +
        `line-height:18px;font-weight:600;color:${color};border:1px solid ${color}66;white-space:nowrap">${qx.bom.String.escape(text)}</span>`;
    },

    bar(signal) {
      if (signal === null || signal === undefined || signal === "") {
        return "";
      }
      const color = signal >= 60 ? "#2fa84a" : signal >= 35 ? "#e8a200" : "#d93025";
      return `<span style="display:inline-block;width:50px;height:8px;background:rgba(127,127,127,.25);border-radius:4px;vertical-align:middle">` +
        `<span style="display:block;width:${signal}%;height:100%;background:${color};border-radius:4px"></span></span> ` +
        `${signal}% <span style="opacity:.7">${ankamon.ui.boards.WifimonClassify.proximity(signal)}</span>`;
    },

    __ago(ms, now) {
      const s = Math.max(0, Math.round((now - ms) / 1000));
      return s < 60 ? s + " sn önce" : s < 3600 ? Math.round(s / 60) + " dk önce" : Math.round(s / 3600) + " sa önce";
    },

    /**
     * Kanıt terimleri [{text, tip}]: kısa terim hücrede, açıklaması hücre ipucunda. "x sensörde": aynı MAC adresini duyan
     * sensörler (ağ adına göre değil — kullanıcı isteği); ipucunda adres ve duyan sensörler.
     */
    __evidence(item) {
      const row = item.row;
      const terms = [];
      const add = (text, tip) => terms.push({ text, tip: tip || text });
      if (item.fixed) {
        add("güvenilir", "Güvenilir listesinde: MAC " + item.fixed.value + (item.fixed.board_id ? " (bu sınıf)" : " (okul geneli)"));
      }
      if (row.kind === "probe") {
        add("ağ arıyor", "Bağlanacak ağ araştırıyor (Wi-Fi yoklaması).");
      } else if (row.kind === "client") {
        add("ağa bağlı", "Bir erişim noktasına bağlı ve veri gönderiyor (içerik şifreli; yalnız adresler görülür). " +
          `Ağ: ${row.name || "(adı bilinmiyor)"} · erişim noktası ${row.bssid || "?"}` + (row.chan ? ` · kanal ${row.chan}` : ""));
      }
      (row.hints || []).forEach(h => {
        if (/paylaşım noktasına benziyor/.test(h)) {
          add("hotspot adı", h);
          return;
        }
        const m = /^(.*?)\s*\((.+)\)$/.exec(h); // "rastgele adres (telefon/tablet olağan)" → "rastgele adres" + açıklama
        add(m ? m[1] : h, h);
      });
      if ((row.kind === "probe" || row.kind === "client") && row.count) {
        add(`${row.count} ${row.kind === "probe" ? "yoklama" : "çerçeve"}`,
          row.kind === "probe" ? "Dinleme süresince duyulan yoklama sayısı." : "Dinleme süresince bu cihazdan duyulan veri çerçevesi sayısı.");
      }
      const heard = item.heard || [];
      if (heard.length >= 2) {
        add(`${heard.length} sensörde`, `Bu MAC adresini (${row.addr}) ${heard.length} sensör duyuyor:\n` +
          heard.map(h => `${h.name} — ${h.signal === null || h.signal === undefined ? "?" : h.signal + "%"}`).join("\n"));
      }
      return terms;
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
        return "";
      }
      if (row.kind === "client") {
        return (row.board_name ? row.board_name + " " : "") + "→ " + (row.name || "(ağ adı bilinmiyor)");
      }
      return row.name || "(gizli ağ)";
    },

    /**
     * Sensör satırı. feed: WifiMonitor'deki sensör durumu {board, name, watching, phase, error, statusText, notes, data,
     * probeInfo, sniffing, forced, at}; view: Classify.board().
     */
    __sensorRow(feed, view, now) {
      const L = this.LEVELS;
      const c = view.counts;
      let state;
      let stateHtml;
      const spinner = ankamon.ui.JobSpinner.html();
      if (feed.error) {
        state = feed.statusText || "Hata";
        stateHtml = `<span style="color:#d93025">${qx.bom.String.escape(state)}</span>`;
      } else if (feed.watching && feed.ws) {
        state = "İzleniyor";
        stateHtml = `${spinner} <span style="color:#1e8e3e">İzleniyor</span>`;
      } else if (feed.ws) {
        state = feed.statusText || "Taranıyor…";
        stateHtml = `${spinner} ${qx.bom.String.escape(state)}`;
      } else {
        state = feed.statusText || "Bitti";
        stateHtml = `<span style="opacity:.75">${qx.bom.String.escape(state)}</span>`;
      }
      const d = feed.data;
      let card = d ? (d.device ? d.device + " · " + (d.connection ? "bağlı: " + d.connection : "bağlı değil") : "Wi-Fi kartı yok") : "";
      if (feed.sniffing) {
        card += " · monitör kipi";
      }
      if (feed.forced) {
        card += " · Wi-Fi bağlantısı kesildi (onaylı)";
      }
      const parts = [];
      const counted = [["phone", c.phone], ["maybe", c.maybe], ["foreign", c.foreign], ["common", c.common], ["fixed", c.fixed]];
      counted.forEach(([lv, n]) => n && parts.push({ text: `${L[lv].label} ${n}`, color: L[lv].color, tip: L[lv].tip }));
      const pi = feed.probeInfo;
      if (pi && !pi.note) {
        parts.push({ text: `Arayan ≈${pi.devices}`, color: "#1a73e8", tip: `Son ${pi.secs || "?"} sn dinlemede ağ arayan cihaz kestirimi.` });
        parts.push({ text: `Bağlı ${pi.clients || 0}`, color: "#1a73e8", tip: `Son ${pi.secs || "?"} sn dinlemede bir ağa bağlı ve veri gönderen cihaz sayısı.` });
      }
      const notes = (feed.notes || []).filter(Boolean);
      return {
        cells: [`s|${feed.board.id}`, state, feed.name, "", "Sensör", card, "", parts.map(p => p.text).join(" · "), "",
          feed.at ? new Date(feed.at).toLocaleTimeString("tr-TR") : ""],
        meta: {
          sensor: true, feed, lastAt: feed.at || 0,
          html: {
            level: stateHtml,
            sensor: `${feed.watching && feed.ws ? '<span style="color:#1e8e3e" title="Sürekli izleniyor">●</span> ' : ""}${qx.bom.String.escape(feed.name)}`,
            evidence: parts.map(p => this.chip(p.text, p.color, p.tip)).join(" ")
          },
          hint: {
            level: [feed.watching ? "Sürekli izleniyor (liste kendiliğinden tazelenir)." : "Tek tarama."].concat(notes).join("\n"),
            kind: "Bu satır sensörün durumu: Wi-Fi kartıyla çevreyi dinleyen Ankamon tahtası.",
            name: card,
            evidence: notes.join("\n") || null
          }
        }
      };
    },

    /**
     * Grid satırları ve satır kimliği → ek veri. entries: [{feed, view}].
     * @return {Map} {rows: Array, meta: Map}
     */
    model(entries, opts) {
      const esc = qx.bom.String.escape;
      const rows = [];
      const meta = new Map();
      const now = opts.now;
      entries.forEach(({ feed, view }) => {
        const s = this.__sensorRow(feed, view, now);
        rows.push(s.cells);
        meta.set(s.cells[0], s.meta);
      });
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
        rows.push([id, lv.label, feed.name, row.addr || "", this.__kindText(row), name,
          row.signal === null || row.signal === undefined ? "" : row.signal, terms.map(t => t.text).join(" · "),
          this.__vendorText(row), seen.join(" · ")]);
        meta.set(id, {
          sensor: false, feed, item, lastAt: item.lastAt || 0, level: item.level,
          html: {
            level: this.chip(lv.label, lv.color, lv.tip),
            sensor: `${feed.watching && feed.ws ? '<span style="color:#1e8e3e">●</span> ' : ""}${esc(feed.name)}`,
            device: `<span style="font-family:monospace;font-size:12px">${esc(row.addr || "")}</span>`,
            signal: this.bar(row.signal),
            evidence: terms.map(t => esc(t.text)).join(" · "),
            vendor: row.vendor ? `<b>${esc(row.vendor)}</b>` : `<span style="opacity:.6">${esc(this.__vendorText(row))}</span>`,
            seen: (item.isNew ? this.chip("yeni", "#1a73e8", "Bu sensörde son 24 saatte ilk kez görüldü ya da pencere açıldıktan sonra belirdi.") + " " : "") +
              esc(seen.filter(x => x !== "yeni").join(" · "))
          },
          hint: {
            level: lv.tip,
            sensor: feed.watching && feed.ws ? `${feed.name} — sürekli izleniyor` : feed.name,
            device: row.random ? "Rastgele (yerel yönetimli) adres" : null,
            kind: this.__kindHint(row),
            name: name || null,
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
     * Sütunlara hücre çizicisi ve sıralama kuralı bağlar. Sıralama: sensör satırları her zaman üstte; Durum öne çıkma
     * sırasıyla, Sinyal sayıyla, Son görülme zamanla, ötekiler Türkçe metin sırasıyla.
     * @param getMeta {Function} (satır kimliği) → ek veri
     */
    attach(table, getMeta) {
      const cm = table.getTableColumnModel();
      const model = table.getTableModel();
      const Classify = ankamon.ui.boards.WifimonClassify;
      const isSensor = ankamon.ui.boards.WifimonCellRenderer.isSensorRow;
      this.COLUMNS.forEach((column, i) => {
        const index = i + 1;
        const metaOf = cellInfo => getMeta(cellInfo.rowData && cellInfo.rowData[0]) || null;
        cm.setDataCellRenderer(index, new ankamon.ui.boards.WifimonCellRenderer(
          cellInfo => {
            const m = metaOf(cellInfo);
            return m && m.html && m.html[column.id] !== undefined ? m.html[column.id] : null;
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
            return m.sensor ? 0 : Classify.LEVEL_ORDER[m.level] ?? 9;
          }
          if (column.id === "signal") {
            return row[index] === "" ? -1 : Number(row[index]);
          }
          if (column.id === "seen") {
            return m.lastAt || 0;
          }
          return String(row[index] ?? "");
        };
        const compare = asc => (a, b) => {
          const sa = isSensor(a);
          const sb = isSensor(b);
          if (sa !== sb) {
            return sa ? -1 : 1; // sensör satırları yönden bağımsız üstte
          }
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
