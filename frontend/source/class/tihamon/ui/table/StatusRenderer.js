/**
 * "Durum" sütunu için hücre çizici: çevrim içi cihazın metninin SOLUNA küçük yeşil, çevrim dışı
 * cihazın soluna soluk gri bir yuvarlak koyar. Alt satırlar (port/paylaşım — "açık"/"paylaşım")
 * yuvarlak almaz, metni olduğu gibi gösterilir. Değere göre karar verir (page.Network hücre metni).
 */
qx.Class.define("tihamon.ui.table.StatusRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  members: {
    // overridden
    _getContentHtml(cellInfo) {
      const value = cellInfo.value;
      const text = qx.bom.String.escape(this._formatValue(cellInfo));
      let color = null;
      if (value === "Çevrim içi") {
        color = "#2fa84a";
      } else if (value === "Çevrim dışı") {
        color = "#9aa0a6";
      }
      if (!color) {
        return text;
      }
      return `<span style="color:${color};font-size:10px;vertical-align:middle;margin-right:5px">&#9679;</span>${text}`;
    }
  }
});
