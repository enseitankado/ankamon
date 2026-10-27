/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Hücreye fareyle gelince tarayıcının kendi ipucunu (title) gösteren hücre çizici — ör. Bakım ▸ Ahenk'te
 * "Pulsar testi atlandı" ya da sonuç/durum açıklaması. İpucu metni satırdan üretilir (hint(cellInfo));
 * boşsa ipucu yoktur. dot(cellInfo) bir renk dönerse metin o renkte çizilir ve soluna aynı renkte
 * küçük bir yuvarlak konur (bkz. StatusRenderer'daki aynı görünüm).
 */
qx.Class.define("ankamon.ui.table.HintRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  /**
   * @param hint {Function} (cellInfo) → String|null
   * @param dot {Function?} (cellInfo) → renk|null
   */
  construct(hint, dot) {
    super();
    this.__hint = hint;
    this.__dot = dot || null;
  },

  members: {
    __hint: null,
    __dot: null,

    // overridden
    _getCellAttributes(cellInfo) {
      const hint = this.__hint ? this.__hint(cellInfo) : null;
      return hint ? `title="${qx.bom.String.escape(hint).replace(/"/g, "&quot;")}"` : "";
    },

    // overridden
    _getContentHtml(cellInfo) {
      const text = qx.bom.String.escape(this._formatValue(cellInfo));
      return ankamon.ui.table.StatusRenderer.html(text, this.__dot ? this.__dot(cellInfo) : null);
    }
  }
});
