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
 * Görev yöneticisi sekmelerinin tabanı: tablo kurma (gizli kimlik sütunu + sütun sırası/gizleme tercihleri
 * kullanıcı başına sunucuda — bkz. page.Base.setupColumnLayout), saniyelik yenilemede seçimi ve kaydırmayı
 * koruyan satır yükleme, satır sağ menüsü. Alt sınıflar update() ile tazelenir; verilerini pencerenin
 * "Bilgisayar" süzgecine uyan tahta bağlarından (win.getVisibleLinks(), her birinin getModel()'i) alır.
 *
 * Çok tahta: tablonun SONUNA "Bilgisayar" sütunu eklenir (satırın son hücresi = link.getDisplay()); satır
 * kimlikleri tahtayla birleşiktir — _rowId(link, kimlik) → "<tahta id>:<kimlik>", _parseId ile geri ayrılır.
 * Tek tahtalı pencerede de aynı biçim kullanılır, yalnız sütun gizlidir ve sütun menüsünde yoktur.
 */
qx.Class.define("ankamon.ui.taskmgr.Tab", {
  extend: qx.ui.tabview.Page,
  type: "abstract",

  statics: {
    /** Çok tahtalı pencerede bütün tablolarda "Bilgisayar" sütunu (modelde son sütun — bkz. _table). */
    BOARD_COLUMN: { id: "board", label: "Bilgisayar", width: 180 }
  },

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
    update() {
      throw new Error("abstract");
    },

    /** "Bilgisayar" süzgeci değişti (pencere ardından görünen sekmeyi update() eder). */
    onBoardFilter() {},

    /** Tahtayla birleşik satır kimliği: "<tahta id>:<kimlik>". */
    _rowId(link, id) {
      return link.getId() + ":" + id;
    },

    /** _rowId'nin tersi: {link, id} (id metin) ya da null (grup satırı gibi tahtasız kimlik). */
    _parseId(rowId) {
      const m = /^(\d+):(.*)$/.exec(String(rowId ?? ""));
      const link = m && this._win.getLink(m[1]);
      return link ? { link, id: m[2] } : null;
    },

    /** Süzgece uyan ve verisi (modelde `part`, ör. "snap", "services") gelmiş tahta bağları. */
    _links(part = "snap") {
      return this._win.getVisibleLinks().filter(l => l.getModel()[part]);
    },

    /**
     * @param columns {Array} [{id, label, width?, renderer?, hint?}] — kimlik sütunu (0) eklenir, gizlidir
     * @param key {String} tercih anahtarı ("taskmgr.<sekme>")
     * @param model {qx.ui.table.model.Simple?}
     */
    _table(columns, key, model = null) {
      model = model || new qx.ui.table.model.Simple();
      const boardCol = ankamon.ui.taskmgr.Tab.BOARD_COLUMN;
      const all = columns.concat([boardCol]);
      model.setColumns(["id"].concat(all.map(c => c.label)), ["id"].concat(all.map(c => c.id)));
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
      // "Bilgisayar" (son sütun): çok tahtada kullanıcı sütunu, varsayılan yeri ilk sütunun (Ad) hemen yanı
      // (kayıtlı sütun sırası varsa o geçerli; kayıtta yoksa sona eklenir). Tek tahtada gizli iç sütun (sütun
      // menüsünde yok, tercihlere yazılmaz).
      const boardIndex = columns.length + 1;
      behavior.setWidth(boardIndex, boardCol.width);
      if (this._win.isMulti()) {
        // Sıra, setupColumnLayout'tan ÖNCE: henüz dinleyici yok, bu varsayılan sıra tercihlere yazılmaz.
        cm.setColumnsOrder([0, 1, boardIndex].concat(columns.slice(1).map((c, i) => i + 2)));
        // Kayıtlı sıra (tek tahtalı pencerede sürüklenmiş) "Bilgisayar"ı bilmiyorsa sona değil, kayıttaki ilk
        // sütunun yanına girsin: kayıt yalnız bellekte, kurulum süresince genişletilir (sunucuya yazılmaz).
        const prefs = this._win.getUser().ui_prefs || {};
        const orderKey = `${key}.columns.order`;
        const saved = prefs[orderKey];
        const widen = Array.isArray(saved) && saved.length && !saved.includes(boardCol.id);
        if (widen) {
          prefs[orderKey] = saved.slice(0, 1).concat([boardCol.id], saved.slice(1));
        }
        try {
          ankamon.page.Base.setupColumnLayout(table, all, 1, `${key}.columns`, this._win.getUser());
        } finally {
          if (widen) {
            prefs[orderKey] = saved;
          }
        }
      } else {
        cm.setColumnVisible(boardIndex, false);
        ankamon.page.Base.setupColumnLayout(table, columns, 1, `${key}.columns`, this._win.getUser());
      }
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

    /**
     * Satıra sağ tıklayınca `build(id)` menüsü (null → menü yok); tıklanan satır seçilir. Çok tahtada satırın
     * tahtası için "Yalnız bu bilgisayarı göster" / "Bütün bilgisayarları göster" (Bilgisayar süzgeci) eklenir.
     */
    _rowMenu(table, build) {
      table.addListener("cellContextmenu", e => {
        const row = e.getRow();
        const id = row === null || row === undefined ? null : table.getTableModel().getValue(0, row);
        if (id !== null && !table.getSelectionModel().isSelectedIndex(row)) {
          table.getSelectionModel().setSelectionInterval(row, row);
        }
        let menu = id === null ? null : build(id);
        const parsed = this._win.isMulti() && id !== null ? this._parseId(id) : null;
        if (parsed || (this._win.isMulti() && this._win.hasBoardFilter())) {
          menu = menu || new qx.ui.menu.Menu();
          if (menu.getChildren().length) {
            menu.add(new qx.ui.menu.Separator());
          }
          if (parsed) {
            this._item(menu, `Yalnız bu bilgisayarı göster (${parsed.link.getDisplay()})`,
              () => this._win.setBoardFilter([parsed.link.getId()]));
          }
          if (this._win.hasBoardFilter()) {
            this._item(menu, "Bütün bilgisayarları göster", () => this._win.setBoardFilter([]));
          }
        }
        const old = table.getContextMenu();
        table.setContextMenu(menu);
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
