/**
 * Hücre değerini verilen işlevle biçimlendirerek gösterir; sıralama ham değere göre kalır (ör. boyut
 * bayt cinsinden sayı olarak sıralanır, "1.2 MB" metni olarak değil).
 */
qx.Class.define("ankamon.ui.files.FormatRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  /** @param format {Function} (value, rowData) -> String */
  construct(format) {
    super();
    this.__format = format;
  },

  members: {
    __format: null,

    // overridden
    _formatValue(cellInfo) {
      // Kaçış (HTML escape) üst sınıfın _getContentHtml'inde yapılır.
      return this.__format(cellInfo.value, cellInfo.rowData) || "";
    }
  }
});
