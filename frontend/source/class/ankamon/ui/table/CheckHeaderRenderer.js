/**
 * Onay kutusu sütununun (bkz. page.Base _createTable {checkable}) başlığı: üç durumlu bir onay kutusu
 * (kullanıcı isteği: tüm işaret sütunlu grid'lerde). Tıklanınca grid'de o an GÖSTERİLEN (süzülmüş)
 * işaretlenebilir satırların hepsi işaretlenir ya da işaretleri kaldırılır; kutu da işaretlerin durumunu
 * yansıtır — hepsi ✓, hiçbiri boş, bir kısmı belirsiz (−).
 *
 * Başlık hücresi qx'in Header önbelleğiyle tembel oluşturulur (bkz. FilterHeaderRenderer); oluşan kutular
 * burada tutulur, sync() hepsini günceller.
 */
qx.Class.define("ankamon.ui.table.CheckHeaderRenderer", {
  extend: qx.ui.table.headerrenderer.Default,

  /** @param onToggle {Function} (checked) — kullanıcı kutuya tıklayınca, yeni değerle */
  construct(onToggle) {
    super();
    this.__onToggle = onToggle;
    this.__boxes = [];
    this.__state = false;
  },

  members: {
    __onToggle: null,
    __boxes: null,
    __state: null,
    __syncing: false,

    // overridden
    createHeaderCell(cellInfo) {
      const widget = new qx.ui.table.headerrenderer.HeaderCell();
      this.updateHeaderCell(cellInfo, widget);
      const box = new qx.ui.form.CheckBox().set({ triState: true, value: this.__state, alignX: "center", alignY: "middle" });
      box.setToolTipText("Gösterilen satırların tümünü işaretle / işaretleri kaldır");
      // Başlığın tap/pointerdown'u sıralama ve sütun taşımayı başlatır (bkz. FilterHeaderCell).
      ["tap", "pointerdown", "dbltap"].forEach(type => box.addListener(type, e => e.stopPropagation()));
      box.addListener("changeValue", e => {
        if (!this.__syncing) {
          // Belirsizden (−) tıklama: qx null → true yapar; yani "hepsini işaretle".
          this.__onToggle(e.getData() !== false);
        }
      });
      widget._add(box, { row: 0, column: 0, colSpan: 3 });
      this.__boxes.push(box);
      return widget;
    },

    /**
     * @param checked {Integer} işaretli satır sayısı
     * @param total {Integer} işaretlenebilir (gösterilen) satır sayısı
     */
    sync(checked, total) {
      this.__state = total > 0 && checked === total ? true : checked > 0 ? null : false;
      this.__syncing = true;
      try {
        this.__boxes.forEach(box => {
          box.setValue(this.__state);
          box.setEnabled(total > 0);
        });
      } finally {
        this.__syncing = false;
      }
    }
  },

  destruct() {
    this.__boxes = null;
  }
});
