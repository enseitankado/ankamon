/**
 * qx.ui.table.headerrenderer.Default'u genişletir: her sütun için qx.ui.table.pane.Header'ın zaten
 * kurduğu önbellekleme mekanizmasıyla (bkz. createHeaderCell/updateHeaderCell) tihamon.ui.table.
 * FilterHeaderCell üretir — etiketi/sıra okunu olduğu gibi gösterir, ALTINA da bir süzgeç metin
 * kutusu ekler (bkz. FilterHeaderCell). Tek bir örnek birden çok sütuna atanabilir: her sütun
 * createHeaderCell ile KENDİ widget'ını (ve kendi metin kutusunu) alır — bkz. page.Base
 * _addColumnFilters.
 */
qx.Class.define("tihamon.ui.table.FilterHeaderRenderer", {
  extend: qx.ui.table.headerrenderer.Default,

  /**
   * @param onFieldCreated {Function} (col, field) -> void — bir sütunun süzgeç kutusu
   *   oluşturulur oluşturulmaz (tablo sütun indeksiyle, offset dahil) çağrılır.
   */
  construct(onFieldCreated) {
    super();
    this.__onFieldCreated = onFieldCreated;
  },

  members: {
    __onFieldCreated: null,

    // overridden
    createHeaderCell(cellInfo) {
      const widget = new tihamon.ui.table.FilterHeaderCell();
      this.updateHeaderCell(cellInfo, widget);
      if (this.__onFieldCreated) {
        this.__onFieldCreated(cellInfo.col, widget.getFilterField());
      }
      return widget;
    }
  }
});
