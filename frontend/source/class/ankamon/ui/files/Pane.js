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
 * Dosya gezgininin bir paneli: tahta seçimi, yol, araç düğmeleri (Üst, Ev, Yenile, Yeni klasör, Ad
 * değiştir, Sil) ve dizin tablosu (Ad, Boyut, Sahip, Grup, İzin, Değiştirilme). Veriyi dosya gezgini
 * servisinden alır (bkz. ui.files.Api, worker/ankamon/files). Klasörler her zaman önde sıralanır;
 * çift tıklama klasöre girer. Klavye: Delete = sil, F2 = ad değiştir, Backspace = üst dizin.
 */
qx.Class.define("ankamon.ui.files.Pane", {
  extend: qx.ui.container.Composite,

  events: {
    /** Seçim, dizin ya da tahta değişti (penceredeki Kopyala düğmeleri buna göre etkinleşir). */
    changeState: "qx.event.type.Event"
  },

  /**
   * @param caption {String} panel başlığı ("Kaynak", "Hedef")
   * @param boards {Array} seçilebilecek tahtalar [{id, name}]
   * @param boardId {Number} başlangıç tahtası
   * @param path {String} başlangıç dizini
   * @param user {Map?} oturum sahibi: verilirse sütun sırası/gizleme kullanıcı başına sunucuda saklanır
   */
  construct(caption, boards, boardId, path, user) {
    super(new qx.ui.layout.VBox(6));
    this.__path = path || "/home";
    this.__user = user || null;
    this.__items = [];

    const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
    head.add(new qx.ui.basic.Label(caption).set({ font: "bold" }));
    this.__boardBox = new qx.ui.form.SelectBox().set({ minWidth: 180 });
    boards.forEach(b => {
      const item = new qx.ui.form.ListItem(b.name, null, b.id);
      this.__boardBox.add(item);
      if (b.id === boardId) {
        this.__boardBox.setSelection([item]);
      }
    });
    this.__boardBox.addListener("changeSelection", () => this.load("/home"));
    head.add(this.__boardBox, { flex: 1 });
    this.add(head);

    const nav = new qx.ui.container.Composite(new qx.ui.layout.HBox(4).set({ alignY: "middle" }));
    const button = (label, tip, handler) => {
      const b = new qx.ui.form.Button(label).set({ toolTipText: tip, padding: [3, 8] });
      b.addListener("execute", handler, this);
      nav.add(b);
      return b;
    };
    button("↑", "Üst dizin (Backspace)", () => this.load(this.__parent(this.__path)));
    button("⌂", "Ev dizinleri (/home)", () => this.load("/home"));
    this.__pathField = new qx.ui.form.TextField(this.__path);
    this.__pathField.addListener("keypress", e => {
      if (e.getKeyIdentifier() === "Enter") {
        this.load(this.__pathField.getValue() || "/");
      }
    });
    nav.add(this.__pathField, { flex: 1 });
    button("⟳", "Yenile", () => this.reload());
    this.add(nav);

    const tools = new qx.ui.container.Composite(new qx.ui.layout.HBox(4));
    const tool = (label, handler) => {
      const b = new qx.ui.form.Button(label).set({ padding: [3, 8] });
      b.addListener("execute", handler, this);
      tools.add(b);
      return b;
    };
    tool("Yeni klasör", this.__mkdir);
    this.__renameButton = tool("Ad değiştir", this.__rename);
    this.__deleteButton = tool("Sil", this.__delete);
    this.add(tools);

    this.__table = this.__createTable();
    this.add(this.__table, { flex: 1 });

    this.__status = new qx.ui.basic.Label("").set({ rich: true, textColor: "app-muted" });
    this.add(this.__status);
    this.__updateState();
  },

  members: {
    __path: null,
    __user: null,
    __items: null,
    __info: null,
    __boardBox: null,
    __pathField: null,
    __table: null,
    __status: null,
    __renameButton: null,
    __deleteButton: null,
    __loading: 0,

    getBoardId() {
      const sel = this.__boardBox.getSelection()[0];
      return sel ? sel.getModel() : null;
    },

    getBoardName() {
      const sel = this.__boardBox.getSelection()[0];
      return sel ? sel.getLabel() : "";
    },

    getPath() {
      return this.__path;
    },

    /** Dizindeki bütün adlar (hedefte aynı adlı öğe var mı denetimi için). */
    getNames() {
      return this.__items.map(i => i.name);
    },

    /** Seçili satırların adları. */
    getSelectedNames() {
      const model = this.__table.getTableModel();
      const names = [];
      this.__table.getSelectionModel().iterateSelection(row => names.push(model.getValue(0, row)));
      return names;
    },

    reload() {
      return this.load(this.__path);
    },

    async load(path) {
      const board = this.getBoardId();
      if (board === null) {
        return;
      }
      const token = ++this.__loading;
      this.__status.setValue("Yükleniyor…");
      try {
        const res = await ankamon.ui.files.Api.list(board, path);
        if (token !== this.__loading) {
          return; // bu arada başka bir dizin istendi
        }
        this.__path = res.path;
        this.__info = res;
        this.__items = res.items;
        this.__pathField.setValue(res.path);
        this.__table.getSelectionModel().resetSelection();
        this.__table.getTableModel().setData(res.items.map(i =>
          [i.name, i.type === "dir" ? null : i.size, i.user, i.group, i.mode, i.mtime, i.type]));
        this.__table.getTableModel().sortByColumn(0, true);
      } catch (e) {
        if (token === this.__loading) {
          this.__status.setValue(`<span style="color:#c42b1c">${qx.bom.String.escape(e.message)}</span>`);
        }
        return;
      }
      this.__updateState();
    },

    __createTable() {
      const model = new qx.ui.table.model.Simple();
      model.setColumns(["Ad", "Boyut", "Sahip", "Grup", "İzin", "Değiştirilme", "tür"]);
      // Klasörler her zaman önde; kendi aralarında ada göre (Türkçe sıralama, büyük/küçük harf duyarsız).
      const collator = new Intl.Collator("tr", { sensitivity: "base", numeric: true });
      const dirFirst = (a, b, asc) => {
        const da = a[6] === "dir" ? 0 : 1;
        const db = b[6] === "dir" ? 0 : 1;
        if (da !== db) {
          return da - db;
        }
        const c = collator.compare(String(a[0]), String(b[0]));
        return asc ? c : -c;
      };
      model.setSortMethods(0, { ascending: (a, b) => dirFirst(a, b, true), descending: (a, b) => dirFirst(a, b, false) });

      const table = new qx.ui.table.Table(model, {
        tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj)
      }).set({ statusBarVisible: false, showCellFocusIndicator: false, columnVisibilityButtonVisible: !!this.__user });
      table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
      const tcm = table.getTableColumnModel();
      tcm.setColumnVisible(6, false);
      const Renderer = ankamon.ui.files.FormatRenderer;
      tcm.setDataCellRenderer(0, new Renderer((v, row) => (row[6] === "dir" ? "📁 " : row[6] === "link" ? "🔗 " : "") + v));
      tcm.setDataCellRenderer(1, new Renderer(v => (v === null ? "" : ankamon.util.Format.bytes(v))));
      tcm.setDataCellRenderer(4, new Renderer(v => v).set({ defaultCellStyle: "font-family:monospace" }));
      // Saniyesiz (dar sütunda kesilmesin): 14.10.2026 09:45
      const date = new Intl.DateTimeFormat("tr-TR",
        { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
      tcm.setDataCellRenderer(5, new Renderer(v => (v ? date.format(new Date(v * 1000)) : "")));
      const resize = tcm.getBehavior();
      // Ad, Sahip, Grup panel genişliğiyle büyür (geniş pencerede adlar kesilmesin); diğerleri sabit.
      resize.set(0, { width: "3*", minWidth: 140 });
      resize.setWidth(1, 75);
      resize.set(2, { width: "1*", minWidth: 70 });
      resize.set(3, { width: "1*", minWidth: 70 });
      resize.setWidth(4, 110);
      resize.setWidth(5, 125);
      if (this.__user) {
        // Sütun sırası/gizleme kullanıcı başına sunucuda (iki panel aynı ayarı paylaşır); "tür" iç sütundur.
        const ids = ["name", "size", "user", "group", "mode", "mtime"];
        ankamon.page.Base.setupColumnLayout(table, ids.map(id => ({ id })), 0, "files.columns", this.__user);
      }

      table.addListener("cellDbltap", e => {
        const row = model.getRowData(e.getRow());
        if (row && row[6] === "dir") {
          this.load(this.__join(this.__path, row[0]));
        }
      });
      table.getSelectionModel().addListener("changeSelection", this.__updateState, this);
      table.addListener("keypress", e => {
        const key = e.getKeyIdentifier();
        if (key === "Delete") {
          this.__delete();
        } else if (key === "F2") {
          this.__rename();
        } else if (key === "Backspace") {
          this.load(this.__parent(this.__path));
        } else if (key === "Enter") {
          const names = this.getSelectedNames();
          const item = this.__items.find(i => i.name === names[0]);
          if (names.length === 1 && item && item.type === "dir") {
            this.load(this.__join(this.__path, item.name));
          }
        }
      });
      return table;
    },

    __updateState() {
      const names = this.getSelectedNames();
      this.__renameButton.setEnabled(names.length === 1);
      this.__deleteButton.setEnabled(names.length > 0);
      if (this.__info) {
        const esc = qx.bom.String.escape;
        const selected = this.__items.filter(i => names.includes(i.name));
        const bytes = selected.filter(i => i.type !== "dir").reduce((sum, i) => sum + i.size, 0);
        const parts = [
          `<b>${esc(this.__info.path)}</b> — ${esc(this.__info.owner)}:${esc(this.__info.group)} ` +
            `<span style="font-family:monospace">${esc(this.__info.mode)}</span>`,
          `${this.__items.length} öğe`
        ];
        if (names.length) {
          parts.push(`${names.length} seçili` + (bytes ? ` (${ankamon.util.Format.bytes(bytes)} dosya)` : ""));
        }
        this.__status.setValue(parts.join(" · "));
      }
      this.fireEvent("changeState");
    },

    __join(dir, name) {
      return (dir === "/" ? "" : dir) + "/" + name;
    },

    __parent(path) {
      const i = path.lastIndexOf("/");
      return i <= 0 ? "/" : path.slice(0, i);
    },

    async __mkdir() {
      const name = await ankamon.ui.Dialog.prompt(
        `<b>${qx.bom.String.escape(this.__path)}</b> içinde yeni klasörün adı:`, "", "Oluştur", "Yeni klasör");
      if (!name) {
        return;
      }
      try {
        await ankamon.ui.files.Api.post("/mkdir", { board: this.getBoardId(), path: this.__path, name });
        await this.reload();
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async __rename() {
      const names = this.getSelectedNames();
      if (names.length !== 1) {
        return;
      }
      const name = await ankamon.ui.Dialog.prompt(
        `<b>${qx.bom.String.escape(names[0])}</b> için yeni ad:`, names[0], "Değiştir", "Ad değiştir");
      if (!name || name === names[0]) {
        return;
      }
      try {
        await ankamon.ui.files.Api.post("/rename",
          { board: this.getBoardId(), path: this.__join(this.__path, names[0]), name });
        await this.reload();
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async __delete() {
      const names = this.getSelectedNames();
      if (!names.length) {
        return;
      }
      const esc = qx.bom.String.escape;
      const shown = names.slice(0, 8).map(n => "• " + esc(n)).join("<br>") +
        (names.length > 8 ? `<br>… ve ${names.length - 8} öğe daha` : "");
      const ok = await ankamon.ui.Dialog.confirm(
        `<b>${esc(this.getBoardName())}</b> tahtasında <b>${esc(this.__path)}</b> içinden ` +
        `${names.length} öğe <b>kalıcı olarak</b> silinsin mi? Klasörler içerikleriyle birlikte silinir.<br><br>${shown}`,
        "Sil");
      if (!ok) {
        return;
      }
      try {
        await ankamon.ui.files.Api.post("/delete",
          { board: this.getBoardId(), paths: names.map(n => this.__join(this.__path, n)) });
        await this.reload();
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    }
  }
});
