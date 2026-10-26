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
