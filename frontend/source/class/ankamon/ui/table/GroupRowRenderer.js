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
 * Alt satırlı grid'lerde (bkz. ui.table.GroupModel, page.Network) alt satırları ayırt eden satır
 * çizici: seçili olmayan alt satır, temanın seçim rengiyle satır zemininin hafif bir karışımı
 * (color-mix) zeminle, biraz sönük yazıyla ve solda seçim renginde ince bir şeritle çizilir. Renkler
 * o anki temadan türetildiği için her temada (açık/koyu) uyumludur; tema değişince Default'un
 * initThemeValues'u renkleri yeniler.
 */
qx.Class.define("ankamon.ui.table.GroupRowRenderer", {
  extend: qx.ui.table.rowrenderer.Default,

  /** @param isChild {Function} (rowData) → alt satır mı */
  construct(isChild) {
    super();
    this.__isChild = isChild;
  },

  members: {
    __isChild: null,

    __childStyle() {
      const c = this._colors;
      // Vurgu rengi temanın "primary"si (ankamon.theme.Color* hepsinde opak); bazı temaların
      // seçim zemini neredeyse saydam olduğundan (ör. rgba(…,0.05)) ondan türetilemez.
      // Tanımsız adı resolve() olduğu gibi ("primary") döndürür → geçersiz CSS; önce isDynamic.
      const mgr = qx.theme.manager.Color.getInstance();
      const accent = mgr.isDynamic("primary") ? mgr.resolve("primary") : c.colSelected;
      return {
        background: `color-mix(in srgb, ${accent} 14%, ${c.bgcolEven})`,
        color: `color-mix(in srgb, ${c.colNormal} 80%, ${accent})`,
        accent: `inset 4px 0 0 ${accent}`
      };
    },

    __styled(rowInfo) {
      return !rowInfo.selected && rowInfo.rowData && this.__isChild(rowInfo.rowData);
    },

    // overridden: ilk çizim
    createRowStyle(rowInfo) {
      const style = super.createRowStyle(rowInfo);
      if (!this.__styled(rowInfo)) {
        return style;
      }
      const s = this.__childStyle();
      return `${style};background-color:${s.background};color:${s.color};box-shadow:${s.accent}`;
    },

    // overridden: seçim/odak değişince yerinde güncelleme
    updateDataRowElement(rowInfo, rowElem) {
      super.updateDataRowElement(rowInfo, rowElem);
      if (this.__styled(rowInfo)) {
        const s = this.__childStyle();
        rowElem.style.backgroundColor = s.background;
        rowElem.style.color = s.color;
        rowElem.style.boxShadow = s.accent;
      } else {
        rowElem.style.boxShadow = "";
      }
    }
  }
});
