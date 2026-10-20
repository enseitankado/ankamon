/**
 * Ana kabuk: üst başlık, solda ağaç menü (genişliği sürüklenir, ☰ ile katlanır), sayfa yığını ve
 * en altta arka plan işlemleri durum çubuğu.
 *
 * Ağaçta tahta başına düğüm yoktur — tahta listesi, seçim ve sağ-tık işlemleri (Web terminal,
 * Komut çalıştır, Kapat/Uyandır) Tahtalar sayfasının kendi grid'inde (satır başı onay kutuları +
 * satır sağ menüsü) yapılır; bkz. page.Boards. Ağaç yalnız sayfalar arasında gezinir.
 *
 * Düğüm "simgeleri" resim değil, etiketin başına eklenen Unicode karakterdir (bkz. ICON):
 * qx.ui.table.cellrenderer.Boolean'da yaşanan sorunla aynı kökten, bu derlenmiş build'de
 * background-image tabanlı simgelerin URL'si yalnızca aynı ikon birden fazla yerde kullanılınca
 * doğru ("/resource/..." önekli) üretiliyor; tek kullanımlı simgeler kırık kalıyor
 * (`@asset(qx/icon/Tango/16/*)` eklemek bundling'i tamamladı ama bu URL hatasını düzeltmedi).
 * Metin tabanlı simge hiçbir kaynağa bağımlı olmadığından her tarayıcıda güvenilir çalışır.
 */
qx.Class.define("tihamon.ui.Shell", {
  extend: qx.ui.container.Composite,

  construct(user) {
    super(new qx.ui.layout.Dock());
    this.__user = user;
    this.__pages = {};
    this.__scrolls = {};
    this.setBackgroundColor("app-background");

    this.add(this.__createHeader(), { edge: "north" });

    const split = new qx.ui.splitpane.Pane("horizontal");
    // Genişlik kullanıcı başına sunucuda (users.ui_prefs["nav.width"], bkz. AuthApi::prefs; aşağıdaki
    // changeWidth dinleyicisi).
    const prefs = user.ui_prefs || (user.ui_prefs = {});
    const NAV = tihamon.ui.Shell;
    const navWidth = Math.min(NAV.NAV_MAX, Math.max(NAV.NAV_MIN, Number(prefs["nav.width"]) || NAV.NAV_DEFAULT));
    this.__navPane = new qx.ui.container.Composite(new qx.ui.layout.Grow()).set({ width: navWidth });
    this.__navPane.add(this.__createTree());
    this.__stack = new qx.ui.container.Stack().set({ padding: 10 });
    // flex ÇIPLAK SAYI olarak verilemez (qx.ui.core.Widget.__addHelper options'ı doğrudan
    // setLayoutProperties()'e geçirir, obje bekler) — bare "1" sessizce yok sayılıyordu, Stack
    // hiç flex almıyordu; bu da SplitPane'in dar pencerede navPane+stack toplamını (daralmayan
    // sabit 250 + stack'in kendi doğal genişliği) viewport'tan taşırmasına yol açıyordu.
    // qx.ui.splitpane.Pane.add(widget, flex) kendi sarmalayıcısına sahiptir ve ikinci parametre
    // olarak ÇIPLAK SAYI bekler (genel Widget.add()'ın aksine) — obje verilirse {flex:{flex:N}} gibi
    // çift sarmalanıp flex'i etkisizleştirir (bkz. qx/ui/splitpane/Pane.js: add(widget, flex)).
    split.add(this.__navPane, 0);
    split.add(this.__stack, 1);
    // Ayırıcı bırakılınca SplitPane._finalizeSizes navPane.setWidth() çağırır → changeWidth (pointerup
    // olayı ayırıcının kendi katmanında durdurulur, Pane'e ulaşmaz). Pencere daralınca yalnız yerleşim
    // küçülür, width özelliği değişmez — o yüzden kaydedilmez.
    this.__navPane.addListener("changeWidth", e => {
      const width = e.getData();
      if (width && width !== prefs["nav.width"]) {
        prefs["nav.width"] = width;
        tihamon.io.Api.put("/auth/prefs", { key: "nav.width", value: width }).catch(() => {
          // Kalıcılık kaybı önemsiz: bir sonraki sürüklemede yeniden gönderilir.
        });
      }
    });
    this.add(split, { edge: "center" });

    this.add(new tihamon.ui.StatusBar(), { edge: "south" });

    // Bilerek yapılan yeniden yüklemeden (ör. Ayarlar'da tema değişimi) sonra aynı sayfaya dönülür
    // (kullanıcı isteği) — tek seferlik kayıt, okununca silinir; yoksa/izinsizse ağaçtaki ilk sayfa.
    let reopen = null;
    try {
      reopen = sessionStorage.getItem(tihamon.ui.Shell.REOPEN_KEY);
      sessionStorage.removeItem(tihamon.ui.Shell.REOPEN_KEY);
    } catch (e) {
      // sessionStorage erişilemiyor — ilk sayfaya düş.
    }
    const reopenPage = reopen && tihamon.ui.Shell.PAGES.find(p => p.id === reopen);
    if (reopenPage && this.__allowed(reopenPage)) {
      this.__openPage({ page: reopen });
    } else {
      const first = this.__nodes[0];
      if (first) {
        this.__tree.setSelection([first]);
      }
    }

    // Tahtalar grid'inin satır menüsündeki "Logları göster" buradan tetiklenir (bkz. page.Boards
    // __rowMenu) — sayfa nesnesine doğrudan referansı olmadığından mesaj veriyoluyla haberleşir.
    qx.event.message.Bus.subscribe(tihamon.ui.Shell.OPEN_LOGS, msg => this.__openLogsForBoard(msg.getData()));
    // StatusBar'ın sağ menüsündeki "Sistem logları"/"Komut logları" buradan tetiklenir — tahta
    // süzgeci olmadan, yalnız ilgili moda geçer (bkz. __openLogsForBoard'daki tahtalı benzeri).
    qx.event.message.Bus.subscribe(tihamon.ui.Shell.OPEN_LOGS_MODE, msg => this.__openLogsMode(msg.getData()));
    // Genel bakış kartları (bkz. page.Dashboard __target) buradan sayfa/pencere açar.
    qx.event.message.Bus.subscribe(tihamon.ui.Shell.OPEN_PAGE, msg => this.__openPage(msg.getData()));
  },

  statics: {
    /** sessionStorage anahtarı: yeniden yüklemeden sonra açılacak sayfanın kimliği (bkz. construct). */
    REOPEN_KEY: "tihamon.reopenPage",

    // Sol menü genişliği (piksel): varsayılan ve kayıtlı değerin uygulanacağı sınırlar.
    NAV_DEFAULT: 250,
    NAV_MIN: 150,
    NAV_MAX: 600,
    // Kullanıcı henüz açıp kapatmadıysa KAPALI başlayan klasörler (kullanıcı isteği); bkz. __rememberOpen.
    NAV_FOLDED: ["boards", "network", "system"],

    // Metin tabanlı düğüm simgeleri (bkz. sınıf başı not). Boş: belirgin bir simge gerekmiyor.
    ICON: {
      dashboard: "◈", boards: "▭", logs: "▤", sessions: "♙", metrics: "∿", users: "◉", settings: "⚙",
      webshell: "▭", screen: "▣", screenControl: "🖱", reboot: "↻", filemanager: "▦", run: "▸", shutdown: "■", wol: "▲", edit: "✎", delete: "✕",
      info: "ℹ", backup: "⬇", copy: "⧉", distribute: "⇉", collect: "⇇", bulk: "⇄", cast: "⇪", logout: "⏏", lock: "🔒", diagnose: "⚕", system: "⚒", diskusage: "⛁",
      network: "⇆", subnet: "▫", taskmgr: "☷"
    },

    // Uzaktan işlemler kaldırıldı; işlevi Tahtalar sayfasına ve ağaç sağ menülerine taşındı.
    //
    // "sessions" (Oturumlar): tahtalarda greeter ile oturum açan GERÇEK kullanıcıların kaydı
    // (bkz. page.Sessions) — "users" (Kullanıcılar, Tiha-Mon'un KENDİ arayüz hesapları, yalnız
    // admin) ile KARIŞTIRILMASIN diye bilerek ayrı/farklı adda bir sayfa; "logs" yetkisini paylaşır
    // (log'lardan türetilen veri olduğundan).
    PAGES: [
      // retap: ağaçta zaten seçili düğüme yeniden tıklamak sayfayı yeniler (sayfada "Yenile" düğmesi yok).
      { id: "dashboard", label: "Genel bakış", feature: "dashboard", retap: true, create: u => new tihamon.page.Dashboard(u) },
      { id: "boards", label: "Tahtalar", feature: "boards", create: u => new tihamon.page.Boards(u) },
      // parent: ağaçta o sayfanın düğümünün ALTINDA (kullanıcı isteği: tahtalarla ilgili sayfalar
      // "Tahtalar"ın altında). Üst sayfa kullanıcıya kapalıysa kökte gösterilir — bkz. __createTree.
      { id: "sessions", label: "Oturumlar", feature: "logs", parent: "boards", create: u => new tihamon.page.Sessions(u) },
      // Bakım: "Bakım" (sorun tespiti) + "Sensörler" (Grafana) sekmeleri — bkz. page.Maintenance. features:
      // herhangi biri yeterli (sekme başına yetki sayfanın içinde). Sensörler ayrı menü öğesi DEĞİL (kullanıcı
      // isteği); eski {page: "metrics"} bağlantıları __openPage'de buraya yönlenir. id "diagnose" kalır
      // (nav_order / nav.open kayıtları). Oturumlar'ın altında (kullanıcı isteği).
      { id: "diagnose", label: "Bakım", features: ["diagnose", "metrics"], parent: "boards", create: u => new tihamon.page.Maintenance(u) },
      // Loglar Tahtalar'ın altında EN SONDA (kullanıcı isteği).
      { id: "logs", label: "Loglar", feature: "logs", parent: "boards", create: u => new tihamon.page.Logs(u) },
      // Ağ envanteri: altında sunucunun bağlı olduğu fiziksel ağlar (dinamik, bkz. __fillNetworks).
      { id: "network", label: "Ağ", feature: "network", create: u => new tihamon.page.Network(u) },
      // Tiha-Mon'un kendi bakımı (servisler, zamanlanmış işler, veritabanı, yapılandırma) — yalnız yönetici.
      { id: "system", label: "Sistem", admin: true, retap: true, create: u => new tihamon.page.System(u) },
      // Kullanıcılar ve Ayarlar "Sistem"in altında (kullanıcı isteği).
      // Disk kullanımı ve veri silme (eski açılır pencere — kullanıcı isteği: Sistem altında sayfa).
      { id: "diskusage", label: "Disk kullanımı", feature: "logs.manage", parent: "system", retap: true, create: u => new tihamon.page.DiskUsage(u) },
      // Kullanıcılar ▸ Kullanıcılar (yalnız yönetici) + Oturumlar ('logins'): features yöneticide her zaman
      // sağlanır; 'logins' yetkili kullanıcı sayfayı yalnız Oturumlar sekmesiyle görür (bkz. page.Users).
      { id: "users", label: "Kullanıcılar", features: ["logins"], parent: "system", create: u => new tihamon.page.Users(u) },
      // admin/feature yok: herkese açık (kendi tema tercihini herkes değiştirebilir); sayfa içinde
      // sistem ayarları (SSH/Samba/keşif) yalnız admin'e gösterilir — bkz. page.Settings. Sistem
      // yalnız yöneticiye açık olduğundan diğer kullanıcılarda kökte görünür (bkz. __createTree).
      { id: "settings", label: "Ayarlar", parent: "system", create: u => new tihamon.page.Settings(u) }
    ],
    LOG_KINDS: [
      { label: "Sistem logları", mode: "system" },
      { label: "Komut logları", mode: "command" }
    ],

    // Boards grid'inin satır menüsü ve Genel bakış'ın hata/görev satırları, Loglar sayfasını bir tahtaya
    // süzülmüş açmak için bu mesajı yayınlar (payload: board id ya da {boardId, severity}) — bkz.
    // construct()'taki subscribe ve __openLogsForBoard.
    OPEN_LOGS: "tihamon.openLogs",
    // StatusBar'ın sağ menüsü, Loglar sayfasını tahta süzgeci olmadan belirli bir modda açmak için
    // bu mesajı yayınlar (payload: "system"|"command") — bkz. __openLogsMode.
    OPEN_LOGS_MODE: "tihamon.openLogsMode",
    // {page: "boards"|"metrics"|"system", ...} sayfayı açar, kalan alanları sayfanın openWith()'ine
    // verir; {diskUsage: "metrics"|"queue"|"backups"|…} ise Disk kullanımı sayfasını o sekmede açar.
    OPEN_PAGE: "tihamon.openPage"
  },

  members: {
    __user: null,
    __pages: null,
    __scrolls: null,
    __stack: null,
    __tree: null,
    __navPane: null,
    __nodes: null,
    __revealing: false,
    __silentTree: false,
    __justSelected: null,
    __dragItem: null,
    __networkFolder: null,
    __networkTimer: null,

    /**
     * Ağaç düğümünün temadan gelen klasör/dosya resmini gizler: düğümde yalnız etiketteki kendi
     * Unicode simgesi kalır (kullanıcı isteği; bkz. ICON). icon=null ile değil child control'ü
     * dışlayarak: tema "opened" durumunda simgeyi kendisi yeniden atıyor, görünürlüğe ise dokunmuyor.
     */
    __hideThemeIcon(item) {
      item.getChildControl("icon").exclude();
    },

    __can(feature) {
      return this.__user.is_admin || this.__user.features.includes(feature);
    },

    __allowed(page) {
      if (page.admin) {
        return this.__user.is_admin;
      }
      if (page.features) {
        return page.features.some(feature => this.__can(feature));
      }
      if (!page.feature) {
        return true; // ne admin ne feature: herkese açık sayfa (ör. Ayarlar — bkz. PAGES)
      }
      return this.__can(page.feature);
    },

    /**
     * İzin verilen sayfaları kullanıcının kayıtlı sırasına (bkz. nav_order) göre dizer: önce kayıtlı
     * sıradaki id'ler o sırayla, ardından kayıtta hiç olmayanlar (yeni eklenen sayfa ya da kullanıcı
     * hiç sıralamadıysa hepsi) PAGES'teki varsayılan sırayla sona eklenir.
     */
    __orderedPages(pages) {
      const byId = {};
      pages.forEach(p => { byId[p.id] = p; });
      const ordered = [];
      (this.__user.nav_order || []).forEach(id => {
        if (byId[id]) {
          ordered.push(byId[id]);
          delete byId[id];
        }
      });
      pages.forEach(p => { if (byId[p.id]) { ordered.push(p); } });
      return ordered;
    },

    __createTree() {
      this.__tree = new qx.ui.tree.Tree().set({
        hideRoot: true,
        // Kök gizliyken birinci düzey klasörlerin (Tahtalar, Ağ, Sistem) aç/kapa oku yalnız bununla
        // çizilir; katlanabilirlik görünür olsun (kullanıcı isteği — durum __rememberOpen'da saklanır).
        rootOpenClose: true,
        backgroundColor: "app-nav",
        decorator: new qx.ui.decoration.Decorator().set({ widthRight: 1, color: "app-border" })
      });
      const root = new qx.ui.tree.TreeFolder("root");
      this.__tree.setRoot(root);

      // __nodes: yalnız KÖK düğümler (sürükle-bırak sırası, nav_order). Alt düğümler (PAGES parent)
      // üstlerinin altında PAGES'teki sabit sırayla durur; sıralanamaz.
      this.__nodes = [];
      const allowed = tihamon.ui.Shell.PAGES.filter(page => this.__allowed(page));
      const nested = page => !!page.parent && allowed.some(p => p.id === page.parent);
      this.__orderedPages(allowed.filter(page => !nested(page))).forEach(page => {
        const node = this.__buildNode(page, allowed.filter(child => nested(child) && child.parent === page.id));
        root.add(node);
        this.__nodes.push(node);
      });
      this.__nodes.forEach(item => this.__makeReorderable(item));

      this.__tree.addListener("changeSelection", e => {
        const item = e.getData()[0];
        if (this.__silentTree || !item || !item.getUserData("page")) {
          return;
        }
        this.__justSelected = item; // bkz. __addRetap
        qx.event.Timer.once(() => { this.__justSelected = null; }, this, 600);
        if (item.getUserData("page").id === "network") {
          // "Ağ" kökü: bütün ağlar (0); alt düğüm: o ağ. Sayfa gösterilmeden önce (tek yenileme).
          this.__widget(item.getUserData("page")).setNetwork(item.getUserData("network") || 0);
        }
        const widget = this.__open(item.getUserData("page"));
        const mode = item.getUserData("mode");
        if (mode && widget.setMode) {
          widget.setMode(mode);
        }
      });
      return this.__tree;
    },

    /**
     * Klasör düğümünün açık/kapalı durumu kullanıcı başına sunucuda (users.ui_prefs["nav.open"] =
     * {sayfa id: bool}, bkz. AuthApi::prefs — menü genişliği "nav.width" ile aynı yol): girişte
     * uygulanır (kayıt yoksa NAV_FOLDED'dakiler kapalı, diğerleri açık), kullanıcı katlayıp açtıkça
     * kaydedilir.
     */
    __rememberOpen(folder, id) {
      const prefs = this.__user.ui_prefs || (this.__user.ui_prefs = {});
      const saved = (prefs["nav.open"] || {})[id];
      folder.setOpen(saved === undefined ? !tihamon.ui.Shell.NAV_FOLDED.includes(id) : !!saved);
      folder.addListener("changeOpen", e => {
        if (this.__revealing) {
          return; // bkz. __reveal: gezinme için açılış kullanıcı tercihi sayılmaz
        }
        const open = { ...(prefs["nav.open"] || {}), [id]: e.getData() };
        prefs["nav.open"] = open;
        tihamon.io.Api.put("/auth/prefs", { key: "nav.open", value: open }).catch(() => {});
      });
    },

    /**
     * Program bir alt düğümü seçerken (Genel bakış bağlantısı, "Logları göster") kapalı üst klasörleri
     * açar ki seçim görünsün; bu açılış kullanıcının katlama tercihi olarak KAYDEDİLMEZ.
     */
    __reveal(item) {
      this.__revealing = true;
      try {
        for (let p = item.getParent(); p && p !== this.__tree.getRoot(); p = p.getParent()) {
          p.setOpen(true);
        }
      } finally {
        this.__revealing = false;
      }
    },

    /** Bir sayfanın ağaç düğümü: alt sayfaları varsa klasör (kendisine tıklamak yine sayfayı açar). */
    __buildNode(page, children) {
      if (page.id === "logs") {
        return this.__buildLogsNode(page);
      }
      if (page.id === "network") {
        return this.__buildNetworkNode(page);
      }
      const label = `${tihamon.ui.Shell.ICON[page.id] || ""} ${page.label}`.trim();
      const node = children.length ? new qx.ui.tree.TreeFolder(label) : new qx.ui.tree.TreeFile(label);
      this.__hideThemeIcon(node);
      node.setUserData("page", page);
      if (page.retap) {
        this.__addRetap(node);
      }
      if (children.length) {
        children.forEach(child => node.add(this.__buildNode(child, [])));
        this.__rememberOpen(node, page.id);
      }
      return node;
    },

    __buildLogsNode(page) {
      const folder = new qx.ui.tree.TreeFolder(`${tihamon.ui.Shell.ICON.logs} ${page.label}`);
      this.__hideThemeIcon(folder);
      folder.setUserData("page", page);
      tihamon.ui.Shell.LOG_KINDS.forEach(kind => {
        const leaf = new qx.ui.tree.TreeFile(kind.label);
        this.__hideThemeIcon(leaf);
        leaf.setUserData("page", page);
        leaf.setUserData("mode", kind.mode);
        folder.add(leaf);
      });
      this.__rememberOpen(folder, page.id);
      return folder;
    },

    /**
     * "Ağ" klasörü: alt düğümleri sunucunun bağlı olduğu (ve daha önce bağlı olduğu) ağlardır, sayfa
     * açılmasa da 60 sn'de bir; Ağ sayfası açıkken her liste tazelenişinde güncellenir.
     */
    __buildNetworkNode(page) {
      const folder = new qx.ui.tree.TreeFolder(`${tihamon.ui.Shell.ICON.network} ${page.label}`);
      this.__hideThemeIcon(folder);
      folder.setUserData("page", page);
      this.__rememberOpen(folder, page.id);
      this.__networkFolder = folder;
      qx.event.message.Bus.subscribe(tihamon.ui.network.Ops.NETWORKS_CHANGED, msg => this.__fillNetworks(msg.getData().networks));
      this.__networkTimer = new qx.event.Timer(60000);
      this.__networkTimer.addListener("interval", this.__loadNetworks, this);
      this.__networkTimer.start();
      this.__loadNetworks();
      return folder;
    },

    async __loadNetworks() {
      try {
        const data = await tihamon.io.Api.get("/network");
        this.__fillNetworks(data.networks);
      } catch (e) {
        // geçici hata: bir sonraki turda yeniden denenir
      }
    },

    /** Ağ alt düğümlerini yerinde günceller (seçim korunur); kaybolan ağın düğümü seçiliyse kök seçilir. */
    __fillNetworks(networks) {
      const folder = this.__networkFolder;
      if (!folder) {
        return;
      }
      const Ops = tihamon.ui.network.Ops;
      const page = folder.getUserData("page");
      const byId = new Map(folder.getChildren().map(leaf => [leaf.getUserData("network"), leaf]));
      const manage = this.__can("network.manage");
      networks.forEach((net, index) => {
        let leaf = byId.get(net.id);
        byId.delete(net.id);
        if (!leaf) {
          leaf = new qx.ui.tree.TreeFile("");
          this.__hideThemeIcon(leaf);
          leaf.setUserData("page", page);
          leaf.setUserData("network", net.id);
          folder.addAt(leaf, index);
        }
        leaf.setLabel(`${tihamon.ui.Shell.ICON.subnet} ${Ops.networkLabel(net)} (${net.online}/${net.devices})` +
          (net.attached ? "" : " — bağlı değil"));
        leaf.setToolTipText(`${net.cidr} · arabirim: ${(net.ifaces || []).join(", ") || "—"} · ağ geçidi: ${net.gateway || "—"}` +
          ` · ${net.online} çevrim içi / ${net.devices} cihaz` + (net.scan_enabled ? "" : " · tarama kapalı"));
        if (manage) {
          const old = leaf.getContextMenu();
          leaf.setContextMenu(Ops.networkMenu(net, () => {
            this.__loadNetworks();
            const widget = this.__pages.network;
            if (widget) {
              widget.refresh();
            }
          }));
          if (old) {
            old.dispose();
          }
        }
      });
      byId.forEach(leaf => {
        if (this.__tree.isSelected(leaf)) {
          this.__tree.setSelection([folder]);
        }
        folder.remove(leaf);
        leaf.dispose();
      });
    },

    /**
     * Ana düğümü sürüklenebilir/bırakılabilir yapar (bkz. qx.ui.core.Widget draggable/droppable
     * özellikleri — her Widget'ta yerleşik). Bırakılan düğüm, üzerine bırakıldığı düğümün YERİNE
     * geçer (öncesine taşınır); yeni sıra kullanıcı adına sunucuda saklanır (bkz. __saveNavOrder).
     */
    __makeReorderable(item) {
      item.set({ draggable: true, droppable: true });
      item.addListener("dragstart", e => {
        e.addAction("move");
        this.__dragItem = item;
      });
      item.addListener("dragend", () => {
        this.__dragItem = null;
      });
      item.addListener("dragover", e => {
        // preventDefault burada "bırakmaya izin ver" demek (yerleşik HTML5 DnD terimi) — kendi
        // üzerine bırakma hariç her zaman izin verilir.
        if (this.__dragItem && this.__dragItem !== item) {
          e.preventDefault();
        }
      });
      item.addListener("drop", () => {
        const dragged = this.__dragItem;
        if (!dragged || dragged === item) {
          return;
        }
        const order = this.__nodes.filter(n => n !== dragged);
        order.splice(order.indexOf(item), 0, dragged);
        this.__nodes = order;
        this.__tree.getRoot().add(...order); // add() zaten-ebeveynli öğeyi önce oradan söker.
        this.__saveNavOrder();
      });
    },

    /** Yeni ana düğüm sırasını kullanıcı adına kalıcı olarak kaydeder (oturumdan bağımsız). */
    __saveNavOrder() {
      const order = this.__nodes.map(n => n.getUserData("page").id);
      tihamon.io.Api.put("/auth/nav-order", { order }).catch(() => {});
    },

    /**
     * Zaten seçili düğüme tıklamak changeSelection üretmez; "tap" ile yakalanır ve sayfa yenilenir.
     * Seçimi az önce değiştiren tıklamanın kendi tap'i atlanır (changeSelection zaten activate etti).
     */
    __addRetap(leaf) {
      leaf.addListener("tap", () => {
        if (this.__justSelected === leaf) {
          this.__justSelected = null;
          return;
        }
        const widget = this.__pages[leaf.getUserData("page").id];
        if (widget && this.__tree.isSelected(leaf)) {
          widget.refresh();
        }
      });
    },

    /** Bkz. OPEN_PAGE. Ağaçtaki vurgu da açılan sayfaya taşınır (sessizce — çift yenileme olmasın). */
    __openPage(data) {
      if (data.diskUsage) {
        data = { page: "diskusage", tab: data.diskUsage }; // Disk kullanımı sayfası, o sekmede
      }
      if (data.page === "metrics") {
        data = { ...data, page: "diagnose", tab: "metrics" }; // Sensörler artık Bakım'ın sekmesi
      }
      const page = tihamon.ui.Shell.PAGES.find(p => p.id === data.page);
      if (!page || !this.__allowed(page)) {
        return;
      }
      // Alt düğümler de aranır (ör. "Tahtalar" altındaki "Loglar" klasörü); kip yaprakları hariç.
      const leaf = this.__tree.getRoot().getItems(true).find(n => n.getUserData("page") === page && !n.getUserData("mode"));
      if (leaf) {
        this.__reveal(leaf);
        this.__silentTree = true;
        this.__tree.setSelection([leaf]);
        this.__silentTree = false;
      }
      const widget = this.__open(page);
      if (widget.openWith) {
        widget.openWith(data);
      }
    },

    /** Sayfa nesnesini (gerekirse oluşturup yığına ekleyerek) döner; GÖSTERMEZ. */
    __widget(page) {
      let widget = this.__pages[page.id];
      if (!widget) {
        widget = page.create(this.__user);
        this.__pages[page.id] = widget;
        // Pencere kısaysa (ör. dizüstü/küçük monitör) sayfa içeriği kesilmesin diye her sayfa bir
        // Scroll'a sarılır: ScrollPane içi Grow düzeni kullanır, içerik sığdığında çocuğu mevcut
        // alana GERDİĞİNDEN (bkz. qx.ui.core.scroll.ScrollPane) Tahtalar/Loglar gibi sayfalardaki
        // flex:1 tablo eskisi gibi kalan alanı doldurmaya devam eder; yalnız gerçekten sığmayınca
        // dikey kaydırma çubuğu belirir.
        const scroll = new qx.ui.container.Scroll();
        scroll.add(widget);
        this.__scrolls[page.id] = scroll;
        this.__stack.add(scroll);
      }
      return widget;
    },

    __open(page) {
      const widget = this.__widget(page);
      this.__stack.setSelection([this.__scrolls[page.id]]);
      widget.activate();
      return widget;
    },

    /**
     * Loglar sayfasını açar, ağaçtaki seçimi de verilen moda taşır (yoksa ağaçta önceki sayfa seçili
     * kalır; ona yeniden tıklamak changeSelection üretmediğinden geri dönülemez hâle gelirdi).
     * @return {tihamon.page.Logs|null}
     */
    __openLogsPage(mode) {
      const page = tihamon.ui.Shell.PAGES.find(p => p.id === "logs");
      if (!page || !this.__allowed(page)) {
        return null;
      }
      let leaf = null;
      this.__tree.getRoot().getItems(true).forEach(item => {
        if (!leaf && item.getUserData("page") === page && item.getUserData("mode") === mode) {
          leaf = item;
        }
      });
      if (leaf) {
        // Yalnız ağaçtaki vurguyu taşır; sayfanın kendi modu/süzgeci çağıran tarafından kurulur
        // (changeSelection'ın kendi setMode'u ayrıca bir yenileme daha başlatmasın).
        this.__reveal(leaf);
        this.__silentTree = true;
        this.__tree.setSelection([leaf]);
        this.__silentTree = false;
      }
      return this.__open(page);
    },

    /**
     * Bkz. OPEN_LOGS: Sistem logları moduna alır ve verilen tahtaya süzer.
     * @param data {Number|Map} tahta kimliği ya da {boardId, severity} (ör. Genel bakış'tan "3" = hatalar)
     */
    __openLogsForBoard(data) {
      const opts = typeof data === "object" && data !== null ? data : { boardId: data };
      const widget = this.__openLogsPage("system");
      if (widget && widget.setBoardFilter) {
        widget.setBoardFilter(opts.boardId, opts.severity);
      }
    },

    /** Bkz. OPEN_LOGS_MODE: tahta süzgeci olmadan, yalnız verilen moda ("system"|"command") geçer. */
    __openLogsMode(mode) {
      const widget = this.__openLogsPage(mode);
      if (widget && widget.setMode) {
        widget.setMode(mode);
      }
    },

    __createHeader() {
      const header = new qx.ui.container.Composite(new qx.ui.layout.HBox(10).set({ alignY: "middle" })).set({
        padding: [8, 14],
        backgroundColor: "app-header"
      });
      const fold = new qx.ui.form.Button("☰").set({ toolTipText: "Menüyü gizle/göster", width: 36 });
      fold.addListener("execute", () => {
        this.__navPane.setVisibility(this.__navPane.isVisible() ? "excluded" : "visible");
      });
      header.add(fold);
      header.add(new qx.ui.basic.Label("Tiha-Mon").set({ font: "app-title", textColor: "app-header-text" }));
      header.add(new qx.ui.core.Spacer(), { flex: 1 });
      header.add(new qx.ui.basic.Label(this.__user.full_name || this.__user.username).set({ textColor: "app-header-text" }));
      const logout = new qx.ui.form.Button("Çıkış");
      logout.addListener("execute", async () => {
        await tihamon.io.Api.post("/auth/logout").catch(() => null);
        qx.event.message.Bus.dispatchByName(tihamon.io.Api.UNAUTHORIZED);
      });
      header.add(logout);
      return header;
    }
  }
});
