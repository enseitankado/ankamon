/**
 * Sayfaların ortak tabanı: başlık, araç satırı ve içerik alanı.
 * Alt sınıflar _refresh() metodunu doldurur; sayfa her açıldığında çağrılır.
 */
qx.Class.define("tihamon.page.Base", {
  extend: qx.ui.container.Composite,
  type: "abstract",

  statics: {
    // Sayfanın sekmesi değişti ({page, tab}) — ui.Shell ağaçtaki sekme yaprağını vurgular.
    TAB_CHANGED: "tihamon.tabChanged",
    _canvas: null,

    /**
     * Sütun sırası ve gizlenen sütunlar (kullanıcı isteği: tüm grid'lerde) kullanıcı başına sunucuda
     * (users.ui_prefs["<key>.order"/"<key>.hidden"], bkz. AuthApi::prefs) saklanır; tablo kurulurken
     * oradan okunup uygulanır. Sıra: başlık sürüklenerek değiştirilir (qx yerleşik). Kullanıcı sütunları
     * dışındakiler (baştaki kimlik/işaret = `offset` kadar, sondaki iç sütunlar) yerinde tutulur ve
     * sütun menüsünde görünmez. Kayıtta olmayan (sonradan eklenen) sütunlar sona, varsayılan sırayla eklenir.
     * Sayfa dışından da kullanılır (ör. ui.files.Pane).
     * @param columns {Array} kullanıcı sütunları [{id}] — tablo modelinde `offset`'ten itibaren bu sırayla
     * @param user {Map} oturum sahibi (ui_prefs okunur/yazılır)
     * @param withWidths {Boolean} storageKey'li tablo: menünün baş kısmını __setupColumnPrefs düzenler
     */
    setupColumnLayout(table, columns, offset, key, user, withWidths = false) {
      const self = tihamon.page.Base;
      const columnModel = table.getTableColumnModel();
      const prefs = user.ui_prefs || (user.ui_prefs = {});
      const orderKey = key + ".order";
      const hiddenKey = key + ".hidden";
      const total = table.getTableModel().getColumnCount();
      const userCol = col => col >= offset && col < offset + columns.length;
      const fixed = Array.from({ length: total }, (_, i) => i).filter(col => !userCol(col));
      const lead = fixed.filter(col => col < offset);
      const tail = fixed.filter(col => col >= offset);
      const build = userCols => lead.concat(userCols, tail);

      if (!withWidths) {
        // storageKey'li tablolarda gizleme __setupColumnPrefs'te uygulanır (localStorage geçişiyle birlikte).
        const hidden = prefs[hiddenKey] || [];
        columns.forEach((column, index) => {
          if (hidden.includes(column.id)) {
            columnModel.setColumnVisible(index + offset, false);
          }
        });
        columnModel.addListener("visibilityChanged", () => {
          self.savePref(user, hiddenKey, columns
            .filter((column, index) => !columnModel.isColumnVisible(index + offset))
            .map(column => column.id));
        });
      }

      let applying = false;
      const apply = order => {
        applying = true;
        try {
          columnModel.setColumnsOrder(order);
        } finally {
          applying = false;
        }
      };
      const defaultUserCols = columns.map((column, index) => index + offset);
      const saved = prefs[orderKey];
      if (Array.isArray(saved) && saved.length) {
        const byId = new Map(columns.map((column, index) => [column.id, index + offset]));
        const cols = [];
        saved.forEach(id => {
          if (byId.has(id) && !cols.includes(byId.get(id))) {
            cols.push(byId.get(id));
          }
        });
        defaultUserCols.forEach(col => {
          if (!cols.includes(col)) {
            cols.push(col);
          }
        });
        apply(build(cols));
      }

      columnModel.addListener("orderChanged", () => {
        if (applying) {
          return;
        }
        const now = Array.from({ length: total }, (_, x) => columnModel.getOverallColumnAtX(x));
        const cols = now.filter(userCol);
        const order = build(cols);
        // İşaret/iç sütun sürüklenip başka yere bırakıldıysa yerine geri alınır.
        if (order.some((col, x) => now[x] !== col)) {
          apply(order);
        }
        const isDefault = cols.every((col, i) => col === defaultUserCols[i]);
        self.savePref(user, orderKey, isDefault ? null : cols.map(col => columns[col - offset].id));
      });

      table.addListener("columnVisibilityMenuCreateEnd", e => {
        const menu = e.getData().menu;
        if (!withWidths) {
          // Menü sırası = Table'ın x sırası (i. düğme = getOverallColumnAtX(i)); kullanıcı sütunu
          // olmayanlar (kimlik/işaret/iç) gizlenemez → menüden çıkarılır.
          const children = menu.getChildren().slice();
          children.forEach((button, i) => {
            if (i < total && !userCol(columnModel.getOverallColumnAtX(i))) {
              menu.remove(button);
            }
          });
          menu.add(new qx.ui.menu.Separator());
        }
        const reset = new qx.ui.menu.Button("Sütun sırasını sıfırla");
        reset.setToolTipText("Sütun başlıklarını sürükleyerek sıralayabilirsiniz; bu seçenek varsayılan sıraya döndürür.");
        reset.addListener("execute", () => {
          apply(build(defaultUserCols));
          self.savePref(user, orderKey, null);
        });
        menu.add(reset);
      });
    },

    /** Tek bir arayüz tercihini sunucuya yazar (bkz. AuthApi::prefs); null anahtarı siler. */
    savePref(user, name, value) {
      const prefs = user.ui_prefs || (user.ui_prefs = {});
      if (value === null) {
        delete prefs[name];
      } else {
        prefs[name] = value;
      }
      tihamon.io.Api.put("/auth/prefs", { key: name, value }).catch(() => {
        // Kalıcılık kaybı önemsiz: bir sonraki değişiklikte yeniden gönderilir.
      });
    },

    /** Metnin tablo yazı tipiyle piksel genişliği (otomatik sütun genişliği için; canvas ile hızlı). */
    _textWidth(text) {
      const self = tihamon.page.Base;
      if (!self._canvas) {
        self._canvas = document.createElement("canvas").getContext("2d");
        const font = qx.theme.manager.Font.getInstance().resolve("default");
        const st = font && font.getStyles ? font.getStyles() : {};
        const size = typeof st.fontSize === "number" ? st.fontSize + "px" : (st.fontSize || "13px");
        self._canvas.font = `${st.fontWeight || "normal"} ${size} ${st.fontFamily || "sans-serif"}`;
      }
      return self._canvas.measureText(text).width;
    }
  },

  /**
   * @param user {Map} oturum sahibi
   * @param title {String?} sayfa başlığı; boşsa başlık satırı gösterilmez (ör. sekmeleri kendi
   *   başlığı olan sayfalar — kullanıcı isteği)
   */
  construct(user, title) {
    super(new qx.ui.layout.VBox(12));
    this._user = user;

    // Başlık kendi satırında (daralan pencerede asla kesilmez).
    this._toolbar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    if (title) {
      this._toolbar.add(new qx.ui.basic.Label(title).set({ font: "headline" }));
    } else {
      this._toolbar.exclude();
    }
    this.add(this._toolbar);

    // Düğmeler ayrı, sarılabilen bir satırda: pencere daralınca kesilmek yerine alt satıra geçerler.
    // qx.ui.layout.Flow, VBox içinde doğal (tek satırlık) genişliğini üst kapsayıcıya dayatıp ondan
    // daha az yer verilmesini reddediyor (Stack/SplitPane zincirinde gözlemlendi: üst öğeler Flow'un
    // içerik genişliğine göre büyüyor, Flow asla sarmıyordu). Bu yüzden genişliği, sayfanın kendi
    // "resize" olayında elle sayfanın genişliğine kilitliyoruz; Flow o zaman zorunlu olarak sarar.
    this._actions = new qx.ui.container.Composite(new qx.ui.layout.Flow(6, 6));
    this.add(this._actions);
    this.addListener("resize", e => {
      const width = e.getData().width;
      if (width) {
        this._actions.setWidth(width);
      }
    });
  },

  members: {
    __tabView: null,
    __pendingTab: null,
    _user: null,
    _toolbar: null,
    _actions: null,
    _compact: false,

    /** Shell sayfayı her gösterdiğinde çağırır. */
    activate() {
      this.refresh();
    },

    async refresh() {
      try {
        await this._refresh();
      } catch (e) {
        if (e.status !== 401) {
          tihamon.ui.Dialog.error(e);
        }
      }
    },

    /** @abstract */
    async _refresh() {},

    _can(feature) {
      return this._user.is_admin || this._user.features.includes(feature);
    },

    /**
     * Düğme satırına (sarılabilir) bir düğme ekler. `this._compact = true` ayarlanmış sayfalarda
     * (çok düğmeli, kalabalık araç çubukları — ör. Tahtalar) düğmeler küçük dolgu + küçük yazı
     * tipiyle eklenir, satır daha az yer kaplar.
     */
    _addButton(label, handler) {
      const button = new qx.ui.form.Button(label);
      button.addListener("execute", handler, this);
      if (this._compact) {
        // Yalnız YATAY dolgu: dikey dolgu temada kalır. Bazı temalar (ör. SilverBlue [1, 7, 4, 5]) çerçeve
        // asimetrisini dikey dolguyla dengeler; eşit dikey dolgu etiketi alt kenara itiyordu.
        button.set({ paddingLeft: 9, paddingRight: 9, font: "small" });
      }
      this._actions.add(button);
      return button;
    },

    /**
     * Sütun tanımlarından tablo üretir. İlk sütun gizli kimlik sütunudur.
     * @param columns {Array} [{id, label, width?}] — width verilmeyen sütunlar esner
     * @param opts {Map} {checkable: true} verilirse, kimlikten hemen sonra tıklanabilir bir
     *   onay kutusu sütunu eklenir (satır başı çoklu seçim); bkz. _checkedIds/_checkAll.
     *   {storageKey: "ör. boards.columns"} verilirse: genişlikler içeriğe göre otomatik ayarlanır,
     *   kullanıcının elle ayarladığı genişlikler ve gizlenen sütunlar sunucuda saklanır, tablonun
     *   yerleşik sütun menüsü (sağ üstte) açılır — bkz. __setupColumnPrefs.
     *   {prefsKey: "ör. logs.columns"}: genişlikler OLDUĞU gibi (width/esnek) kalır; yalnız sütun sırası
     *   (başlığı sürükleyerek) ve gizlenen sütunlar kullanıcı başına sunucuda saklanır (storageKey de bunları yapar).
     */
    _createTable(columns, opts = {}) {
      const prefsKey = opts.storageKey || opts.prefsKey;
      const leadLabels = opts.checkable ? ["id", ""] : ["id"];
      const leadIds = opts.checkable ? ["id", "__checked"] : ["id"];
      const model = opts.model || new qx.ui.table.model.Simple();
      model.setColumns(leadLabels.concat(columns.map(c => c.label)), leadIds.concat(columns.map(c => c.id)));
      const table = new qx.ui.table.Table(model, {
        tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj)
      }).set({
        statusBarVisible: false,
        columnVisibilityButtonVisible: !!prefsKey,
        rowHeight: 28
      });
      const columnModel = table.getTableColumnModel();
      columnModel.setColumnVisible(0, false);
      const behavior = columnModel.getBehavior();

      let offset = 1;
      if (opts.checkable) {
        // Onay kutusu salt-görsel (metin "✓"; qx.ui.table.cellrenderer.Boolean'ın resim simgeleri
        // Tangible temasında yok ve görünmez kalıyordu — bkz. tihamon.ui.table.CheckRenderer).
        columnModel.setDataCellRenderer(1, new tihamon.ui.table.CheckRenderer());
        behavior.setWidth(1, 32);
        // İşaretleme kuralları (kullanıcı isteği): düz tıklama yalnız satırı vurgular, işareti
        // değiştirmez. İşaret değişir: onay kutusu sütununa tıklayınca (aç/kapa), Ctrl/⌘+tıklamada
        // (o satırı aç/kapa) ve Shift+tıklamada (son tıklanan satırdan bu satıra kadarki aralık
        // işaretlenir — Explorer'daki aralık seçimi gibi). Shift'li aralık, işaretlemenin YANINDA
        // o satırların seçim ışıklandırmasını da uygulasın diye seçim kipi çoklu aralığa açılır.
        table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
        let anchor = null;
        // Zaten TEK BAŞINA ışıklı olan satıra düz tıklama da işareti aç/kapa yapar (kullanıcı isteği):
        // ilk tıklama yalnız ışıklandırır, ışıklı satıra ikinci tıklama işaretler, üçüncüsü kaldırır.
        // "Önceden ışıklı mıydı" bilgisi tıklama anında artık kaybolmuş olduğundan (seçim tıklamayla
        // değişir) son düz tıklanan satırın KİMLİĞİ tutulur; seçim başka yoldan (klavye, başka satır)
        // değişince sıfırlanır. Kimlik (satır no değil): tablo 5 sn'de bir yenilenip yeniden sıralanabilir.
        let litId = null;
        let toggles = []; // [{row, at}] — çift tıklamanın tıklamalarının işaret değişikliklerini geri almak için
        const singleSelectedId = () => {
          const rows = [];
          table.getSelectionModel().iterateSelection(r => rows.push(r));
          return rows.length === 1 ? table.getTableModel().getValue(0, rows[0]) : null;
        };
        table.getSelectionModel().addListener("changeSelection", () => {
          if (singleSelectedId() !== litId) {
            litId = null;
          }
        });
        table.addListener("cellTap", e => {
          const tm = table.getTableModel();
          const row = e.getRow();
          if (row === null || row === undefined) {
            return;
          }
          const id = tm.getValue(0, row);
          if (e.isShiftPressed() && anchor !== null && anchor < tm.getRowCount()) {
            const lo = Math.min(anchor, row);
            const hi = Math.max(anchor, row);
            for (let r = lo; r <= hi; r++) {
              tm.setValue(1, r, true);
            }
            table.getSelectionModel().setSelectionInterval(lo, hi);
            litId = null;
            return; // çapa yerinde kalır: Shift ile aralık genişletilebilir
          }
          const modifier = e.isCtrlPressed() || e.isMetaPressed();
          if (e.getColumn() === 1 || modifier || (litId !== null && litId === id && singleSelectedId() === id)) {
            tm.setValue(1, row, !tm.getValue(1, row));
            toggles = toggles.filter(t => Date.now() - t.at < 600).concat({ row, at: Date.now() });
          }
          litId = modifier ? null : id;
          anchor = row;
        });
        // Çift tıklama (ör. Tahtalar'da Düzenle) iki tıklama üretir; bunlar yukarıdaki kurala göre işareti
        // bir ya da iki kez değiştirmiş olabilir — çift tıklamanın amacı işaretlemek olmadığından net
        // değişiklik (tek sayıda değişiklik) geri alınır. Onay kutusu sütunundaki çift tıklama hariç.
        table.addListener("cellDbltap", e => {
          const row = e.getRow();
          const n = toggles.filter(t => t.row === row && Date.now() - t.at < 600).length;
          if (e.getColumn() !== 1 && n % 2 === 1) {
            const tm = table.getTableModel();
            tm.setValue(1, row, !tm.getValue(1, row));
          }
          toggles = [];
        });
        // Veri yenilenince (süzgeç/yenileme) satır sırası değişebilir; eski çapa geçersizdir.
        model.addListener("dataChanged", e => {
          const d = e.getData();
          if (!d || d.firstColumn !== 1 || d.lastColumn !== 1) {
            anchor = null;
          }
        });
        // Ctrl/⌘+A (kullanıcı isteği): tabloda hâlâ görünen (süzülmüş) TÜM satırları işaretler VE
        // seçili (ışıklandırılmış) yapar — zaten hepsi işaretliyse ikisi de kalkar (aç/kapa).
        table.addListener("keydown", e => {
          if (!(e.isCtrlPressed() || e.isMetaPressed()) || e.getKeyIdentifier() !== "A") {
            return;
          }
          e.preventDefault();
          const rowCount = table.getTableModel().getRowCount();
          if (!rowCount) {
            return;
          }
          const allChecked = this._checkedIds(table).length === rowCount;
          this._checkAll(table, !allChecked);
          if (allChecked) {
            table.getSelectionModel().resetSelection();
          } else {
            table.getSelectionModel().setSelectionInterval(0, rowCount - 1);
          }
        });
        offset = 2;
      }
      table.setUserData("offset", offset);

      if (opts.storageKey) {
        this.__setupColumnPrefs(table, columns, offset, opts.storageKey);
      } else {
        columns.forEach((column, index) => {
          behavior.setWidth(index + offset, column.width || "1*"); // width yoksa esner
        });
      }
      if (prefsKey) {
        tihamon.page.Base.setupColumnLayout(table, columns, offset, prefsKey, this._user, !!opts.storageKey);
      }
      return table;
    },

    /**
     * storageKey'li tablolarda sütun genişliği ve görünürlüğü (kullanıcı isteği):
     *  - Genişlikler İÇERİĞE göre otomatik: her veri değişiminde başlık ve hücre metinleri ölçülüp
     *    hiçbir sütun kırpılmayacak genişliğe getirilir (esnek "1*" sütun yok — dar pencerede yatay
     *    kaydırma çıkar, sütun sıfıra inmez). Sütun tanımındaki width yalnız ilk çizim içindir.
     *  - Kullanıcı bir sütunu sürükleyerek boyutlandırırsa o genişlik SUNUCUDA saklanır (bkz.
     *    AuthApi::prefs, users.ui_prefs) ve o sütun artık otomatik ayarlanmaz — ta ki sütun
     *    menüsündeki "Sütun genişliklerini sıfırla" seçilene dek.
     *  - Gizlenen sütunlar da sunucuda saklanır (eskiden localStorage'daydı: yoksa bir kez oradan alınır).
     */
    __setupColumnPrefs(table, columns, offset, key) {
      const columnModel = table.getTableColumnModel();
      const behavior = columnModel.getBehavior();
      const prefs = this._user.ui_prefs || (this._user.ui_prefs = {});
      const widthsKey = key + ".widths";
      const hiddenKey = key + ".hidden";
      let userWidths = Object.assign({}, prefs[widthsKey] || {});
      const hidden = prefs[hiddenKey] || this.__loadJson(hiddenKey) || [];

      columns.forEach((column, index) => {
        const col = index + offset;
        behavior.setWidth(col, userWidths[column.id] || column.width || 100);
        if (hidden.includes(column.id)) {
          columnModel.setColumnVisible(col, false);
        }
      });

      const fit = () => {
        const tm = table.getTableModel();
        const measure = tihamon.page.Base._textWidth;
        const rows = Math.min(tm.getRowCount(), 500);
        columns.forEach((column, index) => {
          if (userWidths[column.id]) {
            return;
          }
          const col = index + offset;
          // Başlık: etiket (kalın olabilir) + sıralama oku + süzgeç kutusu için pay.
          let width = measure(column.label) * 1.1 + 34;
          for (let row = 0; row < rows; row++) {
            const value = tm.getValue(col, row);
            if (value !== null && value !== undefined && value !== "") {
              width = Math.max(width, measure(String(value).replace(/<[^>]*>/g, "")) + 22);
            }
          }
          width = Math.min(600, Math.max(50, Math.ceil(width)));
          if (Math.abs(columnModel.getColumnWidth(col) - width) > 2) {
            behavior.setWidth(col, width);
          }
        });
      };
      let fitPending = false;
      table.getTableModel().addListener("dataChanged", () => {
        if (!fitPending) {
          fitPending = true;
          qx.event.Timer.once(() => {
            fitPending = false;
            if (!table.isDisposed()) {
              fit();
            }
          }, this, 0);
        }
      });

      // Yalnız kullanıcının SÜRÜKLEMESİ (isPointerAction) saklanır; otomatik genişlik ve tablo
      // yeniden boyutlanınca davranışın yaptığı ayarlamalar saklanmaz.
      columnModel.addListener("widthChanged", e => {
        const data = e.getData();
        const column = columns[data.col - offset];
        if (!data.isPointerAction || !column) {
          return;
        }
        userWidths[column.id] = data.newWidth;
        // Davranışa da yazılır: yoksa tablo yeniden boyutlanınca sütun eski genişliğine döner.
        behavior.setWidth(data.col, data.newWidth);
        this.__savePref(widthsKey, Object.assign({}, userWidths));
      });
      columnModel.addListener("visibilityChanged", () => {
        const now = columns
          .filter((column, index) => !columnModel.isColumnVisible(index + offset))
          .map(column => column.id);
        this.__savePref(hiddenKey, now);
      });
      // Yerleşik sütun menüsü: kimlik (ve varsa işaret) sütunu hiç gizlenemeyeceğinden menüden
      // çıkarılır; sona "Sütun genişliklerini sıfırla" eklenir (kullanıcı genişliklerini siler,
      // bütün sütunlar yeniden içeriğe göre otomatik ayarlanır).
      table.addListener("columnVisibilityMenuCreateEnd", e => {
        const menu = e.getData().menu;
        const children = menu.getChildren();
        // Kısa başlıklı sütunlar menüde tam adlarıyla ("hint") görünür. Menü sırası Table'ınkiyle
        // aynı: i. düğme = getOverallColumnAtX(i).
        children.forEach((button, i) => {
          const column = columns[columnModel.getOverallColumnAtX(i) - offset];
          if (column && column.hint && button.setLabel) {
            button.setLabel(column.hint);
          }
        });
        for (let i = offset - 1; i >= 0; i--) {
          if (children[i]) {
            menu.remove(children[i]);
          }
        }
        menu.add(new qx.ui.menu.Separator());
        const reset = new qx.ui.menu.Button("Sütun genişliklerini sıfırla");
        reset.addListener("execute", () => {
          userWidths = {};
          this.__savePref(widthsKey, null);
          fit();
        });
        menu.add(reset);
      });
    },

    /**
     * Sekme hafızası (kullanıcı isteği): sayfadaki TabView'ın son seçili sekmesi kullanıcı başına
     * sunucuda (users.ui_prefs["tab.<name>"], bkz. AuthApi::prefs) saklanır; sayfa yeniden açılınca ya
     * da tarayıcı tazelenince o sekme seçili gelir. Sekme kimliği: userData "key" varsa o, yoksa
     * etiketi (sondaki "(3)" gibi sayaç hariç). Kayıtlı sekme artık yoksa (yetki değişti) ilk sekme kalır.
     * Sayfanın kendi changeSelection dinleyicisinden ÖNCE çağrılmalı: geri yükleme onu tetiklemesin.
     * @param tabs {qx.ui.tabview.TabView} sekmeleri eklenmiş görünüm
     * @param name {String} sayfaya özgü kısa ad, ör. "boards"
     */
    _rememberTab(tabs, name) {
      const key = "tab." + name;
      const idOf = tab => this.__tabId(tab);
      // Ağaçtan istenmiş ama sekmeler henüz kurulmamışsa (ör. Ayarlar her yüklemede yeniden kurar) o sekme.
      const saved = this.__pendingTab || (this._user.ui_prefs || {})[key];
      this.__pendingTab = null;
      this.__tabView = tabs;
      const tab = saved && tabs.getChildren().find(t => idOf(t) === saved);
      if (tab && tabs.getSelection()[0] !== tab) {
        tabs.setSelection([tab]);
      }
      tabs.addListener("changeSelection", e => {
        const selected = e.getData()[0];
        if (selected && idOf(selected) !== (this._user.ui_prefs || {})[key]) {
          this.__savePref(key, idOf(selected));
        }
        // Sol ağaç açık sekmenin yaprağını vurgulasın (sekme sayfanın içinden değiştiğinde de — bkz. ui.Shell).
        if (selected) {
          qx.event.message.Bus.dispatchByName(tihamon.page.Base.TAB_CHANGED, { page: this, tab: idOf(selected) });
        }
      });
      // Sekmeler geç kurulan sayfada (Ayarlar her yüklemede yeniden kurar) açılışta seçilen sekme de bildirilsin.
      qx.event.Timer.once(() => {
        const current = !tabs.isDisposed() && tabs.getSelection()[0];
        if (current) {
          qx.event.message.Bus.dispatchByName(tihamon.page.Base.TAB_CHANGED, { page: this, tab: idOf(current) });
        }
      }, this, 0);
    },

    /** Sekme kimliği: userData "key" varsa o, yoksa etiket (sondaki "(3)" gibi sayaç hariç). */
    __tabId(tab) {
      return tab.getUserData("key") || String(tab.getLabel() || "").replace(/\s*\(\d+\)$/, "");
    },

    /**
     * Sol ağaçtaki sekme seçeneği (bkz. ui.Shell PAGES tabs): sayfanın _rememberTab'a verdiği TabView'da o
     * sekmeyi seçer. Sekmeler henüz kurulmadıysa istek bekletilir, kurulunca (_rememberTab) uygulanır.
     * @return {Boolean} hemen seçildi mi
     */
    selectTab(key) {
      const tabs = this.__tabView && !this.__tabView.isDisposed() ? this.__tabView : null;
      const tab = tabs && tabs.getChildren().find(t => this.__tabId(t) === key);
      if (!tab) {
        this.__pendingTab = key;
        return false;
      }
      if (tabs.getSelection()[0] !== tab) {
        tabs.setSelection([tab]);
      }
      return true;
    },

    /** O an açık sekmenin kimliği (ağaçta vurgulamak için); sekmesiz sayfada null. */
    currentTab() {
      const tabs = this.__tabView && !this.__tabView.isDisposed() ? this.__tabView : null;
      const tab = tabs && tabs.getSelection()[0];
      return tab ? this.__tabId(tab) : null;
    },

    /** Sekmeler sol ağaçta alt seçenek olduğunda sayfadaki sekme çubuğu gizlenir (bkz. ui.Shell PAGES tabs). */
    _hideTabBar(tabs) {
      tabs.getChildControl("bar").setVisibility("excluded");
      // TabView sekme değişince düğmesini görünür alana kaydırır (scrollChildIntoView); çubuk gizliyken
      // düğmenin konumu yok — "Cannot read properties of null (reading 'left')" hatası veriyordu.
      tabs.scrollChildIntoView = () => {};
    },

    /** Tek bir arayüz tercihini sunucuya yazar (bkz. Base.savePref). */
    __savePref(name, value) {
      tihamon.page.Base.savePref(this._user, name, value);
    },

    __loadJson(key) {
      try {
        const raw = localStorage.getItem("tihamon." + key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    /**
     * Her sütun başlığının İÇİNE (etikete bitişik, altında) küçük bir süzgeç metin kutusu ekler
     * (Excel tarzı sütun filtresi) — ayrı bir satır DEĞİL, grid'in kendi başlık hücresinin bir
     * parçası (bkz. ui.table.FilterHeaderRenderer/FilterHeaderCell). Kutuya yazıldıkça `onChange`
     * çağrılır. Kutular gerçekten o sütunun başlık hücresinde yaşadığından sürükleyerek yeniden
     * boyutlandırma/gizleme ile otomatik hizalı kalır — ayrıca senkron kodu gerekmez.
     * @param table {qx.ui.table.Table} _createTable'ın döndürdüğü tablo (offset bilgisi için)
     * @param columns {Array} _createTable'a verilen aynı dizi
     * @param onChange {Function} her değişiklikte çağrılır (parametresiz)
     * @return {Map} {columnId: TextField} — değerlerini okumak için (bkz. çağıranların __apply'ı)
     */
    _addColumnFilters(table, columns, onChange) {
      const columnModel = table.getTableColumnModel();
      const offset = table.getUserData("offset") || 1;
      // Kutular başlık hücresi ÇİZİLİNCE oluşur — gizli sütunun (bkz. sütun gizleme) başlığı hiç
      // çizilmez. Çağıranlar her sütunun kutusunu okuduğundan (fields[id].getValue()) her sütun için
      // baştan sayfaya eklenmemiş bir yedek kutu konur; gerçek kutu gelince (sütun gösterilince) yerini
      // alır ve yedekteki değeri devralır. (Yedeksiz: gizli sütunlu grid'de "reading 'getValue'" hatası.)
      const fields = {};
      columns.forEach(column => {
        fields[column.id] = new qx.ui.form.TextField();
      });
      const renderer = new tihamon.ui.table.FilterHeaderRenderer((col, field) => {
        const column = columns[col - offset];
        if (!column) {
          return;
        }
        // İpucu sütun adını tekrarlamaz (etiket hemen üstte); kutunun ne işe yaradığını söyler.
        field.setPlaceholder("Süz…");
        field.setToolTipText((column.hint || column.label) + " sütununda süz");
        const previous = fields[column.id];
        field.addListener("changeValue", onChange, this);
        fields[column.id] = field;
        // Yedekte bekleyen değer (ör. Genel bakış kartından "Çevrimiçi") gerçek kutuya geçer ve süzer.
        if (previous && previous !== field && previous.getValue() && !field.getValue()) {
          field.setValue(previous.getValue());
        }
      });
      columns.forEach((column, index) => columnModel.setHeaderCellRenderer(index + offset, renderer));
      // Varsayılan (16) yalnız etiket için; süzgeç kutusu (22 px, bkz. FilterHeaderCell) alt satıra
      // ekleniyor, ikisine de yer açılır. 52 + kutu etiketin hemen altında (bkz. FilterHeaderCell
      // rowFlex): kutunun altında en dar temada (Gümüş Mavi, etiketi 21 px) 2 px, diğerlerinde 4-7 px
      // pay kalır (48'de Gümüş Mavi'de 4 px kesiliyordu) — 17 temanın hepsinde tarayıcıda ölçüldü.
      table.setHeaderCellHeight(52);
      return fields;
    },

    /** Tabloda seçili satırların kimlik sütunu değerleri (tek seçimli, satır vurgusuna dayalı). */
    _selectedIds(table) {
      const ids = [];
      table.getSelectionModel().iterateSelection(row => ids.push(table.getTableModel().getValue(0, row)));
      return ids;
    },

    /** _createTable(columns, {checkable:true}) ile kurulmuş tabloda işaretli satırların kimlikleri. */
    _checkedIds(table) {
      const tm = table.getTableModel();
      const ids = [];
      for (let row = 0; row < tm.getRowCount(); row++) {
        if (tm.getValue(1, row)) {
          ids.push(tm.getValue(0, row));
        }
      }
      return ids;
    },

    /** Şu an görünen (süzülmüş) bütün satırların onay kutusunu işaretler/kaldırır. */
    _checkAll(table, checked) {
      const tm = table.getTableModel();
      for (let row = 0; row < tm.getRowCount(); row++) {
        tm.setValue(1, row, checked);
      }
    }
  }
});
