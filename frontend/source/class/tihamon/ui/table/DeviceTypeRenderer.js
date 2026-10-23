/**
 * "Cihaz türü" sütunu için hücre çizici: türün metninin SOLUNA türe özgü minik bir ikon (emoji) koyar.
 * Türler ui.network.Ops.TYPES ve worker netscan/classify.py ile aynı adlardır; bilinmeyen/boş tür
 * (ör. alt satırlar, serbest metin) ikon almaz, metin olduğu gibi gösterilir. Değere göre karar verir.
 */
qx.Class.define("tihamon.ui.table.DeviceTypeRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  statics: {
    ICON: {
      "Bilgisayar": "💻",
      "Sunucu": "🖥️",
      "Akıllı tahta": "🏫",
      "Yazıcı": "🖨️",
      "IP kamera": "📷",
      "Ağ cihazı": "🌐",
      "Ağ geçidi / yönlendirici": "📶",
      "Kablosuz erişim noktası": "📡",
      "Telefon / tablet": "📱",
      "Apple cihazı": "🍎",
      "TV / medya": "📺",
      "Depolama (NAS)": "🗄️",
      "IoT cihazı": "💡",
      "Raspberry Pi": "🍓",
      "IP telefon": "☎️",
      "Sanal makine": "📦",
      "Tiha-Mon sunucusu": "⭐"
    }
  },

  members: {
    // overridden
    _getContentHtml(cellInfo) {
      const text = qx.bom.String.escape(this._formatValue(cellInfo));
      const icon = tihamon.ui.table.DeviceTypeRenderer.ICON[cellInfo.value];
      if (!icon) {
        return text;
      }
      return `<span style="margin-right:5px">${icon}</span>${text}`;
    }
  }
});
