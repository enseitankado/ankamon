/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** Sistem sayfası sekmelerinin bilgi kutuları için küçük, kaçırmalı HTML tablo yardımcıları. */
qx.Class.define("ankamon.ui.system.Html", {
  type: "static",

  statics: {
    /**
     * Başlıklı anahtar/değer tablosu. value düz metin (kaçırılır) ya da {html} olabilir; boş satırlar atlanır.
     * @param sections {Array} [{title, rows: [[label, value], …]}]
     */
    keyValue(sections) {
      const esc = qx.bom.String.escape;
      const cell = v => (v && typeof v === "object" ? v.html : esc(String(v)));
      return "<table style='border-collapse:collapse'>" + sections.map(s =>
        `<tr><td colspan="2" style="padding:8px 0 2px;font-weight:bold;border-bottom:1px solid #ccc">${esc(s.title)}</td></tr>` +
        s.rows.filter(r => r[1] !== null && r[1] !== undefined && r[1] !== "").map(([k, v]) =>
          `<tr><td style="padding:2px 16px 2px 0;opacity:.75;white-space:nowrap;vertical-align:top">${esc(k)}</td>` +
          `<td style="padding:2px 0">${cell(v)}</td></tr>`).join("")
      ).join("") + "</table>";
    },

    /** Renkli durum rozeti: ok=yeşil, warn=turuncu, bad=kırmızı, idle=gri. */
    badge(text, kind) {
      const color = { ok: "#1e8e3e", warn: "#e37400", bad: "#c5221f", idle: "#80868b" }[kind] || "#80868b";
      return `<span style="color:${color};font-weight:bold">●</span> ${qx.bom.String.escape(text)}`;
    },

    /** Kaydırılabilir rich etiket kutusu. */
    box() {
      const label = new qx.ui.basic.Label("").set({ rich: true, selectable: true, allowGrowX: true });
      const scroll = new qx.ui.container.Scroll(label);
      return { label, scroll };
    }
  }
});
