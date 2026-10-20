/**
 * "Dosyaları dağıt/topla" penceresinin (bkz. ui.files.BulkWindow) bir sekmesi — "Dağıt" ya da "Topla": bu bilgisayardaki dosya/klasörleri seçilen
 * tahtalarda seçilen kullanıcıların bir konumuna (varsayılan Masaüstü) kopyalar ya da tersine, tahtalardan
 * toplayıp bu bilgisayara indirir (ZIP / tar.gz / seçilen klasöre tek tek; isteğe bağlı taşıma).
 *
 * Kullanıcılar: "Oturumu açık kullanıcılar" her tahtada o an oturumu açık olan(lar)ı hedefler; ayrıca
 * listeden belirli kullanıcılar işaretlenebilir (liste seçili tahtalardan okunur, kaç tahtada bulunduğu
 * yazılır). Konum: Masaüstü / Belgeler / İndirilenler (kullanıcının XDG dizinleri), ev dizini, ev dizini
 * altında bir yol ya da (kullanıcıdan bağımsız) mutlak yol.
 *
 * İş sunucuda yürür (worker/tihamon/files/bulk.py): tahta başına bir iş, aynı anda yürüyen iş sayısı
 * konteynerin işlemci/bellek durumuna göre sunucuda ayarlanır. Pencere ilerlemeyi, tahta/kullanıcı satırlarını
 * ve olayları (bilgi/uyarı/hata) gösterir; iş bitince aynı sekmede rapor (CSV olarak kaydedilebilir).
 */
qx.Class.define("tihamon.ui.files.BulkPanel", {
  extend: qx.ui.container.Composite,

  events: {
    /** "Kapat" düğmesi: pencere kapatılsın. */
    closeRequest: "qx.event.type.Event"
  },

  statics: {
    LOCATIONS: [
      ["desktop", "Masaüstü"], ["documents", "Belgeler"], ["downloads", "İndirilenler"], ["home", "Ev dizini"],
      ["sub", "Ev dizini altında…"], ["abs", "Mutlak yol (kullanıcıdan bağımsız)…"]
    ],

    STATES: {
      queued: "⏸ Sırada", running: "⏳ Sürüyor", ok: "✔ Tamam", done: "✔ Tamam", partial: "⚠ Kısmen",
      failed: "✖ Hata", skipped: "– Atlandı", cancelled: "⏹ İptal"
    }
  },

  /**
   * @param mode {String} "distribute" | "collect"
   * @param boards {Array} sunulan tahtalar [{id, name}]
   * @param selected {Array} başlangıçta işaretli tahta numaraları
   * @param user {Map} oturum sahibi
   */
  construct(mode, boards, selected, user) {
    super(new qx.ui.layout.Grow());
    this.__mode = mode;
    this.__user = user;
    this.__files = [];
    this.__checked = new Set();
    this.__boardUsers = [];
    this.__stack = new qx.ui.container.Stack();
    this.__stack.add(this.__createSetup(boards, selected));
    this.__stack.add(this.__createRun());
    this.add(this.__stack);

    // Sekme ilk kez görününce: kullanıcılar okunur, sürükle-bırak bağlanır.
    this.addListenerOnce("appear", () => {
      this.__loadUsers();
      if (this.__dropTarget) {
        this.__bindDrop(this.__dropTarget);
      }
    });
  },

  members: {
    __mode: null,
    __user: null,
    __files: null,
    __checked: null,
    __boardUsers: null,
    __stack: null,
    __boardBoxes: null,
    __boardCount: null,
    __fileTable: null,
    __fileInfo: null,
    __dropTarget: null,
    __location: null,
    __locationPath: null,
    __logged: null,
    __userBox: null,
    __userScroll: null,
    __userInfo: null,
    __conflict: null,
    __patterns: null,
    __move: null,
    __delivery: null,
    __startButton: null,
    __usersTimer: null,
    __usersSeq: 0,
    // çalışma sayfası
    __bar: null,
    __progressText: null,
    __phase: null,
    __cancelButton: null,
    __table: null,
    __events: null,
    __report: null,
    __reportText: null,
    __reportButtons: null,
    __job: null,
    __timer: null,
    __lastJson: null,
    __cancelled: false,
    __dirHandle: null,
    __speed: null,

    // ------------------------------------------------------------------ kurulum sayfası

    /** Liste kutularının çerçevesi (temadan bağımsız; "input" dekoratörü her temada yok). */
    __border() {
      return new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 4 });
    },

    __heading(text) {
      return new qx.ui.basic.Label(text).set({ font: "bold", marginTop: 4 });
    },

    __createSetup(boards, selected) {
      const page = new qx.ui.container.Composite(new qx.ui.layout.VBox(10));
      const body = new qx.ui.container.Composite(new qx.ui.layout.HBox(14));
      body.add(this.__createBoardColumn(boards, selected));
      const right = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
      if (this.__mode === "distribute") {
        this.__createFileSection(right);
      }
      this.__createLocationSection(right);
      this.__createUserSection(right);
      this.__createOptionSection(right);
      body.add(right, { flex: 1 });
      page.add(body, { flex: 1 });

      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      bar.add(new qx.ui.basic.Label(
        "İş sunucuda yürür; aynı anda kaç tahtaya bağlanılacağı sunucunun işlemci/bellek durumuna göre otomatik ayarlanır.")
        .set({ textColor: "app-muted", rich: true }), { flex: 1 });
      this.__startButton = new qx.ui.form.Button(this.__mode === "distribute" ? "Dağıt" : "Topla").set({ minWidth: 110 });
      this.__startButton.addListener("execute", this.__start, this);
      bar.add(this.__startButton);
      page.add(bar);
      return page;
    },

    __checkList(height) {
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(2)).set({ padding: [4, 6] });
      const scroll = new qx.ui.container.Scroll(box).set({ height, decorator: this.__border() });
      return { box, scroll };
    },

    __createBoardColumn(boards, selected) {
      const col = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({ width: 270 });
      this.__boardCount = this.__heading("Tahtalar");
      col.add(this.__boardCount);
      const filter = new qx.ui.form.TextField().set({ placeholder: "Süz…" });
      col.add(filter);
      const list = this.__checkList(null);
      this.__boardBoxes = boards.map(b => {
        const cb = new qx.ui.form.CheckBox(b.name).set({ value: selected.includes(b.id) });
        cb.setUserData("board", b);
        cb.addListener("changeValue", this.__boardsChanged, this);
        list.box.add(cb);
        return cb;
      });
      if (!boards.length) {
        list.box.add(new qx.ui.basic.Label("Çevrimiçi tahta yok.").set({ textColor: "app-muted" }));
      }
      col.add(list.scroll, { flex: 1 });
      filter.addListener("input", () => {
        const q = (filter.getValue() || "").toLocaleLowerCase("tr");
        this.__boardBoxes.forEach(cb => cb.setVisibility(
          cb.getLabel().toLocaleLowerCase("tr").includes(q) ? "visible" : "excluded"));
      });
      const buttons = new qx.ui.container.Composite(new qx.ui.layout.HBox(6));
      const setAll = value => () => this.__boardBoxes
        .filter(cb => cb.isVisible())
        .forEach(cb => cb.setValue(value));
      const all = new qx.ui.form.Button("Tümü");
      all.addListener("execute", setAll(true));
      const none = new qx.ui.form.Button("Hiçbiri");
      none.addListener("execute", setAll(false));
      buttons.add(all, { flex: 1 });
      buttons.add(none, { flex: 1 });
      col.add(buttons);
      this.__updateBoardCount();
      return col;
    },

    __selectedBoards() {
      return this.__boardBoxes.filter(cb => cb.getValue()).map(cb => cb.getUserData("board"));
    },

    __updateBoardCount() {
      this.__boardCount.setValue(`Tahtalar (${this.__selectedBoards().length} / ${this.__boardBoxes.length} seçili)`);
    },

    __boardsChanged() {
      this.__updateBoardCount();
      // Kutular art arda işaretlenirken her tıklamada sorgu atılmasın.
      if (this.__usersTimer) {
        this.__usersTimer.stop();
      }
      this.__usersTimer = qx.event.Timer.once(this.__loadUsers, this, 600);
    },

    __createFileSection(parent) {
      parent.add(this.__heading("Dağıtılacak dosyalar (bu bilgisayardan)"));
      const tools = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
      const button = (label, handler) => {
        const b = new qx.ui.form.Button(label).set({ padding: [3, 10] });
        b.addListener("execute", handler, this);
        tools.add(b);
        return b;
      };
      button("＋ Dosya ekle…", () => this.__addPicked(false));
      button("＋ Klasör ekle…", () => this.__addPicked(true));
      const remove = button("Kaldır", () => {
        const names = this.__selectedFileRows();
        this.__files = this.__files.filter(f => !names.includes(f.top));
        this.__renderFiles();
      });
      button("Temizle", () => {
        this.__files = [];
        this.__renderFiles();
      });
      this.__fileInfo = new qx.ui.basic.Label("Dosya ya da klasörleri buraya sürükleyip bırakabilirsiniz.")
        .set({ textColor: "app-muted" });
      tools.add(this.__fileInfo, { flex: 1 });
      parent.add(tools);

      const model = new qx.ui.table.model.Simple();
      model.setColumns(["Ad", "Tür", "Dosya", "Boyut"]);
      const table = new qx.ui.table.Table(model, {
        tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj)
      }).set({ height: 150, statusBarVisible: false, columnVisibilityButtonVisible: false });
      table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
      const behavior = table.getTableColumnModel().getBehavior();
      behavior.setWidth(0, "1*");
      behavior.setWidth(1, 80);
      behavior.setWidth(2, 80);
      behavior.setWidth(3, 100);
      table.getSelectionModel().addListener("changeSelection", () =>
        remove.setEnabled(this.__selectedFileRows().length > 0));
      remove.setEnabled(false);
      this.__fileTable = table;
      this.__dropTarget = table;
      parent.add(table);
    },

    __selectedFileRows() {
      const model = this.__fileTable.getTableModel();
      const names = [];
      this.__fileTable.getSelectionModel().iterateSelection(row => names.push(model.getValue(0, row)));
      return names;
    },

    async __addPicked(folder) {
      this.__addFiles(await tihamon.ui.files.BulkIo.pick(folder));
    },

    __addFiles(items) {
      if (!items.length) {
        return;
      }
      const known = new Set(this.__files.map(f => f.rel));
      items.forEach(it => {
        if (!known.has(it.rel)) {
          this.__files.push({ rel: it.rel, file: it.file, top: it.rel.split("/")[0] });
          known.add(it.rel);
        }
      });
      this.__renderFiles();
    },

    __bindDrop(widget) {
      const el = widget.getContentElement().getDomElement();
      if (!el) {
        return;
      }
      el.addEventListener("dragover", e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      });
      el.addEventListener("drop", async e => {
        e.preventDefault();
        try {
          this.__addFiles(await tihamon.ui.files.BulkIo.fromDrop(e.dataTransfer));
        } catch (err) {
          tihamon.ui.Dialog.error(err);
        }
      });
    },

    __renderFiles() {
      // Tabloda üst düzey öğeler (klasör tek satır, içindeki dosya sayısıyla) görünür.
      const tops = new Map();
      this.__files.forEach(f => {
        const t = tops.get(f.top) || { dir: false, count: 0, size: 0 };
        t.dir = t.dir || f.rel.includes("/");
        t.count++;
        t.size += f.file.size;
        tops.set(f.top, t);
      });
      const fmt = tihamon.util.Format.bytes;
      this.__fileTable.getTableModel().setData(Array.from(tops.entries())
        .map(([name, t]) => [name, t.dir ? "Klasör" : "Dosya", String(t.count), fmt(t.size)]));
      const total = this.__files.reduce((s, f) => s + f.file.size, 0);
      this.__fileInfo.setValue(this.__files.length
        ? `${this.__files.length} dosya · ${fmt(total)} — sürükleyip bırakarak ekleyebilirsiniz.`
        : "Dosya ya da klasörleri buraya sürükleyip bırakabilirsiniz.");
    },

    __createLocationSection(parent) {
      parent.add(this.__heading(this.__mode === "distribute" ? "Hedef konum (her tahtada)" : "Toplanacak konum (her tahtada)"));
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
      this.__location = new qx.ui.form.SelectBox().set({ width: 280 });
      tihamon.ui.files.BulkPanel.LOCATIONS.forEach(([key, label]) =>
        this.__location.add(new qx.ui.form.ListItem(label, null, key)));
      this.__locationPath = new qx.ui.form.TextField().set({ visibility: "hidden" });
      this.__location.addListener("changeSelection", () => {
        const kind = this.__locationKind();
        this.__locationPath.setVisibility(kind === "sub" || kind === "abs" ? "visible" : "hidden");
        this.__locationPath.setPlaceholder(kind === "sub" ? "ör. Masaüstü/Ödevler" : "ör. /opt/paylasim");
        const users = kind !== "abs";
        this.__logged.setEnabled(users);
        this.__userScroll.setEnabled(users);
      });
      row.add(this.__location);
      row.add(this.__locationPath, { flex: 1 });
      parent.add(row);
    },

    __locationKind() {
      return this.__location.getSelection()[0].getModel();
    },

    __createUserSection(parent) {
      const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "bottom" }));
      head.add(this.__heading("Kullanıcılar"));
      this.__userInfo = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
      head.add(this.__userInfo, { flex: 1 });
      const refresh = new qx.ui.form.Button("⟳").set({ toolTipText: "Kullanıcıları tahtalardan yeniden oku", padding: [2, 8] });
      refresh.addListener("execute", this.__loadUsers, this);
      head.add(refresh);
      parent.add(head);
      this.__logged = new qx.ui.form.CheckBox(
        "Oturumu açık kullanıcılar (her tahtada o anda oturumu açık olan kullanıcı)").set({ value: true });
      parent.add(this.__logged);
      const list = this.__checkList(null);
      this.__userBox = list.box;
      this.__userScroll = list.scroll;
      parent.add(list.scroll, { flex: 1 });
      const buttons = new qx.ui.container.Composite(new qx.ui.layout.HBox(6));
      const setAll = value => () => this.__userBox.getChildren().forEach(cb => {
        if (cb instanceof qx.ui.form.CheckBox) {
          cb.setValue(value);
        }
      });
      const all = new qx.ui.form.Button("Tüm kullanıcılar");
      all.addListener("execute", setAll(true));
      const none = new qx.ui.form.Button("Hiçbiri");
      none.addListener("execute", setAll(false));
      buttons.add(all);
      buttons.add(none);
      parent.add(buttons);
    },

    async __loadUsers() {
      const boards = this.__selectedBoards();
      const seq = ++this.__usersSeq;
      if (!boards.length) {
        this.__boardUsers = [];
        this.__renderUsers();
        this.__userInfo.setValue("Önce tahta seçin.");
        return;
      }
      this.__userInfo.setValue(`${boards.length} tahtadan okunuyor…`);
      let res;
      try {
        res = await tihamon.ui.files.Api.post("/bulk/users", { boards: boards.map(b => b.id) });
      } catch (e) {
        if (seq === this.__usersSeq) {
          this.__userInfo.setValue(`<span style="color:${this.__color("error")}">${qx.bom.String.escape(e.message)}</span>`);
        }
        return;
      }
      if (seq !== this.__usersSeq || this.isDisposed()) {
        return; // bu arada seçim değişti: yeni sorgunun sonucu geçerli
      }
      this.__boardUsers = res.boards;
      this.__renderUsers();
      const bad = res.boards.filter(b => b.error);
      const logged = res.boards.filter(b => (b.users || []).some(u => u.logged)).length;
      this.__userInfo.setValue(`${res.boards.length - bad.length} tahtadan okundu · ${logged} tahtada oturum açık` +
        (bad.length ? ` · <span style="color:${this.__color("error")}" title="${qx.bom.String.escape(
          bad.map(b => b.name + ": " + b.error).join("\n"))}">${bad.length} tahtaya ulaşılamadı</span>` : ""));
    },

    __renderUsers() {
      // Önceki işaretler korunur (tahta seçimi değişince liste yeniden kurulur).
      this.__userBox.getChildren().slice().forEach(cb => {
        if (cb instanceof qx.ui.form.CheckBox && !cb.getValue()) {
          this.__checked.delete(cb.getUserData("name"));
        }
        cb.destroy();
      });
      const stats = new Map();
      this.__boardUsers.forEach(b => (b.users || []).forEach(u => {
        const s = stats.get(u.name) || { boards: 0, logged: 0 };
        s.boards++;
        s.logged += u.logged ? 1 : 0;
        stats.set(u.name, s);
      }));
      const names = Array.from(stats.keys()).sort((a, b) =>
        stats.get(b).logged - stats.get(a).logged || a.localeCompare(b, "tr", { numeric: true }));
      const n = this.__boardUsers.length;
      names.forEach(name => {
        const s = stats.get(name);
        const where = s.boards === n ? (n > 1 ? "tüm tahtalarda" : "") : `${s.boards} tahtada`;
        const extra = [where, s.logged ? (n > 1 ? `${s.logged} tahtada oturumu açık` : "oturumu açık") : ""]
          .filter(Boolean).join(", ");
        const cb = new qx.ui.form.CheckBox(name + (extra ? `  — ${extra}` : "")).set({ value: this.__checked.has(name) });
        cb.setUserData("name", name);
        cb.addListener("changeValue", e => (e.getData() ? this.__checked.add(name) : this.__checked.delete(name)));
        this.__userBox.add(cb);
      });
      if (!names.length) {
        this.__userBox.add(new qx.ui.basic.Label("—").set({ textColor: "app-muted" }));
      }
    },

    __createOptionSection(parent) {
      parent.add(this.__heading("Seçenekler"));
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(10).set({ alignY: "middle" }));
      if (this.__mode === "distribute") {
        row.add(new qx.ui.basic.Label("Hedefte aynı adlı öğe varsa:"));
        const overwrite = new qx.ui.form.RadioButton("Üzerine yaz").set({ model: "overwrite" });
        const skip = new qx.ui.form.RadioButton("Var olanı koru (atla)").set({ model: "skip" });
        this.__conflict = new qx.ui.form.RadioGroup(overwrite, skip);
        row.add(overwrite);
        row.add(skip);
      } else {
        row.add(new qx.ui.basic.Label("Ad deseni:"));
        this.__patterns = new qx.ui.form.TextField().set({
          width: 220, placeholder: "*.pdf *.docx  (boşsa tümü)",
          toolTipText: "Konumun içindeki üst düzey öğelerin adlarıyla eşleşir (büyük/küçük harf duyarsız; * ve ?)."
        });
        row.add(this.__patterns);
        row.add(new qx.ui.basic.Label("Teslim:").set({ marginLeft: 10 }));
        this.__delivery = new qx.ui.form.SelectBox().set({ width: 230 });
        this.__delivery.add(new qx.ui.form.ListItem("ZIP arşivi olarak indir", null, "zip"));
        this.__delivery.add(new qx.ui.form.ListItem("tar.gz arşivi olarak indir", null, "tgz"));
        if (tihamon.ui.files.BulkIo.canSaveToFolder()) {
          this.__delivery.add(new qx.ui.form.ListItem("Bir klasöre kaydet (arşivsiz)", null, "folder"));
        }
        row.add(this.__delivery);
        this.__move = new qx.ui.form.CheckBox("Taşı (alınan öğeler tahtadan silinir)").set({ marginLeft: 10 });
        row.add(this.__move);
      }
      parent.add(row);
    },

    // ------------------------------------------------------------------ başlatma

    __request() {
      const kind = this.__locationKind();
      const location = { kind };
      if (kind === "sub" || kind === "abs") {
        location.path = (this.__locationPath.getValue() || "").trim();
        if (!location.path) {
          throw new Error(kind === "sub" ? "Ev dizini altındaki yolu yazın." : "Mutlak yolu yazın (/ ile başlayan).");
        }
      }
      const boards = this.__selectedBoards().map(b => b.id);
      if (!boards.length) {
        throw new Error("En az bir tahta seçin.");
      }
      const users = { logged: this.__logged.getValue(), names: Array.from(this.__checked) };
      if (kind !== "abs" && !users.logged && !users.names.length) {
        throw new Error("Kullanıcı seçin: “Oturumu açık kullanıcılar” ve/veya listeden kullanıcılar.");
      }
      if (this.__mode === "distribute" && !this.__files.length) {
        throw new Error("Dağıtılacak dosya ya da klasör ekleyin.");
      }
      return { boards, users, location };
    },

    async __start() {
      let req;
      try {
        req = this.__request();
      } catch (e) {
        tihamon.ui.Dialog.alert(qx.bom.String.escape(e.message));
        return;
      }
      const esc = qx.bom.String.escape;
      const where = this.__location.getSelection()[0].getLabel().replace("…", "") +
        (req.location.path ? ` “${esc(req.location.path)}”` : "");
      this.__dirHandle = null;
      if (this.__mode === "collect" && this.__delivery.getSelection()[0].getModel() === "folder") {
        // Klasör seçici kullanıcı hareketi ister: başka bir await'ten önce açılır.
        this.__dirHandle = await tihamon.ui.files.BulkIo.pickFolder();
        if (!this.__dirHandle) {
          return;
        }
      }
      if (this.__mode === "collect" && this.__move.getValue()) {
        const ok = await tihamon.ui.Dialog.confirm(
          `<b>Taşıma</b>: ${req.boards.length} tahtada ${where} konumundan alınan öğeler, sunucuya sağ salim ` +
          "aktarıldıktan sonra <b>tahtadan silinecek</b>." +
          (req.location.kind === "home" ? "<br><br>Konum <b>ev dizininin tamamı</b> — gizli ayar dosyaları da taşınır!" : ""),
          "Taşı");
        if (!ok) {
          return;
        }
      }
      this.__stack.setSelection([this.__stack.getChildren()[1]]);
      this.__cancelled = false;
      this.__cancelButton.setEnabled(true);
      this.__report.setVisibility("excluded");
      this.__events.setHtml("");
      this.__table.getTableModel().setData([]);
      this.__lastJson = null;
      this.__speed = null;
      try {
        let res;
        if (this.__mode === "distribute") {
          const fmt = tihamon.util.Format.bytes;
          this.__phase.setValue("Dosyalar sunucuya yükleniyor…");
          const token = await tihamon.ui.files.BulkIo.upload(this.__files, (done, total) => {
            this.__bar.setValue(total ? Math.floor((done / total) * 100) : 100);
            this.__progressText.setValue(`Yükleme: ${fmt(done)} / ${fmt(total)}`);
          }, () => this.__cancelled);
          this.__phase.setValue("Dağıtılıyor…");
          res = await tihamon.ui.files.Api.post("/bulk/distribute", Object.assign(req, {
            token, conflict: this.__conflict.getSelection()[0].getModel()
          }));
        } else {
          const patterns = (this.__patterns.getValue() || "").split(/[\s,;]+/).filter(Boolean);
          this.__phase.setValue("Toplanıyor…");
          res = await tihamon.ui.files.Api.post("/bulk/collect", Object.assign(req, {
            patterns, move: this.__move.getValue()
          }));
        }
        this.__job = { id: res.id, state: "running" };
      } catch (e) {
        this.__phase.setValue(`<span style="color:${this.__color("error")}">${esc(e.message)}</span>`);
        this.__finishUi(null);
        return;
      }
      this.__timer = new qx.event.Timer(700);
      this.__timer.addListener("interval", this.__poll, this);
      this.__timer.start();
      this.__poll();
    },

    // ------------------------------------------------------------------ çalışma / rapor sayfası

    __createRun() {
      const page = new qx.ui.container.Composite(new qx.ui.layout.VBox(8));
      const top = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      this.__bar = new qx.ui.indicator.ProgressBar(0, 100).set({ width: 320 });
      this.__progressText = new qx.ui.basic.Label("").set({ rich: true });
      this.__cancelButton = new qx.ui.form.Button("İptal");
      this.__cancelButton.addListener("execute", this.__cancel, this);
      top.add(this.__bar);
      top.add(this.__progressText, { flex: 1 });
      top.add(this.__cancelButton);
      page.add(top);
      this.__phase = new qx.ui.basic.Label("").set({ rich: true, font: "bold" });
      page.add(this.__phase);

      const model = new qx.ui.table.model.Simple();
      model.setColumns(["Tahta", "Kullanıcı", "Konum", "Durum", "Öğe", "Boyut", "Ayrıntı"]);
      const table = new qx.ui.table.Table(model, {
        tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj)
      }).set({ statusBarVisible: false, columnVisibilityButtonVisible: false });
      const behavior = table.getTableColumnModel().getBehavior();
      [180, 110, "1*", 110, 60, 90, "1*"].forEach((w, i) => behavior.setWidth(i, w));
      this.__table = table;
      page.add(table, { flex: 1 });

      page.add(this.__heading("Olaylar"));
      this.__events = new qx.ui.embed.Html("").set({ height: 120, overflowY: "auto", decorator: this.__border(), padding: [4, 6] });
      page.add(this.__events);

      this.__report = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }))
        .set({ visibility: "excluded" });
      this.__reportText = new qx.ui.basic.Label("").set({ rich: true, wrap: true });
      this.__report.add(this.__reportText, { flex: 1 });
      this.__reportButtons = new qx.ui.container.Composite(new qx.ui.layout.HBox(6));
      this.__report.add(this.__reportButtons);
      page.add(this.__report);
      return page;
    },

    __color(name) {
      return qx.theme.manager.Color.getInstance().resolve(name) || name;
    },

    async __cancel() {
      this.__cancelled = true;
      this.__cancelButton.setEnabled(false);
      if (this.__job && this.__job.state === "running") {
        try {
          await tihamon.ui.files.Api.post(`/bulk/${this.__job.id}/cancel`, {});
        } catch (e) {
          tihamon.ui.Dialog.error(e);
        }
      }
    },

    async __poll() {
      if (!this.__job) {
        return;
      }
      let job;
      try {
        job = await tihamon.ui.files.Api.request("GET", `/bulk/${this.__job.id}`);
      } catch (e) {
        if (/bulunamadı/.test(e.message)) {
          this.__stopPolling();
          this.__phase.setValue(qx.bom.String.escape(e.message));
          this.__finishUi(null);
        }
        return; // geçici hata: sonraki turda yeniden denenir
      }
      if (this.isDisposed()) {
        return;
      }
      this.__job = job;
      const json = JSON.stringify([job.boards, job.events.length, job.state, job.limit, job.running]);
      this.__renderProgress(job);
      if (json !== this.__lastJson) {
        this.__lastJson = json;
        this.__renderRows(job);
        this.__renderEvents(job);
      }
      if (job.state !== "running") {
        this.__stopPolling();
        this.__finished(job);
      }
    },

    __renderProgress(job) {
      const fmt = tihamon.util.Format.bytes;
      const n = job.boards.length || 1;
      const finished = job.boards.filter(b => !["queued", "running"].includes(b.state)).length;
      const frac = job.boards.reduce((sum, b) => sum + (["queued"].includes(b.state) ? 0
        : b.state === "running" ? (b.total ? Math.min(0.99, b.bytes / b.total) : 0.05) : 1), 0) / n;
      this.__bar.setValue(Math.floor(frac * 100));
      const now = Date.now() / 1000;
      if (!this.__speed) {
        this.__speed = { t: now, bytes: job.bytes, rate: 0 };
      } else if (now - this.__speed.t >= 2) {
        this.__speed.rate = Math.max(0, (job.bytes - this.__speed.bytes) / (now - this.__speed.t));
        this.__speed.t = now;
        this.__speed.bytes = job.bytes;
      }
      const elapsed = Math.round((job.finished || now) - job.started);
      const parts = [`%${Math.floor(frac * 100)}`, `${finished} / ${job.boards.length} tahta bitti`];
      if (job.state === "running") {
        parts.push(`${job.running} yürüyor (paralel sınır ${job.limit})`);
        if (this.__speed.rate > 0) {
          parts.push(fmt(this.__speed.rate) + "/sn");
        }
      }
      parts.push(fmt(job.bytes) + (this.__mode === "distribute" ? " gönderildi" : " alındı"));
      parts.push("süre " + tihamon.util.Format.duration(Math.max(1, elapsed)));
      this.__progressText.setValue(parts.join(" · "));
    },

    __rows(job) {
      const STATES = tihamon.ui.files.BulkPanel.STATES;
      const fmt = tihamon.util.Format.bytes;
      const rows = [];
      job.boards.forEach(b => {
        const pct = b.state === "running" && b.total ? ` %${Math.min(99, Math.floor((b.bytes / b.total) * 100))}` : "";
        if (!b.targets.length) {
          rows.push([b.name, "", "", (STATES[b.state] || b.state) + pct, "", b.bytes ? fmt(b.bytes) : "", b.message]);
          return;
        }
        b.targets.forEach((t, i) => {
          const state = t.state === "running" ? STATES.running + pct : (STATES[t.state] || t.state);
          const msg = t.state === "running" ? b.message : t.message;
          rows.push([i ? "" : b.name, t.user || "—", t.dir, state, t.items ? String(t.items) : "",
            t.bytes || t.total ? fmt(t.bytes || t.total) : "", msg]);
        });
      });
      return rows;
    },

    __renderRows(job) {
      this.__table.getTableModel().setData(this.__rows(job));
    },

    __renderEvents(job) {
      const esc = qx.bom.String.escape;
      const colors = { info: this.__color("app-muted"), warn: this.__color("app-warn"), error: this.__color("error") };
      const icons = { info: "ⓘ", warn: "⚠", error: "✖" };
      const html = job.events.map(e => {
        const t = new Date(e.t * 1000).toLocaleTimeString("tr-TR");
        return `<div style="color:${colors[e.level] || "inherit"};white-space:pre-wrap">${t} ${icons[e.level] || ""} ${esc(e.text)}</div>`;
      }).join("");
      this.__events.setHtml(html);
      const el = this.__events.getContentElement().getDomElement();
      if (el) {
        qx.event.Timer.once(() => (el.scrollTop = el.scrollHeight), null, 0);
      }
    },

    __finished(job) {
      const esc = qx.bom.String.escape;
      const counts = {};
      job.boards.forEach(b => (counts[b.state] = (counts[b.state] || 0) + 1));
      const targets = job.boards.reduce((list, b) => list.concat(b.targets), []);
      const ok = targets.filter(t => t.state === "ok").length;
      const bad = targets.filter(t => t.state === "failed").length;
      const color = job.state === "done" ? this.__color("app-ok") : job.state === "cancelled" ? this.__color("app-warn") : this.__color("error");
      const title = { done: "Tamamlandı", partial: "Hatalarla tamamlandı", failed: "Başarısız", cancelled: "İptal edildi" }[job.state] || job.state;
      const names = { done: "başarılı", partial: "kısmen", failed: "hatalı", skipped: "atlandı", cancelled: "iptal" };
      const summary = Object.keys(names).filter(k => counts[k]).map(k => `${counts[k]} ${names[k]}`).join(", ");
      this.__phase.setValue(`<span style="color:${color}">${title}</span>`);
      this.__reportText.setValue(
        `<b>Rapor</b>: ${job.boards.length} tahta (${esc(summary)}) · ${ok} ${job.kind === "distribute" ? "hedefe kopyalandı" : "kaynaktan alındı"}` +
        (bad ? `, <span style="color:${this.__color("error")}">${bad} hedefte hata</span>` : "") +
        ` · konum: ${esc(job.options.location_text)}` +
        (job.kind === "collect" && job.options.move ? " · <b>taşıma</b>" : ""));
      this.__finishUi(job);
      if (job.kind === "collect" && ok && job.state !== "cancelled") {
        this.__deliver(this.__dirHandle ? "folder" : this.__delivery.getSelection()[0].getModel());
      }
    },

    /** Rapor satırının düğmeleri: CSV, (toplamada) yeniden indir/kaydet, Yeni işlem, Kapat. */
    __finishUi(job) {
      this.__cancelButton.setEnabled(false);
      this.__reportButtons.removeAll().forEach(w => w.dispose());
      const button = (label, handler) => {
        const b = new qx.ui.form.Button(label);
        b.addListener("execute", handler, this);
        this.__reportButtons.add(b);
      };
      if (job) {
        const hasData = job.kind === "collect" && job.boards.some(b => b.targets.some(t => t.state === "ok"));
        if (hasData) {
          button("ZIP indir", () => this.__deliver("zip"));
          button("tar.gz indir", () => this.__deliver("tgz"));
          if (tihamon.ui.files.BulkIo.canSaveToFolder()) {
            button("Klasöre kaydet…", async () => {
              const handle = await tihamon.ui.files.BulkIo.pickFolder();
              if (handle) {
                this.__dirHandle = handle;
                this.__deliver("folder");
              }
            });
          }
        }
        button("Raporu kaydet (CSV)", () => this.__saveReport(job));
      }
      button("Yeni işlem", () => {
        if (this.__job && this.__job.state !== "running" && this.__mode === "collect") {
          tihamon.ui.files.Api.post(`/bulk/${this.__job.id}/discard`, {}).catch(() => null);
        }
        this.__job = null;
        if (this.__mode === "distribute") {
          this.__files = [];
          this.__renderFiles();
        }
        this.__stack.setSelection([this.__stack.getChildren()[0]]);
        this.__loadUsers();
      });
      button("Kapat", () => this.fireEvent("closeRequest"));
      this.__report.setVisibility("visible");
    },

    async __deliver(how) {
      const job = this.__job;
      if (how !== "folder") {
        tihamon.ui.files.BulkIo.download(job.id, how);
        this.__phase.setValue(this.__phase.getValue() + ` · ${how === "zip" ? "ZIP" : "tar.gz"} indirmesi başlatıldı`);
        return;
      }
      const fmt = tihamon.util.Format.bytes;
      const base = this.__phase.getValue();
      try {
        const failed = await tihamon.ui.files.BulkIo.saveToFolder(job.id, this.__dirHandle, (bytes, total, n, count) => {
          this.__bar.setValue(total ? Math.floor((bytes / total) * 100) : 100);
          this.__progressText.setValue(`Klasöre yazılıyor: ${n} / ${count} dosya · ${fmt(bytes)} / ${fmt(total)}`);
        });
        const esc = qx.bom.String.escape;
        this.__phase.setValue(base + ` · “${esc(this.__dirHandle.name)}” klasörüne kaydedildi` +
          (failed.length ? ` — <span style="color:${this.__color("error")}">${failed.length} dosya yazılamadı</span>` : ""));
        failed.slice(0, 20).forEach(f => this.__job.events.push({ t: Date.now() / 1000, level: "error", text: `Kaydedilemedi: ${f.path} — ${f.error}` }));
        if (failed.length) {
          this.__renderEvents(this.__job);
        }
      } catch (e) {
        tihamon.ui.Dialog.error(e);
      }
    },

    __saveReport(job) {
      const head = ["Tahta", "Kullanıcı", "Konum", "Durum", "Öğe", "Boyut", "Ayrıntı"];
      const rows = [];
      let board = "";
      this.__rows(job).forEach(r => {
        board = r[0] || board;
        rows.push([board].concat(r.slice(1)));
      });
      const cell = v => `"${String(v).replace(/"/g, '""')}"`;
      const csv = "﻿" + [head].concat(rows).map(r => r.map(cell).join(";")).join("\r\n") + "\r\n\r\n" +
        job.events.map(e => [new Date(e.t * 1000).toLocaleString("tr-TR"), e.level, e.text].map(cell).join(";")).join("\r\n");
      const stamp = new Date(job.started * 1000).toISOString().slice(0, 16).replace(/[-:T]/g, "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `${job.kind === "distribute" ? "dagitma" : "toplama"}-raporu-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      qx.event.Timer.once(() => URL.revokeObjectURL(a.href), null, 1000);
    },

    __stopPolling() {
      if (this.__timer) {
        this.__timer.stop();
        this.__timer.dispose();
        this.__timer = null;
      }
    },

    /** Sunucuda süren bir iş var mı (pencere kapatılırken sorulur)? */
    isRunning() {
      return !!(this.__job && this.__job.state === "running");
    },

    /** İşi iptal eder (pencere kapatılırken, kullanıcı onaylayınca). */
    cancelJob() {
      return this.__cancel();
    },

    /** Pencere kapanırken: yoklamayı durdurur, toplananları sunucudan siler. */
    shutdown() {
      this.__stopPolling();
      if (this.__job && this.__job.state !== "running" && this.__mode === "collect") {
        tihamon.ui.files.Api.post(`/bulk/${this.__job.id}/discard`, {}).catch(() => null);
      }
    }
  }
});
