/**
 * Hücreye fareyle gelince tarayıcının kendi ipucunu (title) gösteren hücre çizici — ör. Bakım ▸ Ahenk'te
 * "Pulsar testi atlandı" ya da sonuç/durum açıklaması. İpucu metni satırdan üretilir (hint(cellInfo));
 * boşsa ipucu yoktur. dot(cellInfo) bir renk dönerse metnin soluna küçük renkli yuvarlak konur
 * (bkz. StatusRenderer'daki aynı görünüm).
 */
qx.Class.define("tihamon.ui.table.HintRenderer", {
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
      const color = this.__dot ? this.__dot(cellInfo) : null;
      return color
        ? `<span style="color:${color};font-size:10px;vertical-align:middle;margin-right:5px">&#9679;</span>${text}`
        : text;
    }
  }
});
