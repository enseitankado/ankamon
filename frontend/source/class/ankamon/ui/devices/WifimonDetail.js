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
 * Wi-Fi Monitör ▸ Tespitler satırına çift tıklama (kullanıcı isteği 2026-11-11): satırın hücre ipuçlarına sığmayan
 * bilgilerin hepsi rahat okunur bir pencerede — durum, tür (ve neden), cihaz (birleşen adresler + aynı cihaz sayma
 * ölçütleri), ad, sinyal (%, dBm, bant), kanıtlar, üretici, görülme; bu pencerede o cihazı duyan BÜTÜN sensörler ve
 * son 30 günün sensör × bant sinyal istatistiği ile kayıtlı konumu (GET /api/wifimon/locations — güvenilir vericiler).
 */
qx.Class.define("ankamon.ui.devices.WifimonDetail", {
  type: "static",

  statics: {
    /**
     * "Cihaz kimliği" bölümü: adres türü, birleşme özeti ve gerekçe rozetleri, WPS kimliği, IE parmak izi, aynı cihaz sayma
     * ölçütleri (✓ eşleşen yeşil, – eşleşmeyen soluk; başlık kalın + açıklama küçük) ve adresler (eş genişlikli ızgara).
     * plain: "Tümünü kopyala" metnine satır ekler.
     */
    __deviceSection(row, addrs, section, plain, esc) {
      const Classify = ankamon.ui.devices.WifimonClassify;
      const why = new Set(row.why || []);
      const probing = row.kind === "probe" || (row.also || []).includes("probe");
      const muted = s => `<span style="opacity:.65">${s}</span>`;
      const badge = (text, color) => `<span style="display:inline-block;margin:0 4px 3px 0;padding:0 8px;border-radius:9px;` +
        `font-size:12px;line-height:19px;color:${color};border:1px solid ${color}66;white-space:nowrap">${esc(text)}</span>`;
      const facts = [
        ["Adres türü", row.random ? "Rastgele (yerel yönetimli)" : "Kalıcı (üretici)",
          row.random ? `<b>Rastgele</b> (yerel yönetimli) ${muted("— üretici kodu taşımaz; telefonlar adresini değiştirir")}`
            : `<b>Kalıcı</b> (üretici adresi) ${muted("— cihaza özgü, değişmez")}`]
      ];
      if (addrs.length > 1) {
        facts.push(["Aynı cihaz sayılan", `${addrs.length} adres`, `<b>${addrs.length}</b> adres ${muted("(aşağıda)")}`]);
      } else if (row.random && probing) {
        facts.push(["Aynı cihaz sayılan", "yalnız bu adres", muted("Başka bir adresle aynı cihaz sayılmadı")]);
      }
      if (why.size) {
        const list = [...why].map(w => Classify.MERGE_REASON[w] || w);
        facts.push(["Birleşme gerekçesi", list.join(", "), list.map(t => badge(t, "#1e8e3e")).join("")]);
      }
      const w = row.wps || {};
      const wpsName = [w.maker, w.name, w.model, w.number].filter(Boolean).join(" · ");
      if (wpsName || w.uuid) {
        facts.push(["WPS kimliği", [wpsName, w.uuid].filter(Boolean).join(" — "),
          (wpsName ? `<b>${esc(wpsName)}</b>` : "") + (w.uuid ? `<div style="font-family:monospace;font-size:12px;opacity:.75">UUID-E ${esc(w.uuid)}</div>` : "")]);
      }
      if (Array.isArray(row.iefp) && row.iefp.some(Boolean)) {
        const names = ["HT", "VHT", "Hızlar", "Gen. yetenek", "Üretici"];
        const slots = row.iefp.map((v, i) => [names[i], v ? Number(v).toString(16).padStart(4, "0") : "—"]);
        if (row.ieord) {
          slots.push(["IE sırası", Number(row.ieord).toString(16).padStart(4, "0")]);
        }
        facts.push(["IE parmak izi", slots.map(([k, v]) => `${k} ${v}`).join(" · "),
          `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px">` + slots.map(([k, v]) =>
            `<span>${muted(esc(k))} <span style="font-family:monospace">${esc(v)}</span></span>`).join("") + "</div>"]);
      }
      let html = section("Cihaz kimliği", facts);

      if (row.random && probing || addrs.length > 1) {
        const rowsHtml = Classify.MERGE_CRITERIA.map(([code, text]) => {
          const hit = why.has(code);
          const cut = text.indexOf(": ");
          const title = cut > 0 ? text.slice(0, cut) : text;
          const desc = cut > 0 ? text.slice(cut + 2) : "";
          plain.push(`${hit ? "✓" : "–"} ${text}`);
          return `<tr style="${hit ? "" : "opacity:.6"}"><td style="padding:4px 10px 4px 0;vertical-align:top;font-weight:700;` +
            `color:${hit ? "#1e8e3e" : "inherit"}">${hit ? "✓" : "–"}</td><td style="padding:4px 0;vertical-align:top">` +
            `<b>${esc(title)}</b>${desc ? `<div style="font-size:12px;opacity:.75">${esc(desc)}</div>` : ""}</td></tr>`;
        }).join("");
        const note = "Aranan ağ listeleri çelişen adresler birleşmez; kalıcı (üretici) adresler birleştirilmez. Kestirimdir: aynı model " +
          "iki telefon yan yanaysa birleşebilir.";
        plain.push(note, "");
        html += `<h3 style="margin:12px 0 4px;font-size:13px">Aynı cihaz sayma ölçütleri ${muted("(✓ bu satırda eşleşen)")}</h3>` +
          `<table style="border-collapse:collapse;width:100%">${rowsHtml}</table>` +
          `<div style="font-size:12px;opacity:.65;margin-top:4px">${esc(note)}</div>`;
      }

      plain.push(`Adresler (${addrs.length}):`, ...addrs, "");
      html += `<h3 style="margin:12px 0 4px;font-size:13px">Adresler (${addrs.length})</h3>` +
        `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:3px 12px;font-family:monospace;font-size:12px">` +
        addrs.map(a => `<span${a === row.addr ? ' style="font-weight:700" title="Satırda gösterilen (en çok yoklayan) adres"' : ""}>` +
          `${esc(a)}</span>`).join("") + "</div>";
      return html;
    },

    /**
     * @param m {Map} Tespitler satırının meta kaydı (WifimonRender.model: {feed, item, row, hint, texts …})
     * @param all {Map} bütün satırların meta kayıtları (aynı cihazı duyan öbür sensörler için)
     */
    async open(m, all) {
      const esc = s => qx.bom.String.escape(String(s ?? ""));
      const pre = s => `<div style="white-space:pre-wrap">${esc(s)}</div>`;
      const row = m.row || m.item.row || {};
      const hint = m.hint || {};
      const texts = m.texts || {};
      const addrs = (row.addrs && row.addrs.length ? row.addrs : [row.addr]).filter(Boolean);
      const plain = [];
      const section = (title, rows) => {
        // [etiket, düz değer, HTML biçimi?]: ekranda HTML biçimi (varsa), "Tümünü kopyala"da düz değer. (Eskiden ikisi takastı:
        // HTML biçimi — pre-wrap satırlar, rozetler — hiç görünmüyordu.)
        const body = rows.filter(r => r && r[1] !== null && r[1] !== undefined && r[1] !== "").map(([k, v, raw]) => {
          plain.push(`${k}: ${String(v).replace(/<[^>]*>/g, "")}`);
          return `<tr><td style="padding:3px 14px 3px 0;vertical-align:top;white-space:nowrap;opacity:.75">${esc(k)}</td>` +
            `<td style="padding:3px 0;vertical-align:top">${raw === undefined ? esc(v) : raw}</td></tr>`;
        }).join("");
        plain.push("");
        return body ? `<h3 style="margin:12px 0 4px;font-size:13px">${esc(title)}</h3><table style="border-collapse:collapse;width:100%">${body}</table>` : "";
      };

      const sig = typeof row.signal === "number"
        ? `%${row.signal}` + (typeof row.rssi === "number" ? ` · ${row.rssi} dBm${row.rssi_est ? " (yüzdeden tahmini)" : ""}` : "") +
          (row.band && row.band !== "?" ? ` · ${row.band === "2.4" ? "2,4" : row.band} GHz` : "") + (row.channel ? ` · kanal ${row.channel}` : "")
        : "—";
      let html = section("Özet", [
        ["Durum", texts.level],
        ["Sensör", m.feed && m.feed.name],
        ["Adres", row.addr],
        ["Tür", texts.kind],
        ["Ad (SSID)", texts.name],
        ["Üretici", texts.vendor],
        ["Sinyal", sig],
        ["Görülme", texts.seen],
        ["İlk görülme", row.first_seen ? new Date(row.first_seen * 1000).toLocaleString("tr-TR") : null],
        ["Görüldüğü gün", row.seen_days ? `${row.seen_days} gün` : null]
      ]);
      html += section("Açıklamalar", [
        ["Durum", hint.level, pre(hint.level)],
        ["Tür", hint.kind, hint.kind ? pre(hint.kind) : undefined],
        ["Üretici", hint.vendor, hint.vendor ? pre(hint.vendor) : undefined]
      ]);
      // Cihaz kimliği (kullanıcı isteği 2026-11-13: eskiden hücre ipucunun düz metni tek blok halinde duruyordu).
      html += this.__deviceSection(row, addrs, section, plain, esc);
      const terms = texts.evidence || [];
      if (terms.length) {
        html += section("Kanıtlar", terms.map(t => [t.text, t.tip && t.tip !== t.text ? t.tip : "✓"]));
      }

      // Bu pencerede aynı cihazı duyan bütün sensörler (aynı satır anahtarı).
      const peers = [...(all ? all.values() : [])].filter(x => x && !x.sensor && x.item && x.item.key === m.item.key);
      if (peers.length > 1) {
        html += section(`Bu pencerede duyan sensörler (${peers.length})`, peers
          .sort((a, b) => (b.signal ?? -1) - (a.signal ?? -1))
          .map(x => [x.feed.name, (x.row && typeof x.row.signal === "number") ? `%${x.row.signal}` +
            (typeof x.row.rssi === "number" ? ` · ${x.row.rssi} dBm` : "") +
            (x.row.band && x.row.band !== "?" ? ` · ${x.row.band === "2.4" ? "2,4" : x.row.band} GHz` : "") : "—"]));
      }

      const win = ankamon.ui.Dialog.window(`Tespit ayrıntıları — ${row.addr || ""}`, 720, { maximizable: true });
      win.set({ height: 620, resizable: true, contentPadding: 10 });
      const view = new qx.ui.embed.Html(`<div style="font-size:13px;line-height:1.4">${html}<div id="wm-extra"></div></div>`)
        .set({ overflowY: "auto", selectable: true, nativeContextMenu: true });
      win.add(view, { flex: 1 });
      const copy = new qx.ui.form.Button("Tümünü kopyala");
      copy.addListener("execute", () => ankamon.util.Clipboard.copy(`Tespit ayrıntıları — ${row.addr}\n` + plain.join("\n")));
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [copy, close]);
      win.open();

      // Son 30 günün sensör × bant sinyal istatistiği ve kayıtlı konum (güvenilir vericiler; yetki yoksa atlanır).
      try {
        const res = await ankamon.io.Api.get("/wifimon/locations");
        if (win.isDisposed()) {
          return;
        }
        const set = new Set(addrs.map(a => a.toUpperCase()));
        const sensors = new Map((res.sensors || []).map(s => [s.id, s.label || s.hostname || s.ip || "#" + s.id]));
        const stats = (res.stats || []).filter(s => set.has(String(s.addr).toUpperCase()));
        const locs = (res.locations || []).filter(l => set.has(String(l.addr).toUpperCase()));
        let extra = "";
        if (locs.length) {
          extra += section("Kayıtlı konum", locs.map(l => [l.addr, `${l.sensor_name || sensors.get(l.device_id) || "#" + l.device_id}` +
            (l.sensor_mac ? ` (${l.sensor_mac})` : "") + (l.note ? ` — ${l.note}` : "")]));
        }
        if (stats.length) {
          extra += section(`Son ${res.days || 30} günde sensörlerde sinyal`, stats
            .sort((a, b) => (b.avg ?? -999) - (a.avg ?? -999))
            .map(s => [`${sensors.get(s.device_id) || "#" + s.device_id} · ${s.band === "2.4" ? "2,4" : s.band} GHz`,
              `ort. ${s.avg} dBm (σ ${s.sd}, ${s.min}…${s.max}) · ${s.n} ölçüm, ${s.days} gün` + (s.chan ? ` · kanal ${s.chan}` : "") +
              (s.n_est ? ` · ${s.n_est} tahmini` : "")]));
        }
        if (extra) {
          const el = view.getContentElement().getDomElement();
          const box = el && el.querySelector("#wm-extra");
          if (box) {
            box.innerHTML = extra;
          }
        }
      } catch (e) {
        // istatistik yoksa/yetki yoksa yalnız satır bilgileri
      }
    }
  }
});
