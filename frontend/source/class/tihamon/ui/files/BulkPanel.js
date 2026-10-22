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

    /** Topla ▸ "Yalnız şu türlerdeki dosyalar" kategorileri: [etiket, uzantılar]. */
    TYPES: {
      docs: ["Belgeler", ["pdf", "doc", "docx", "odt", "rtf", "txt"]],
      slides: ["Sunular", ["ppt", "pptx", "pps", "ppsx", "odp"]],
      sheets: ["Tablolar", ["xls", "xlsx", "ods", "csv"]],
      images: ["Görseller", ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"]],
      videos: ["Videolar", ["mp4", "mkv", "avi", "mov", "webm", "wmv"]],
      audio: ["Sesler", ["mp3", "wav", "ogg", "m4a", "flac"]],
      archives: ["Arşivler", ["zip", "rar", "7z", "tar", "gz"]]
    },

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
    __fileTree: null,
    __fileBusy: null,
    __fileBusyLabel: null,
    __fileRoot: null,
    __nodePaths: null,
    __nodeDirs: null,
    __fileInfo: null,
    __dropTarget: null,
    __location: null,
    __locationPath: null,
    __logged: null,
    __userBox: null,
    __userScroll: null,
    __userInfo: null,
    __conflict: null,
    __relay: null,
    __upload: null,
    __lastReq: null,
    __askOnStop: false,
    __patterns: null,
    __what: null,
    __typeBoxes: null,
    __deep: null,
    __skipJunk: null,
    __whatText: null,
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
    __tree: null,
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

    /**
     * Numaralı adım kutusu (kullanıcı isteği: bileşenler ana işlemlere göre gruplanır, sıra numarası
     * büyük ve fark edilir): ince çerçeve, başlıkta vurgu renginde daire içinde numara + adım adı.
     * @return {qx.ui.container.Composite} kutu (başlık eklenmiş; içerik çağıran tarafından eklenir)
     */
    __step(n, title, hint) {
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({
        padding: [8, 12, 10, 12],
        decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 8 })
      });
      box.add(this.__stepHead(n, title, hint));
      return box;
    },

    __stepHead(n, title, hint) {
      const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(10).set({ alignY: "middle" }));
      const esc = qx.bom.String.escape;
      head.add(new qx.ui.basic.Label(
        `<span style="display:inline-block;width:30px;height:30px;line-height:30px;border-radius:50%;` +
        `background:${this.__color("primary")};color:#fff;text-align:center;font-weight:700;font-size:17px">${n}</span>`
      ).set({ rich: true, alignY: "middle" }));
      head.add(new qx.ui.basic.Label(`<span style="font-size:15px;font-weight:600">${esc(title)}</span>` +
        (hint ? `  <span style="opacity:.65">${esc(hint)}</span>` : "")).set({ rich: true, alignY: "middle" }));
      return head;
    },

    __createSetup(boards, selected) {
      const distribute = this.__mode === "distribute";
      const page = new qx.ui.container.Composite(new qx.ui.layout.VBox(10));
      const body = new qx.ui.container.Composite(new qx.ui.layout.HBox(10));

      // 1 — bilgisayarlar
      const step1 = this.__step(1, "Bilgisayarları seç");
      step1.set({ width: 290 });
      step1.add(this.__createBoardColumn(boards, selected), { flex: 1 });
      body.add(step1);

      const right = new qx.ui.container.Composite(new qx.ui.layout.VBox(10));
      if (distribute) {
        // 2 — gönderilecekler, 3 — hedef (konum, kullanıcılar, aynı ad seçeneği)
        const step2 = this.__step(2, "Gönderilecek dosya ve klasörleri belirle", "bu bilgisayardan");
        this.__createFileSection(step2);
        const step3 = this.__step(3, "Hedefi belirle", "her seçili bilgisayarda");
        this.__createLocationSection(step3);
        this.__createUserSection(step3);
        this.__createOptionSection(step3);
        right.add(this.__createSplit(step2, step3), { flex: 1 });
      } else {
        // 2 — nereden (konum, kullanıcılar), 3 — ne (öğeler, taşıma, teslim biçimi)
        const step2 = this.__step(2, "Nereden toplanacağını belirle", "her seçili bilgisayarda");
        this.__createLocationSection(step2);
        this.__createUserSection(step2);
        right.add(step2, { flex: 1 });
        const step3 = this.__step(3, "Neyin toplanacağını belirle");
        this.__createWhatSection(step3);
        this.__createOptionSection(step3);
        right.add(step3);
      }
      body.add(right, { flex: 1 });
      page.add(body, { flex: 1 });

      // 4 — başlat (tek satır: numara + ad + açıklama + düğmeler)
      const step4 = this.__step(4, distribute ? "Dağıt" : "Topla");
      const head = step4.getChildren()[0];
      head.add(new qx.ui.basic.Label(
        "İş sunucuda yürür; aynı anda kaç bilgisayara bağlanılacağı sunucunun işlemci/bellek durumuna göre otomatik ayarlanır.")
        .set({ textColor: "app-muted", rich: true, wrap: true, alignY: "middle", marginLeft: 10 }), { flex: 1 });
      if (!distribute) {
        const preview = new qx.ui.form.Button("Önizle").set({
          minWidth: 90, toolTipText: "Hiçbir şey aktarmadan, her tahtada neyin toplanacağını sayıp listeler"
        });
        preview.addListener("execute", () => this.__start(true));
        head.add(preview);
      }
      this.__startButton = new qx.ui.form.Button(distribute ? "Dağıt" : "Topla").set({ minWidth: 120, font: "bold" });
      this.__startButton.addListener("execute", () => this.__start(false));
      head.add(this.__startButton);
      page.add(step4);
      return page;
    },

    /**
     * Dağıt: 2. (gönderilecekler) ve 3. (hedef) bölge arasında sürüklenebilir ayraç. Oran kullanıcının
     * hesabında saklanır (ui_prefs "bulk.distribute.split" — bkz. page.Base.savePref) ve her açılışta uygulanır.
     */
    __createSplit(top, bottom) {
      const key = "bulk.distribute.split";
      const prefs = (this.__user && this.__user.ui_prefs) || {};
      const ratio = typeof prefs[key] === "number" ? Math.min(0.85, Math.max(0.15, prefs[key])) : 0.36;
      const split = new qx.ui.splitpane.Pane("vertical");
      // SplitPane.add çıplak sayı flex bekler (bkz. tiha-mon-architecture notu).
      split.add(top, Math.round(ratio * 1000));
      split.add(bottom, Math.round((1 - ratio) * 1000));
      const save = () => qx.event.Timer.once(() => {
        const a = top.getBounds();
        const b = bottom.getBounds();
        if (a && b && a.height + b.height > 0) {
          const value = Math.round((a.height / (a.height + b.height)) * 1000) / 1000;
          if (value !== prefs[key]) {
            tihamon.page.Base.savePref(this.__user, key, value);
          }
        }
      }, this, 50);
      // Sürükleme bitince oran kaydedilir: sürüklerken yakalamayı bölmenin kendisi tutar, bırakınca "losecapture".
      split.addListener("losecapture", save);
      return split;
    },

    __checkList(height) {
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(2)).set({ padding: [4, 6] });
      const scroll = new qx.ui.container.Scroll(box).set({ height, decorator: this.__border() });
      return { box, scroll };
    },

    __createBoardColumn(boards, selected) {
      const col = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
      this.__boardCount = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
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
      this.__boardCount.setValue(`${this.__selectedBoards().length} / ${this.__boardBoxes.length} çevrimiçi bilgisayar seçili`);
    },

    __boardsChanged() {
      this.__updateBoardCount();
      // Kutular art arda işaretlenirken her tıklamada sorgu atılmasın.
      if (this.__usersTimer) {
        this.__usersTimer.stop();
      }
      this.__usersTimer = qx.event.Timer.once(this.__loadUsers, this, 600);
    },

    /**
     * Dağıtılacak dosyalar: sütunlu ağaç (Ad, Dosya, Boyut). Klasörler kapalı gelir; içerikleri ancak açılınca
     * oluşturulur (on binlerce dosyalı klasörde de hızlı). Klasör okunurken (tarayıcının listelemesi uzun
     * sürebilir) ağacın üstünde bilgilendirme gösterilir. "Kaldır" seçili klasörü/dosyayı (alt düzeyde de)
     * listeden çıkarır.
     */
    __createFileSection(parent) {
      const tools = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
      const button = (label, handler) => {
        const b = new qx.ui.form.Button(label).set({ padding: [3, 10] });
        b.addListener("execute", handler, this);
        tools.add(b);
        return b;
      };
      button("＋ Dosya ekle…", () => this.__addPicked(false));
      button("＋ Klasör ekle…", () => this.__addPicked(true)).setToolTipText(
        "Tarayıcı, klasördeki dosyaların siteye verilmesi için kendi güvenlik onayını sorar (sayfa bunu kapatamaz). " +
        "Onay sorulmasın isterseniz klasörü buraya sürükleyip bırakın.");
      const remove = button("Kaldır", () => this.__removeSelected());
      button("Temizle", () => {
        this.__files = [];
        this.__renderFiles();
      });
      this.__fileInfo = new qx.ui.basic.Label("Dosya ya da klasörleri buraya sürükleyip bırakabilirsiniz.")
        .set({ textColor: "app-muted" });
      tools.add(this.__fileInfo, { flex: 1 });
      parent.add(tools);

      const tree = new qx.ui.treevirtual.TreeVirtual(["Ad", "Dosya", "Boyut"]).set({
        statusBarVisible: false, columnVisibilityButtonVisible: false
      });
      tree.setAlwaysShowOpenCloseSymbol(true);
      tree.setSelectionMode(qx.ui.treevirtual.TreeVirtual.SelectionMode.MULTIPLE_INTERVAL);
      const behavior = tree.getTableColumnModel().getBehavior();
      behavior.setWidth(0, "1*");
      behavior.setWidth(1, 80);
      behavior.setWidth(2, 100);
      // Kapalı klasör ilk açılışta doldurulur (bkz. __fillNode).
      tree.addListener("treeOpenWhileEmpty", e => this.__fillNode(e.getData().nodeId));
      tree.addListener("changeSelection", () => remove.setEnabled(this.__selectedPaths().length > 0));
      // Sağ menü: Kaldır. Sağ tıklanan satır seçili değilse seçim ona taşınır.
      tree.addListener("cellContextmenu", e => {
        const row = e.getRow();
        if (row === null || row === undefined) {
          tree.setContextMenu(null);
          return;
        }
        if (!tree.getSelectionModel().isSelectedIndex(row)) {
          tree.getSelectionModel().setSelectionInterval(row, row);
        }
        const menu = new qx.ui.menu.Menu();
        const n = this.__selectedPaths().length;
        menu.add(tihamon.ui.BoardOps.menuButton(tihamon.ui.Shell.ICON.delete,
          n > 1 ? `Kaldır (${n} öğe)` : "Kaldır", () => this.__removeSelected()));
        menu.addListenerOnce("disappear", () => qx.event.Timer.once(() => menu.destroy(), null, 0));
        tree.setContextMenu(menu);
      });
      remove.setEnabled(false);
      this.__fileTree = tree;

      // Ağacın üstünde ortalanmış bilgilendirme katmanı (yalnız okuma sürerken).
      this.__fileBusy = new qx.ui.container.Composite(new qx.ui.layout.VBox().set({ alignX: "center", alignY: "middle" }))
        .set({ backgroundColor: "surface", opacity: 0.94, visibility: "excluded" });
      this.__fileBusyLabel = new qx.ui.basic.Label("").set({ rich: true, textAlign: "center", padding: 16 });
      this.__fileBusy.add(this.__fileBusyLabel);
      const box = new qx.ui.container.Composite(new qx.ui.layout.Canvas()).set({ minHeight: 90 });
      box.add(tree, { edge: 0 });
      box.add(this.__fileBusy, { edge: 0 });
      this.__dropTarget = box;
      parent.add(box, { flex: 1 });
      this.__renderFiles();
    },

    /** Seçili klasör/dosyaları listeden çıkarır; açık klasörler açık kalır (kullanıcı isteği). */
    __removeSelected() {
      const paths = this.__selectedPaths();
      if (!paths.length) {
        return;
      }
      this.__files = this.__files.filter(f => !paths.some(p => f.rel === p || f.rel.startsWith(p + "/")));
      this.__renderFiles(this.__openPaths());
    },

    /** Ağaçta şu an açık klasörlerin göreli yolları. */
    __openPaths() {
      const open = [];
      const data = this.__fileTree.getDataModel().getData();
      data.forEach(node => {
        if (node && node.type === qx.ui.treevirtual.MTreePrimitive.Type.BRANCH && node.bOpened) {
          const path = this.__nodePaths.get(node.nodeId);
          if (path) {
            open.push(path);
          }
        }
      });
      return open;
    },

    /** Okuma sürüyor bilgisi (null: kaldır). */
    __setFileBusy(html) {
      this.__fileBusyLabel.setValue(html || "");
      this.__fileBusy.setVisibility(html ? "visible" : "excluded");
    },

    /** Seçili düğümlerin göreli yolları. */
    __selectedPaths() {
      return this.__fileTree.getSelectedNodes().map(n => this.__nodePaths.get(n.nodeId)).filter(Boolean);
    },

    async __addPicked(folder) {
      const items = await tihamon.ui.files.BulkIo.pick(folder, () => this.__setFileBusy(
        "<b>Klasör okunuyor…</b><br>Tarayıcı klasördeki bütün dosyaları listeliyor; çok dosyalı klasörlerde " +
        "bu birkaç saniye ile birkaç dakika sürebilir."));
      await this.__addFiles(items);
    },

    async __addFiles(items) {
      if (!items.length) {
        this.__setFileBusy(null);
        return;
      }
      this.__setFileBusy(`<b>${items.length.toLocaleString("tr-TR")} dosya listeye ekleniyor…</b>`);
      await new Promise(r => setTimeout(r, 30));   // bilgi ekrana çizilsin
      const known = new Set(this.__files.map(f => f.rel));
      items.forEach(it => {
        if (!known.has(it.rel)) {
          this.__files.push({ rel: it.rel, file: it.file });
          known.add(it.rel);
        }
      });
      this.__renderFiles();
      this.__setFileBusy(null);
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
        this.__setFileBusy("<b>Bırakılan öğeler okunuyor…</b>");
        try {
          await this.__addFiles(await tihamon.ui.files.BulkIo.fromDrop(e.dataTransfer, n =>
            this.__setFileBusy(`<b>Bırakılan öğeler okunuyor…</b><br>${n.toLocaleString("tr-TR")} dosya bulundu`)));
        } catch (err) {
          this.__setFileBusy(null);
          tihamon.ui.Dialog.error(err);
        }
      });
    },

    /**
     * Dosya listesinden klasör ağacı kurar (bellekte) ve görünür ağaca yalnız üst düzeyi koyar; klasörler
     * kapalıdır. Klasör satırında içindeki dosya sayısı ve toplam boyut.
     */
    __renderFiles(openPaths) {
      const root = { dirs: new Map(), files: [], size: 0, count: 0, path: "" };
      this.__files.forEach(f => {
        const parts = f.rel.split("/");
        let node = root;
        node.size += f.file.size;
        node.count++;
        for (let i = 0; i < parts.length - 1; i++) {
          let child = node.dirs.get(parts[i]);
          if (!child) {
            child = { dirs: new Map(), files: [], size: 0, count: 0, path: parts.slice(0, i + 1).join("/") };
            node.dirs.set(parts[i], child);
          }
          child.size += f.file.size;
          child.count++;
          node = child;
        }
        node.files.push(f);
      });
      this.__fileRoot = root;
      this.__nodePaths = new Map();
      this.__nodeDirs = new Map();
      const dm = this.__fileTree.getDataModel();
      dm.clearData(false);
      this.__addChildren(0, root);
      // Önceden açık olan klasörler (hâlâ varsa) yeniden açılır: üstten alta, içerikleri doldurularak.
      (openPaths || []).slice().sort((a, b) => a.split("/").length - b.split("/").length).forEach(path => {
        const id = [...this.__nodePaths.entries()].find(([nid, p]) => p === path && this.__nodeDirs.has(nid));
        if (id) {
          const dir = this.__nodeDirs.get(id[0]);
          if (dir.dirs.size || dir.files.length) {
            this.__addChildren(id[0], dir);
          }
          dm.setState(id[0], { bOpened: true });
        }
      });
      dm.setData();
      const fmt = tihamon.util.Format.bytes;
      this.__fileInfo.setValue(this.__files.length
        ? `${this.__files.length.toLocaleString("tr-TR")} dosya · ${fmt(root.size)} — sürükleyip bırakarak ekleyebilirsiniz.`
        : "Dosya ya da klasörleri buraya sürükleyip bırakabilirsiniz.");
    },

    /** Bir klasörün doğrudan çocuklarını (önce klasörler, sonra dosyalar; ada göre) ağaca ekler. */
    __addChildren(parentId, node) {
      const dm = this.__fileTree.getDataModel();
      const fmt = tihamon.util.Format.bytes;
      const byName = (a, b) => a.localeCompare(b, "tr", { numeric: true });
      [...node.dirs.keys()].sort(byName).forEach(name => {
        const dir = node.dirs.get(name);
        const id = dm.addBranch(parentId, name, false);
        dm.setColumnData(id, 1, dir.count.toLocaleString("tr-TR"));
        dm.setColumnData(id, 2, fmt(dir.size));
        this.__nodePaths.set(id, dir.path);
        this.__nodeDirs.set(id, dir);
      });
      node.files.slice().sort((a, b) => byName(a.rel, b.rel)).forEach(f => {
        const id = dm.addLeaf(parentId, f.rel.split("/").pop());
        dm.setColumnData(id, 2, fmt(f.file.size));
        this.__nodePaths.set(id, f.rel);
      });
    },

    /** Kapalı klasör ilk kez açılırken içeriği eklenir. */
    __fillNode(nodeId) {
      const dir = this.__nodeDirs.get(nodeId);
      if (dir && (dir.dirs.size || dir.files.length)) {
        this.__addChildren(nodeId, dir);
        this.__fileTree.getDataModel().setData();
      }
    },

    __createLocationSection(parent) {
      parent.add(this.__heading("Konum"));
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

    /**
     * Topla: NEYİN toplanacağı (konum yalnız NEREDEN'i söyler). Üç seçim: konumdaki her şey / yalnız seçilen
     * dosya türleri / adı desene uyanlar; alt klasörlere inme ve kısayolları/gizli dosyaları dışlama.
     * Altındaki özet cümlesi seçimin tamamını düz Türkçe söyler; "Önizle" aktarmadan sayar.
     */
    __createWhatSection(parent) {
      const T = tihamon.ui.files.BulkPanel.TYPES;
      const all = new qx.ui.form.RadioButton("Konumdaki her şey (dosyalar ve klasörler, klasörler içerikleriyle)").set({ model: "all" });
      const types = new qx.ui.form.RadioButton("Yalnız şu türlerdeki dosyalar:").set({ model: "types" });
      const pattern = new qx.ui.form.RadioButton("Adı şu desene uyanlar:").set({ model: "pattern" });
      this.__what = new qx.ui.form.RadioGroup(all, types, pattern);
      parent.add(all);

      const typeRow = new qx.ui.container.Composite(new qx.ui.layout.Flow(10, 2).set({ alignY: "middle" }));
      typeRow.add(types);
      this.__typeBoxes = Object.keys(T).map(key => {
        const cb = new qx.ui.form.CheckBox(T[key][0]).set({ value: key === "docs", toolTipText: T[key][1].join(" ") });
        cb.setUserData("key", key);
        cb.addListener("changeValue", () => {
          if (cb.getValue()) {
            this.__what.setSelection([types]);
          }
          this.__updateWhat();
        });
        typeRow.add(cb);
        return cb;
      });
      parent.add(typeRow);

      const patternRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      patternRow.add(pattern);
      this.__patterns = new qx.ui.form.TextField().set({
        placeholder: "ör. *.pdf  odev*  rapor?.docx",
        toolTipText: "Boşlukla ayrılmış desenler; * herhangi bir metin, ? tek karakter (büyük/küçük harf duyarsız)."
      });
      this.__patterns.addListener("input", () => {
        this.__what.setSelection([pattern]);
        this.__updateWhat();
      });
      patternRow.add(this.__patterns, { flex: 1 });
      parent.add(patternRow);

      const flags = new qx.ui.container.Composite(new qx.ui.layout.HBox(16));
      this.__deep = new qx.ui.form.CheckBox("Alt klasörlerin içindekiler de (klasör yapısı korunur)").set({ value: true });
      this.__skipJunk = new qx.ui.form.CheckBox("Kısayolları (.desktop) ve gizli dosyaları alma").set({
        value: true, toolTipText: "ETAP masaüstündeki uygulama kısayolları ve nokta ile başlayan ayar dosyaları/klasörleri"
      });
      flags.add(this.__deep);
      flags.add(this.__skipJunk);
      parent.add(flags);

      this.__whatText = new qx.ui.basic.Label("").set({ rich: true, wrap: true, textColor: "app-muted" });
      parent.add(this.__whatText);

      this.__what.addListener("changeSelection", this.__updateWhat, this);
      [this.__deep, this.__skipJunk].forEach(cb => cb.addListener("changeValue", this.__updateWhat, this));
      this.__location.addListener("changeSelection", this.__updateWhat, this);
      this.__locationPath.addListener("input", this.__updateWhat, this);
      this.__logged.addListener("changeValue", this.__updateWhat, this);
      this.__what.setSelection([all]);
      this.__updateWhat();
    },

    /** Seçilen "ne"nin sunucuya gidecek biçimi: {patterns, excludes, deep, skip_hidden} ve açıklaması. */
    __whatRequest() {
      const T = tihamon.ui.files.BulkPanel.TYPES;
      const mode = this.__what.getSelection()[0].getModel();
      let patterns = [];
      let what = "konumdaki her şey (klasörler içerikleriyle)";
      if (mode === "types") {
        const keys = this.__typeBoxes.filter(cb => cb.getValue()).map(cb => cb.getUserData("key"));
        patterns = keys.reduce((list, k) => list.concat(T[k][1].map(ext => "*." + ext)), []);
        what = keys.length ? keys.map(k => T[k][0].toLocaleLowerCase("tr")).join(", ") + " dosyaları" : "";
      } else if (mode === "pattern") {
        patterns = (this.__patterns.getValue() || "").split(/[\s,;]+/).filter(Boolean);
        what = patterns.length ? `adı ${patterns.map(p => "“" + p + "”").join(", ")} desenine uyan öğeler` : "";
      }
      const deep = mode !== "all" && this.__deep.getValue();
      const skip = this.__skipJunk.getValue();
      return {
        mode, what, deep,
        body: { patterns, excludes: skip ? ["*.desktop"] : [], deep, skip_hidden: skip }
      };
    },

    __updateWhat() {
      if (!this.__whatText) {
        return;
      }
      const esc = qx.bom.String.escape;
      const w = this.__whatRequest();
      this.__deep.setEnabled(w.mode !== "all");
      const kind = this.__locationKind();
      const loc = kind === "sub" || kind === "abs"
        ? `“${esc((this.__locationPath.getValue() || "").trim() || "…")}”${kind === "sub" ? " (ev dizini altında)" : ""}`
        : this.__location.getSelection()[0].getLabel();
      const who = kind === "abs" ? "" : " seçili kullanıcıların";
      if (!w.what) {
        this.__whatText.setValue(`<span style="color:${this.__color("error")}">` +
          (w.mode === "types" ? "En az bir dosya türü seçin." : "Bir ad deseni yazın.") + "</span>");
        return;
      }
      this.__whatText.setValue(`<b>Toplanacak:</b> her seçili tahtada${who} <b>${esc(loc)}</b> konumundan ` +
        `<b>${esc(w.what)}</b>` + (w.deep ? ", alt klasörlerin içindekiler dahil" : (w.mode === "all" ? "" : " (yalnız konumun kendisindekiler)")) +
        (this.__skipJunk.getValue() ? "; kısayollar ve gizli dosyalar hariç" : "") +
        `. Bu bilgisayara <i>tahta / kullanıcı / …</i> klasör yapısıyla gelir.`);
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
        this.__relay = new qx.ui.form.CheckBox("Köprü tahtalarla dağıt").set({
          value: true, marginLeft: 16,
          toolTipText: "Önerilir. Sunucu dosyaları yalnız birkaç bilgisayara gönderir (sayı sunucunun işlemci/bellek " +
            "durumuna göre belirlenir); diğer bilgisayarlar onları almış bilgisayarlardan çeker. Çok bilgisayara " +
            "büyük dağıtımda sunucunun ağ bağlantısı darboğaz olmaz. Köprüden alınamazsa sunucudan gönderilir."
        });
        row.add(this.__relay);
      } else {
        row.add(new qx.ui.basic.Label("Teslim:"));
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
      if (this.__mode === "collect" && !this.__whatRequest().what) {
        throw new Error("Toplanacak öğeleri belirleyin: en az bir dosya türü seçin ya da bir ad deseni yazın.");
      }
      return { boards, users, location };
    },

    /** @param dry {Boolean} Topla ▸ Önizle: yalnız sayılır, hiçbir şey aktarılmaz/silinmez. */
    async __start(dry) {
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
      if (this.__mode === "collect" && !dry && this.__delivery.getSelection()[0].getModel() === "folder") {
        // Klasör seçici kullanıcı hareketi ister: başka bir await'ten önce açılır.
        this.__dirHandle = await tihamon.ui.files.BulkIo.pickFolder();
        if (!this.__dirHandle) {
          return;
        }
      }
      if (this.__mode === "collect" && !dry && this.__move.getValue()) {
        const ok = await tihamon.ui.Dialog.confirm(
          `<b>Taşıma</b>: ${req.boards.length} tahtada ${where} konumundan alınan öğeler, sunucuya sağ salim ` +
          "aktarıldıktan sonra <b>tahtadan silinecek</b>." +
          (req.location.kind === "home" ? "<br><br>Konum <b>ev dizininin tamamı</b> — gizli ayar dosyaları da taşınır!" : ""),
          "Taşı");
        if (!ok) {
          return;
        }
      }
      // Önceki (bitmiş) toplamanın — ör. önizlemenin — sunucudaki ara dosyaları bırakılır.
      if (this.__job && this.__job.state !== "running" && this.__mode === "collect") {
        tihamon.ui.files.Api.post(`/bulk/${this.__job.id}/discard`, {}).catch(() => null);
      }
      this.__stack.setSelection([this.__stack.getChildren()[1]]);
      this.__cancelled = false;
      this.__cancelButton.setEnabled(true);
      this.__report.setVisibility("excluded");
      this.__events.setHtml("");
      this.__table.getTableModel().setData([]);
      this.__table.setVisibility("visible");
      this.__tree.setVisibility("excluded");
      this.__lastJson = null;
      this.__speed = null;
      this.__job = null;
      try {
        let res;
        if (this.__mode === "distribute") {
          this.__upload = {};
          this.__lastReq = req;
          res = await this.__uploadAndDistribute(req);
        } else {
          this.__phase.setValue(dry ? "Önizleme: tahtalarda neyin toplanacağı sayılıyor (hiçbir şey aktarılmaz)…" : "Toplanıyor…");
          res = await tihamon.ui.files.Api.post("/bulk/collect", Object.assign(req, this.__whatRequest().body, {
            move: this.__move.getValue(), dry: !!dry
          }));
        }
        this.__job = { id: res.id, state: "running" };
      } catch (e) {
        if (e.aborted) {
          this.__askAfterCancel("upload");
          return;
        }
        this.__phase.setValue(`<span style="color:${this.__color("error")}">${esc(e.message)}</span>`);
        this.__finishUi(null);
        return;
      }
      this.__startPolling();
    },

    /** Dağıt: dosyaları yükler (kesilmişse kaldığı dosyadan sürer — bkz. BulkIo.upload) ve işi başlatır. */
    async __uploadAndDistribute(req) {
      const fmt = tihamon.util.Format.bytes;
      this.__phase.setValue("Dosyalar sunucuya yükleniyor…");
      const token = await tihamon.ui.files.BulkIo.upload(this.__files, (done, total) => {
        this.__bar.setValue(total ? Math.floor((done / total) * 100) : 100);
        this.__progressText.setValue(`Yükleme: ${fmt(done)} / ${fmt(total)}`);
      }, this.__upload);
      this.__upload = null;
      this.__phase.setValue("Dağıtılıyor…");
      return tihamon.ui.files.Api.post("/bulk/distribute", Object.assign({}, req, {
        token, conflict: this.__conflict.getSelection()[0].getModel(), relay: this.__relay.getValue()
      }));
    },

    __startPolling() {
      this.__stopPolling();
      this.__timer = new qx.event.Timer(700);
      this.__timer.addListener("interval", this.__poll, this);
      this.__timer.start();
      this.__poll();
    },

    /**
     * Dağıt'ta İptal'den sonra (iş anında durdurulmuştur): sürdür / kopyalananlar kalsın / kopyalananları sil.
     * @param phase {String} "upload" (tahtalara henüz bir şey gitmedi) | "job" (tahtalara kopyalama sürüyordu)
     */
    __askAfterCancel(phase) {
      const win = tihamon.ui.Dialog.window("Dağıtma durduruldu", 520);
      let text;
      if (phase === "upload") {
        const n = this.__upload ? this.__upload.index || 0 : 0;
        text = `Dosyalar sunucuya yüklenirken durduruldu (${n} / ${this.__files.length} dosya yüklendi).<br>` +
          "Tahtalara henüz hiçbir şey kopyalanmadı.";
      } else {
        const rows = this.__job ? this.__job.boards : [];
        const done = rows.filter(b => ["done", "partial"].includes(b.state)).length;
        const half = rows.filter(b => b.targets.some(t => (t.created || []).length) && !["done", "partial"].includes(b.state)).length;
        const rest = rows.length - done;
        text = `Kopyalama durduruldu: <b>${done}</b> tahtada tamamlandı, <b>${rest}</b> tahtada yarıda kaldı ya da başlamadı` +
          (half ? ` (${half} tahtada bir kısmı kopyalanmıştı)` : "") + ".<br><br>" +
          "<b>Kopyalananları sil</b> yalnız bu işin oluşturduğu dosya/klasörleri siler; hedefte önceden var olan " +
          "aynı adlı öğelere dokunulmaz (üzerine yazılmışlarsa eski hâlleri geri gelmez).";
      }
      win.add(new qx.ui.basic.Label(text).set({ rich: true, wrap: true }));
      let choice = "keep";
      const button = (label, value, primary) => {
        const b = new qx.ui.form.Button(label).set(primary ? { font: "bold" } : {});
        b.addListener("execute", () => {
          choice = value;
          win.close();
        });
        return b;
      };
      const buttons = phase === "upload"
        ? [button("Durdur", "keep"), button("Devam et", "resume", true)]
        : [button("Kopyalananları sil", "revert"), button("Kopyalananlar kalsın", "keep"), button("Devam et", "resume", true)];
      tihamon.ui.Dialog.buttons(win, buttons);
      win.addListener("close", () => this.__afterCancelChoice(phase, choice));
      win.open();
    },

    async __afterCancelChoice(phase, choice) {
      const esc = qx.bom.String.escape;
      if (choice === "resume") {
        this.__cancelled = false;
        this.__cancelButton.setEnabled(true);
        this.__report.setVisibility("excluded");
        try {
          if (phase === "upload") {
            const res = await this.__uploadAndDistribute(this.__lastReq);
            this.__job = { id: res.id, state: "running" };
          } else {
            await tihamon.ui.files.Api.post(`/bulk/${this.__job.id}/resume`, {});
            this.__job.state = "running";
            this.__phase.setValue("Sürdürülüyor…");
          }
        } catch (e) {
          if (e.aborted) {
            this.__askAfterCancel("upload");
            return;
          }
          this.__phase.setValue(`<span style="color:${this.__color("error")}">${esc(e.message)}</span>`);
          this.__finishUi(this.__job && this.__job.boards ? this.__job : null);
          return;
        }
        this.__lastJson = null;
        this.__startPolling();
        return;
      }
      if (phase === "upload") {
        this.__upload = null;
        this.__phase.setValue(`<span style="color:${this.__color("app-warn")}">Durduruldu</span> — tahtalara bir şey kopyalanmadı`);
        this.__finishUi(null);
        return;
      }
      if (choice === "revert") {
        this.__phase.setValue("Kopyalananlar hedeflerden siliniyor…");
        try {
          const res = await tihamon.ui.files.Api.post(`/bulk/${this.__job.id}/revert`, {});
          const job = await tihamon.ui.files.Api.request("GET", `/bulk/${this.__job.id}`);
          this.__job = job;
          this.__renderRows(job);
          this.__renderEvents(job);
          this.__phase.setValue(`<span style="color:${this.__color("app-warn")}">Durduruldu ve geri alındı</span> — ` +
            `${res.boards} tahtada ${res.removed} öğe silindi` +
            (res.failed ? `, <span style="color:${this.__color("error")}">${res.failed} tahtada silinemedi</span>` : ""));
        } catch (e) {
          tihamon.ui.Dialog.error(e);
        }
      }
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
      // Önizlemede tablo yerine dosya ağacı: bilgisayar ▸ kullanıcı (ikisi açık) ▸ klasörler (kapalı) ▸ dosyalar.
      this.__tree = new qx.ui.tree.Tree().set({ hideRoot: true, visibility: "excluded", openMode: "tap" });
      page.add(this.__tree, { flex: 1 });

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

    /**
     * İptal HEMEN uygulanır: yükleme sürüyorsa o anki istek kesilir; tahtalara kopyalama sürüyorsa sunucu
     * süreçleri (tahtadakiler dahil) durdurur. Dağıt'ta ardından ne yapılacağı sorulur (bkz. __askAfterCancel).
     */
    async __cancel() {
      this.__cancelled = true;
      this.__cancelButton.setEnabled(false);
      if (this.__upload && !this.__job) {
        this.__phase.setValue("Yükleme durduruluyor…");
        tihamon.ui.files.BulkIo.abortUpload(this.__upload);   // __start / __afterCancelChoice soruyu açar
        return;
      }
      if (this.__job && this.__job.state === "running") {
        this.__phase.setValue("Durduruluyor…");
        this.__askOnStop = this.__mode === "distribute";
        try {
          await tihamon.ui.files.Api.post(`/bulk/${this.__job.id}/cancel`, {});
        } catch (e) {
          this.__askOnStop = false;
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
        if (this.__askOnStop && job.state === "cancelled") {
          this.__askOnStop = false;
          this.__askAfterCancel("job");
        }
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
      parts.push(fmt(job.bytes) + (this.__mode === "distribute" ? " gönderildi" : job.options.dry ? " bulundu" : " alındı"));
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

    /**
     * Önizleme ağacı: her bilgisayar ve altındaki kullanıcı (konum) düğümleri açık gelir; onların içindeki
     * klasörler kapalı (içerikleri tıklayınca açılır). Etiketlerde boyut (klasörde içindekilerin toplamı).
     */
    __renderTree(job) {
      const T = qx.ui.tree;
      const fmt = tihamon.util.Format.bytes;
      const old = this.__tree.getRoot();
      const root = new T.TreeFolder("");
      root.setOpen(true);
      const addNodes = (parent, node) => {
        [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr")).forEach(([name, child]) => {
          const folder = new T.TreeFolder(`${name}  —  ${fmt(child.size)} · ${child.count} dosya`);
          parent.add(folder);
          addNodes(folder, child);
        });
        node.files.sort((a, b) => a[0].localeCompare(b[0], "tr")).forEach(([name, size]) =>
          parent.add(new T.TreeFile(`${name}  —  ${fmt(size)}`)));
      };
      job.boards.forEach(b => {
        const targets = b.targets.filter(t => t.tree && t.tree.length);
        const total = targets.reduce((n, t) => n + (t.total || 0), 0);
        const boardNode = new T.TreeFolder(targets.length ? `${b.name}  —  ${fmt(total)}` : `${b.name}  —  ${b.message}`);
        boardNode.setOpen(true);
        root.add(boardNode);
        targets.forEach(t => {
          const tree = { dirs: new Map(), files: [], size: 0, count: 0 };
          t.tree.forEach(([rel, size]) => {
            const parts = rel.split("/");
            let node = tree;
            parts.slice(0, -1).forEach(part => {
              if (!node.dirs.has(part)) {
                node.dirs.set(part, { dirs: new Map(), files: [], size: 0, count: 0 });
              }
              node = node.dirs.get(part);
              node.size += size;
              node.count++;
            });
            node.files.push([parts[parts.length - 1], size]);
          });
          const userNode = new T.TreeFolder(`${t.user || t.dir}  (${t.dir})  —  ${fmt(t.total || 0)} · ${t.items} öğe`);
          userNode.setOpen(true);
          boardNode.add(userNode);
          addNodes(userNode, tree);
          if (t.tree_more) {
            userNode.add(new T.TreeFile(`… ve ${t.tree_more} dosya daha (önizlemede gösterilmedi)`));
          }
        });
      });
      this.__tree.setRoot(root);
      if (old) {
        old.destroy();
      }
      this.__table.setVisibility("excluded");
      this.__tree.setVisibility("visible");
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
      if (job.options && job.options.dry) {
        const items = targets.reduce((n, t) => n + (t.items || 0), 0);
        const bytes = targets.reduce((n, t) => n + (t.state === "ok" ? t.total || 0 : 0), 0);
        this.__phase.setValue(`<span style="color:${color}">Önizleme hazır</span> — hiçbir şey aktarılmadı`);
        this.__renderTree(job);
        this.__reportText.setValue(`<b>Önizleme</b>: ${ok} kullanıcıda toplam <b>${items} öğe, ` +
          `${tihamon.util.Format.bytes(bytes)}</b> toplanacak · ${esc(job.options.what_text)} · konum: ${esc(job.options.location_text)}`);
        this.__finishUi(job);
        return;
      }
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
        const hasData = job.kind === "collect" && !job.options.dry && job.boards.some(b => b.targets.some(t => t.state === "ok"));
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
        if (job.options && job.options.dry) {
          button("Bu seçimle topla", () => this.__start(false));
        }
        button("Raporu kaydet (CSV)", () => this.__saveReport(job));
      }
      button(job && job.options && job.options.dry ? "Seçime dön" : "Yeni işlem", () => {
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
