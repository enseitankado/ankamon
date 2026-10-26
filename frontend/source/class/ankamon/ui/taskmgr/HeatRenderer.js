/**
 * Windows Görev Yöneticisi'nin "ısı" hücreleri: sayısal değer, yoğunluğu arttıkça açık sarıdan turuncuya
 * koyulaşan bir zeminle, sağa yaslı çizilir. Zemin yarı saydam turuncudur — açık ve koyu temalarda okunur.
 * @param format {Function} değer → metin
 * @param max {Function|Number} doluluk ölçeği (değer / max → 0..1)
 */
qx.Class.define("ankamon.ui.taskmgr.HeatRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  construct(format, max) {
    super();
    this.__format = format;
    this.__max = max;
    this.setDefaultCellStyle("text-align:right");
  },

  members: {
    __format: null,
    __max: null,

    // overridden
    _getContentHtml(cellInfo) {
      const v = cellInfo.value;
      return v === null || v === undefined || v === "" ? "" : qx.bom.String.escape(this.__format(v, cellInfo.rowData));
    },

    // overridden
    _getCellStyle(cellInfo) {
      let style = super._getCellStyle(cellInfo);
      const v = Number(cellInfo.value);
      if (!(v > 0)) {
        return style;
      }
      const max = typeof this.__max === "function" ? this.__max() : this.__max;
      const f = Math.max(0, Math.min(1, v / (max || 1)));
      // Windows: hafif sarı (#fff4c4) → turuncu (#ffa040); en az %8 görünür zemin.
      const alpha = (0.12 + 0.6 * f).toFixed(2);
      const hue = Math.round(48 - 22 * f);
      style += `;background-color:hsla(${hue},100%,58%,${alpha})`;
      return style;
    }
  }
});
