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
