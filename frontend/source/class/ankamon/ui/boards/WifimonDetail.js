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
qx.Class.define("ankamon.ui.boards.WifimonDetail", {
  type: "static",

  statics: {
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
        const body = rows.filter(r => r && r[1] !== null && r[1] !== undefined && r[1] !== "").map(([k, v, raw]) => {
          plain.push(`${k}: ${String(raw ?? v).replace(/<[^>]*>/g, "")}`);
          return `<tr><td style="padding:3px 14px 3px 0;vertical-align:top;white-space:nowrap;opacity:.75">${esc(k)}</td>` +
            `<td style="padding:3px 0;vertical-align:top">${raw === undefined ? esc(v) : v}</td></tr>`;
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
        ["Cihaz", hint.device, hint.device ? pre(hint.device) : undefined],
        ["Üretici", hint.vendor, hint.vendor ? pre(hint.vendor) : undefined]
      ]);
      const terms = texts.evidence || [];
      if (terms.length) {
        html += section("Kanıtlar", terms.map(t => [t.text, t.tip && t.tip !== t.text ? t.tip : "✓"]));
      }
      html += section(`Adresler (${addrs.length})`, addrs.map((a, i) => [String(i + 1), a,
        `<span style="font-family:monospace">${esc(a)}</span>`]));

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
          extra += section("Kayıtlı konum", locs.map(l => [l.addr, `${l.sensor_name || sensors.get(l.board_id) || "#" + l.board_id}` +
            (l.sensor_mac ? ` (${l.sensor_mac})` : "") + (l.note ? ` — ${l.note}` : "")]));
        }
        if (stats.length) {
          extra += section(`Son ${res.days || 30} günde sensörlerde sinyal`, stats
            .sort((a, b) => (b.avg ?? -999) - (a.avg ?? -999))
            .map(s => [`${sensors.get(s.board_id) || "#" + s.board_id} · ${s.band === "2.4" ? "2,4" : s.band} GHz`,
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
