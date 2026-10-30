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
 * Tahtalar grid'inin "Oturum" sütunu için hücre çizici: oturum ekranı kilitliyse metinde geçen
 * "(kilitli)" ifadesi KIRMIZI ve KALIN gösterilir (kullanıcı isteği), geri kalan (kullanıcı adı)
 * olduğu gibi kalır. Kilit yoksa metin düz gösterilir (bkz. Boards.sessionText, StatusRenderer deseni).
 */
qx.Class.define("ankamon.ui.table.SessionRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  statics: {
    MARK: "(kilitli)",

    /** Temadaki hata (kırmızı) rengi; koyu temalarda da okunur. */
    __errorColor() {
      const mgr = qx.theme.manager.Color.getInstance();
      const name = ["app-error", "error", "invalid"].find(n => mgr.isDynamic(n));
      return name ? mgr.resolve(name) : "#d93025";
    }
  },

  members: {
    // overridden
    _getContentHtml(cellInfo) {
      const S = ankamon.ui.table.SessionRenderer;
      const esc = qx.bom.String.escape;
      const value = cellInfo.value == null ? "" : String(cellInfo.value);
      const i = value.indexOf(S.MARK);
      if (i < 0) {
        return esc(value);
      }
      return esc(value.slice(0, i))
        + `<span style="color:${S.__errorColor()};font-weight:bold">${esc(S.MARK)}</span>`
        + esc(value.slice(i + S.MARK.length));
    }
  }
});
