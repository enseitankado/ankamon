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
 * Cihazlar grid'inin "Wi-Fi" sütunu için hücre çizici (kullanıcı isteği 2026-11-24): kablosuz erişim noktası olarak ayarlanmış
 * cihazın değeri ("Erişim noktası (ağ adı)" — bkz. ui.FactsView.wifiStatus) YEŞİL ve kalın yazılır, ipucunda "Bu cihaz
 * kablosuz erişim noktası olarak ayarlanmış." (sütunun genel açıklaması ipucunda onun altında kalır — Base.setCellHints).
 * Erişim noktası Wi-Fi eklentisinin «Kablosuz erişim noktası» işlemiyle kurulur; ayar cihazda kalıcıdır.
 */
qx.Class.define("ankamon.ui.table.WifiRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  statics: {
    PREFIX: "Erişim noktası",
    HINT: "Bu cihaz kablosuz erişim noktası olarak ayarlanmış.",

    isAp(value) {
      return typeof value === "string" && value.startsWith(ankamon.ui.table.WifiRenderer.PREFIX);
    },

    /** Temadaki "tamam" (yeşil) rengi; tanımlı değilse sabit yeşil. */
    __okColor() {
      const mgr = qx.theme.manager.Color.getInstance();
      return mgr.isDynamic("app-ok") ? mgr.resolve("app-ok") : "#1e8e3e";
    }
  },

  members: {
    // overridden
    _getCellAttributes(cellInfo) {
      const W = ankamon.ui.table.WifiRenderer;
      return W.isAp(cellInfo.value) ? `title="${qx.bom.String.escape(W.HINT)}"` : "";
    },

    // overridden
    _getContentHtml(cellInfo) {
      const W = ankamon.ui.table.WifiRenderer;
      const text = qx.bom.String.escape(this._formatValue(cellInfo));
      return W.isAp(cellInfo.value) ? `<span style="color:${W.__okColor()};font-weight:bold">${text}</span>` : text;
    }
  }
});
