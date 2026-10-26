/**
 * Görev yöneticisi sekmelerinin tabanı: tablo kurma (gizli kimlik sütunu + sütun sırası/gizleme tercihleri
 * kullanıcı başına sunucuda — bkz. page.Base.setupColumnLayout), saniyelik yenilemede seçimi ve kaydırmayı
 * koruyan satır yükleme, satır sağ menüsü. Alt sınıflar update(model) ile her çerçevede tazelenir.
 */
qx.Class.define("ankamon.ui.taskmgr.Tab", {
  extend: qx.ui.tabview.Page,
  type: "abstract",

  /**
   * @param win {ankamon.ui.taskmgr.Window} pencere (bağlantı, model, kullanıcı)
   * @param key {String} sekme kimliği (tercih anahtarı, varsayılan sekme)
   */
  construct(win, label, key) {
    super(label);
    this._win = win;
    this.setUserData("key", key);
    this.setLayout(new qx.ui.layout.VBox(6));
    this.setPadding([8, 4, 4, 4]);
  },

  members: {
    _win: null,

    /** Çerçeve geldi: görünen sekme kendini tazeler. */
    update(model) {
      throw new Error("abstract");
    },

    /**
     * @param columns {Array} [{id, label, width?, renderer?, hint?}] — kimlik sütunu (0) eklenir, gizlidir
     * @param key {String} tercih anahtarı ("taskmgr.<sekme>")
     * @param model {qx.ui.table.model.Simple?}
     */
    _table(columns, key, model = null) {
      model = model || new qx.ui.table.model.Simple();
      model.setColumns(["id"].concat(columns.map(c => c.label)), ["id"].concat(columns.map(c => c.id)));
      const table = new qx.ui.table.Table(model, {
        tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj)
      }).set({ statusBarVisible: false, columnVisibilityButtonVisible: true, rowHeight: 26, showCellFocusIndicator: false });
      const cm = table.getTableColumnModel();
      cm.setColumnVisible(0, false);
      const behavior = cm.getBehavior();
      columns.forEach((c, i) => {
        behavior.setWidth(i + 1, c.width || "1*");
        if (c.renderer) {
          cm.setDataCellRenderer(i + 1, c.renderer);
        }
      });
      // Varsayılan: TÜM sütunlar görünür (kullanıcı isteği). Kullanıcının gizlediği sütunlar ve sütun sırası
      // (başlık sürükleme) kullanıcı başına sunucuda saklanır, pencere her açıldığında uygulanır
      // (users.ui_prefs["taskmgr.<sekme>.columns.hidden/.order"], bkz. page.Base.setupColumnLayout).
      ankamon.page.Base.setupColumnLayout(table, columns, 1, `${key}.columns`, this._win.getUser());
      return table;
    },

    /** Satırları yükler; seçili satır(lar) kimlikle, kaydırma konumuyla korunur. */
    _setRows(table, rows) {
      const tm = table.getTableModel();
      const sel = table.getSelectionModel();
      const ids = [];
      sel.iterateSelection(r => ids.push(tm.getValue(0, r)));
      const scroller = table.getPaneScroller(0);
      const top = scroller.getScrollY();
      tm.setData(rows, false);
      if (ids.length) {
        sel.setBatchMode(true);
        sel.resetSelection();
        rows.forEach((row, i) => {
          if (ids.includes(row[0])) {
            sel.addSelectionInterval(i, i);
          }
        });
        sel.setBatchMode(false);
      }
      scroller.setScrollY(top);
    },

    /** Seçili ilk satırın kimliği (yoksa null). */
    _selectedId(table) {
      let id = null;
      table.getSelectionModel().iterateSelection(r => {
        if (id === null) {
          id = table.getTableModel().getValue(0, r);
        }
      });
      return id;
    },

    /** Satıra sağ tıklayınca `build(id)` menüsü (null → menü yok); tıklanan satır seçilir. */
    _rowMenu(table, build) {
      table.addListener("cellContextmenu", e => {
        const row = e.getRow();
        const id = row === null || row === undefined ? null : table.getTableModel().getValue(0, row);
        if (id !== null && !table.getSelectionModel().isSelectedIndex(row)) {
          table.getSelectionModel().setSelectionInterval(row, row);
        }
        const old = table.getContextMenu();
        table.setContextMenu(id === null ? null : build(id));
        if (old && old !== table.getContextMenu()) {
          old.dispose();
        }
      });
    },

    _button(label, handler) {
      const b = new qx.ui.form.Button(label).set({ padding: [3, 10] });
      b.addListener("execute", handler, this);
      return b;
    },

    _item(menu, label, handler, enabled = true) {
      const b = new qx.ui.menu.Button(label).set({ enabled });
      b.addListener("execute", handler, this);
      menu.add(b);
      return b;
    }
  }
});
