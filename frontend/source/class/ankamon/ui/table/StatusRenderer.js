/**
 * "Durum" sütunu için hücre çizici: çevrim içi metni (ve soluna konan küçük yuvarlak) yeşil, çevrim
 * dışı metni kırmızı çizilir — renkler etkin temadan (app-ok / app-error; koyu temalarda da okunur).
 * Alt satırlar (port/paylaşım — "açık"/"paylaşım") renk almaz, metni olduğu gibi gösterilir. Değere
 * göre karar verir: Ağ "Çevrim içi"/"Çevrim dışı", Tahtalar "Çevrimiçi"/"Kapalı".
 */
qx.Class.define("ankamon.ui.table.StatusRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  statics: {
    ONLINE: ["Çevrim içi", "Çevrimiçi"],
    OFFLINE: ["Çevrim dışı", "Kapalı"],

    /** Temadaki ilk tanımlı rengi döner (temalar hata rengini farklı adlarla tanımlar). */
    __themeColor(names, fallback) {
      const mgr = qx.theme.manager.Color.getInstance();
      const name = names.find(n => mgr.isDynamic(n));
      return name ? mgr.resolve(name) : fallback;
    },

    /** Durum metninin rengi: çevrim içi yeşil, çevrim dışı kırmızı, diğerleri null. */
    colorOf(value) {
      const S = ankamon.ui.table.StatusRenderer;
      if (S.ONLINE.includes(value)) {
        return S.__themeColor(["app-ok"], "#2fa84a");
      }
      if (S.OFFLINE.includes(value)) {
        return S.__themeColor(["app-error", "error", "invalid"], "#d93025");
      }
      return null;
    },

    /** Renkli yuvarlak + renkli metin (color null ise yalnız metin). */
    html(text, color) {
      return color
        ? `<span style="color:${color}"><span style="font-size:10px;vertical-align:middle;margin-right:5px">&#9679;</span>${text}</span>`
        : text;
    }
  },

  members: {
    // overridden
    _getContentHtml(cellInfo) {
      const S = ankamon.ui.table.StatusRenderer;
      return S.html(qx.bom.String.escape(this._formatValue(cellInfo)), S.colorOf(cellInfo.value));
    }
  }
});
