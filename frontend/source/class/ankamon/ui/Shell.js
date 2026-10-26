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
qx.Class.define("ankamon.ui.Shell", {
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
    const NAV = ankamon.ui.Shell;
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
        ankamon.io.Api.put("/auth/prefs", { key: "nav.width", value: width }).catch(() => {
          // Kalıcılık kaybı önemsiz: bir sonraki sürüklemede yeniden gönderilir.
        });
      }
    });
    this.add(split, { edge: "center" });

    this.add(new ankamon.ui.StatusBar(), { edge: "south" });

    // Bilerek yapılan yeniden yüklemeden (ör. Ayarlar'da tema değişimi) sonra aynı sayfaya dönülür
    // (kullanıcı isteği) — tek seferlik kayıt, okununca silinir; yoksa/izinsizse ağaçtaki ilk sayfa.
    let reopen = null;
    try {
      reopen = sessionStorage.getItem(ankamon.ui.Shell.REOPEN_KEY);
      sessionStorage.removeItem(ankamon.ui.Shell.REOPEN_KEY);
    } catch (e) {
      // sessionStorage erişilemiyor — ilk sayfaya düş.
    }
    const reopenPage = reopen && ankamon.ui.Shell.PAGES.find(p => p.id === reopen);
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
    qx.event.message.Bus.subscribe(ankamon.ui.Shell.OPEN_LOGS, msg => this.__openLogsForBoard(msg.getData()));
    // StatusBar'ın sağ menüsündeki "Sistem logları"/"Komut logları" buradan tetiklenir — tahta
    // süzgeci olmadan, yalnız ilgili moda geçer (bkz. __openLogsForBoard'daki tahtalı benzeri).
    qx.event.message.Bus.subscribe(ankamon.ui.Shell.OPEN_LOGS_MODE, msg => this.__openLogsMode(msg.getData()));
    // Genel bakış kartları (bkz. page.Dashboard __target) buradan sayfa/pencere açar.
    qx.event.message.Bus.subscribe(ankamon.ui.Shell.OPEN_PAGE, msg => this.__openPage(msg.getData()));
    // Sekmeli sayfa sekmesini kendisi değiştirince (ör. Disk kullanımı ▸ Özet'te dilime tıklama) ağaçtaki
    // vurgu da o sekmenin yaprağına geçer.
    qx.event.message.Bus.subscribe(ankamon.page.Base.TAB_CHANGED, msg => {
      const { page: widget, tab } = msg.getData();
      const id = Object.keys(this.__pages).find(k => this.__pages[k] === widget);
      const page = id && ankamon.ui.Shell.PAGES.find(p => p.id === id);
      if (page && this.__stack.getSelection()[0] === this.__scrolls[id]) {
        this.__selectTabLeaf(page, tab);
      }
    });
  },

  statics: {
    /** sessionStorage anahtarı: yeniden yüklemeden sonra açılacak sayfanın kimliği (bkz. construct). */
    REOPEN_KEY: "ankamon.reopenPage",

    // Sol menü genişliği (piksel): varsayılan ve kayıtlı değerin uygulanacağı sınırlar.
    NAV_DEFAULT: 250,
    NAV_MIN: 150,
    NAV_MAX: 600,

    // Metin tabanlı düğüm simgeleri (bkz. sınıf başı not). Boş: belirgin bir simge gerekmiyor.
    ICON: {
      dashboard: "◈", boards: "▭", logs: "▤", sessions: "♙", metrics: "∿", users: "◉", settings: "⚙",
      webshell: "▭", screen: "▣", screenControl: "🖱", reboot: "↻", filemanager: "▦", run: "▸", shutdown: "■", wol: "▲", edit: "✎", delete: "✕",
      info: "ℹ", backup: "⬇", copy: "⧉", distribute: "⇉", collect: "⇇", bulk: "⇄", wakeScreen: "☀", cast: "⇪", logout: "⏏", lock: "🔒", password: "🔑", diagnose: "⚕", system: "⚒", diskusage: "⛁", software: "⬢",
      network: "⇆", subnet: "▫", taskmgr: "☷", anomalies: "⚠"
    },

    // Uzaktan işlemler kaldırıldı; işlevi Tahtalar sayfasına ve ağaç sağ menülerine taşındı.
    //
    // "sessions" (Oturumlar): tahtalarda greeter ile oturum açan GERÇEK kullanıcıların kaydı
    // (bkz. page.Sessions) — "users" (Kullanıcılar, Ankamon'un KENDİ arayüz hesapları, yalnız
    // admin) ile KARIŞTIRILMASIN diye bilerek ayrı/farklı adda bir sayfa; "logs" yetkisini paylaşır
    // (log'lardan türetilen veri olduğundan).
    PAGES: [
      // retap: ağaçta zaten seçili düğüme yeniden tıklamak sayfayı yeniler (sayfada "Yenile" düğmesi yok).
      { id: "dashboard", label: "Genel bakış", feature: "dashboard", retap: true, create: u => new ankamon.page.Dashboard(u) },
      { id: "boards", label: "Tahtalar", feature: "boards", create: u => new ankamon.page.Boards(u) },
      // parent: ağaçta o sayfanın düğümünün ALTINDA (kullanıcı isteği: tahtalarla ilgili sayfalar
      // "Tahtalar"ın altında). Üst sayfa kullanıcıya kapalıysa kökte gösterilir — bkz. __createTree.
      // Sekmeleri ağaçta da (kullanıcı isteği: "Kullanıcılar" zaman çizelgesi sol menüden açılsın); key =
      // sekme etiketi (page.Sessions sekmelerinde userData "key" yok).
      { id: "sessions", label: "Oturumlar", feature: "logs", parent: "boards", create: u => new ankamon.page.Sessions(u),
        tabs: ["Oturumlar", "Kullanıcılar"].map(label => ({ key: label, label })) },
      // Bakım: "Bakım" (sorun tespiti) + "Sensörler" (Grafana) sekmeleri — bkz. page.Maintenance. features:
      // herhangi biri yeterli (sekme başına yetki sayfanın içinde). Sensörler ayrı menü öğesi DEĞİL (kullanıcı
      // isteği); eski {page: "metrics"} bağlantıları __openPage'de buraya yönlenir. id "diagnose" kalır
      // (nav_order / nav.open kayıtları). Oturumlar'ın altında (kullanıcı isteği).
      // tabs: sayfanın sekmeleri ağaçta düğümün ALT seçenekleri de (kullanıcı isteği); sayfadaki sekme çubuğu
      // görünür kalır ve ikisi eşzamanlıdır (yaprak → Base.selectTab, sekme → TAB_CHANGED ile ağaç vurgusu).
      // key = sekmenin kimliği — sayfadaki sekmenin userData "key"i ya da etiketiyle AYNI olmalı; feature /
      // admin: o sekmenin yetkisi (sayfanın kendi sekme yetkisiyle aynı). Fonksiyon da olabilir (dinamik liste).
      { id: "diagnose", label: "Bakım", features: ["diagnose", "metrics"], parent: "boards", create: u => new ankamon.page.Maintenance(u),
        tabs: () => [{ key: "diagnose", label: "Bakım", feature: "diagnose" }, { key: "metrics", label: "Sensörler", feature: "metrics" }]
          .concat(ankamon.ext.Extensions.maintenanceTabs().map(t => ({ key: t.key, label: t.label, feature: t.feature }))) },
      // Anomaliler: sıra dışı durumlar (ör. açık ama oturumsuz tahta, NTP eşitlenmemiş saat) — anlık + geçmiş
      // rapor + seçilen tahtalarda tarama (bkz. page.Anomalies). Bakım'ın altında (kullanıcı isteği); Bakım
      // kapalı kullanıcıda Tahtalar'ın altında (bkz. __createTree).
      { id: "anomalies", label: "Anomaliler", feature: "anomalies", parent: "diagnose", create: u => new ankamon.page.Anomalies(u),
        tabs: ["Anlık", "Geçmiş", "Tahta özeti", "Tarama"].map(label => ({ key: label, label })) },
      // Loglar Tahtalar'ın altında EN SONDA (kullanıcı isteği).
      { id: "logs", label: "Loglar", feature: "logs", parent: "boards", create: u => new ankamon.page.Logs(u),
        tabs: () => ankamon.ui.Shell.LOG_KINDS.map(kind => ({ key: kind.mode, label: kind.label })) },
      // Ağ envanteri: altında sunucunun bağlı olduğu fiziksel ağlar (dinamik, bkz. __fillNetworks).
      { id: "network", label: "Ağ", feature: "network", create: u => new ankamon.page.Network(u) },
      // Ankamon'un kendi bakımı (servisler, zamanlanmış işler, veritabanı, yapılandırma) — yalnız yönetici.
      { id: "system", label: "Sistem", admin: true, retap: true, create: u => new ankamon.page.System(u) },
      // Kullanıcılar ve Ayarlar "Sistem"in altında (kullanıcı isteği).
      // Disk kullanımı ve veri silme (eski açılır pencere — kullanıcı isteği: Sistem altında sayfa).
      { id: "diskusage", label: "Disk kullanımı", feature: "logs.manage", parent: "system", retap: true, create: u => new ankamon.page.DiskUsage(u),
        tabs: () => [{ key: "summary", label: "Özet" }].concat(ankamon.ui.DiskUsage.specs().map(spec => ({ key: spec.mode, label: spec.label }))) },
      // Konteynerdeki kritik yazılımlar: sürüm, durum, Ankamon'daki işlevi (yalnız yönetici).
      { id: "software", label: "Yazılımlar", admin: true, parent: "system", retap: true, create: u => new ankamon.page.Software(u) },
      // Kullanıcılar ▸ Kullanıcılar (yalnız yönetici) + Oturumlar ('logins'): features yöneticide her zaman
      // sağlanır; 'logins' yetkili kullanıcı sayfayı yalnız Oturumlar sekmesiyle görür (bkz. page.Users).
      { id: "users", label: "Kullanıcılar", features: ["logins"], parent: "system", create: u => new ankamon.page.Users(u),
        tabs: [{ key: "users", label: "Hesaplar", admin: true }, { key: "logins", label: "Oturumlar", feature: "logins" }] },
      // admin/feature yok: herkese açık (kendi tema tercihini herkes değiştirebilir); sayfa içinde
      // sistem ayarları (SSH/Samba/keşif) yalnız admin'e gösterilir — bkz. page.Settings. Sistem
      // yalnız yöneticiye açık olduğundan diğer kullanıcılarda kökte görünür (bkz. __createTree).
      // Sekmeler yalnız yöneticide (diğer kullanıcı yalnız kendi temasını görür, sekme yok).
      { id: "settings", label: "Ayarlar", parent: "system", create: u => new ankamon.page.Settings(u),
        tabs: ["Görünüm", "Tahta erişimi", "Ağ arabirimleri", "Ders saatleri", "Eklentiler"].map(label => ({ key: label, label, admin: true })) }
    ],
    LOG_KINDS: [
      { label: "Sistem logları", mode: "system" },
      { label: "Komut logları", mode: "command" }
    ],

    // Boards grid'inin satır menüsü ve Genel bakış'ın hata/görev satırları, Loglar sayfasını bir tahtaya
    // süzülmüş açmak için bu mesajı yayınlar (payload: board id ya da {boardId, severity}) — bkz.
    // construct()'taki subscribe ve __openLogsForBoard.
    OPEN_LOGS: "ankamon.openLogs",
    // StatusBar'ın sağ menüsü, Loglar sayfasını tahta süzgeci olmadan belirli bir modda açmak için
    // bu mesajı yayınlar (payload: "system"|"command") — bkz. __openLogsMode.
    OPEN_LOGS_MODE: "ankamon.openLogsMode",
    // {page: "boards"|"metrics"|"system", ...} sayfayı açar, kalan alanları sayfanın openWith()'ine
    // verir; {diskUsage: "metrics"|"queue"|"backups"|…} ise Disk kullanımı sayfasını o sekmede açar.
    OPEN_PAGE: "ankamon.openPage"
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

    /** Sayfanın kullanıcıya açık sekmeleri (ağaçtaki alt seçenekler — bkz. PAGES tabs). */
    __tabsOf(page) {
      const tabs = typeof page.tabs === "function" ? page.tabs() : (page.tabs || []);
      return tabs.filter(tab => (tab.admin ? this.__user.is_admin : !tab.feature || this.__can(tab.feature)));
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
      const allowed = ankamon.ui.Shell.PAGES.filter(page => this.__allowed(page));
      // Üst sayfa kullanıcıya kapalıysa bir üstündekinin altına (ör. Bakım kapalı → Anomaliler Tahtalar'ın
      // altında); hiçbiri açık değilse kökte.
      const parentOf = page => {
        for (let id = page.parent; id;) {
          if (allowed.some(p => p.id === id)) {
            return id;
          }
          const up = ankamon.ui.Shell.PAGES.find(p => p.id === id);
          id = up && up.parent;
        }
        return null;
      };
      const childrenOf = id => allowed.filter(child => parentOf(child) === id);
      this.__orderedPages(allowed.filter(page => !parentOf(page))).forEach(page => {
        const node = this.__buildNode(page, childrenOf);
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
        const tab = item.getUserData("tab");
        if (tab) {
          // Önce sekme seçilir, sonra sayfa gösterilir: sayfa açılınca doğrudan o sekmeyi yükler (tek yenileme).
          this.__widget(item.getUserData("page")).selectTab(tab);
        }
        const widget = this.__open(item.getUserData("page"));
        if (!tab && this.__tabsOf(item.getUserData("page")).length) {
          // Seçim olayının içinde ağaç seçimi değiştirilemiyor (geri alınıyor): bir sonraki turda.
          qx.event.Timer.once(() => this.__selectTabLeaf(item.getUserData("page"), widget.currentTab()), this, 0);
        }
      });
      // Seviyeye göre yazı: tema yazı tipleri ağaç görününce uygulanmış olur; tema değişince yeniden hesaplanır.
      this.__tree.addListenerOnce("appear", () => this.__styleNavLevels());
      const restyle = () => qx.event.Timer.once(() => this.__styleNavLevels(), this, 0);
      qx.theme.manager.Font.getInstance().addListener("changeTheme", restyle);
      qx.theme.manager.Appearance.getInstance().addListener("changeTheme", restyle);
      return this.__tree;
    },

    /**
     * Ana menü seviyeleri (kullanıcı isteği): 1. seviye kalın; 3. ve daha derin seviyeler aynı yazıyla, bir tık
     * (1 px) küçük; 2. seviye temanın yazısıyla. Yazı tipi sabit verilmez, o temanın ağaç yazısından türetilir
     * (temaların aileleri/boyutları farklı; Fluent kalınlığı "weight" ile, Tangible "bold" ile tanımlar).
     */
    __styleNavLevels() {
      const fonts = qx.theme.manager.Font.getInstance();
      const style = (item, depth) => {
        const label = item.getChildControl("label");
        label.resetFont(); // temanın yazısına dön (tema değişmiş olabilir)
        if (depth === 2) {
          return;
        }
        let base = label.getFont() || item.getFont() || "default";
        base = typeof base === "string" ? fonts.resolve(base) : base;
        if (!(base instanceof qx.bom.Font)) {
          return;
        }
        const font = new qx.bom.Font();
        ["size", "lineHeight", "family", "bold", "italic", "weight", "color", "letterSpacing", "decoration", "textShadow"]
          .forEach(key => {
            const value = base.get(key);
            if (value !== null && value !== undefined) {
              font.set(key, value);
            }
          });
        if (depth === 1) {
          font.setBold(true);
          if (font.getWeight()) {
            font.setWeight("bold");
          }
        } else if (font.getSize()) {
          font.setSize(font.getSize() - 1);
        }
        label.setFont(font);
      };
      const walk = (parent, depth) => parent.getChildren().forEach(item => {
        style(item, depth);
        walk(item, depth + 1);
      });
      walk(this.__tree.getRoot(), 1);
    },

    /**
     * Klasör düğümünün açık/kapalı durumu kullanıcı başına sunucuda (users.ui_prefs["nav.open"] =
     * {sayfa id: bool}, bkz. AuthApi::prefs — menü genişliği "nav.width" ile aynı yol): girişte
     * uygulanır (kayıt yoksa kök klasörler açık, alt klasörler kapalı), kullanıcı katlayıp açtıkça
     * kaydedilir.
     */
    __rememberOpen(folder, id) {
      const prefs = this.__user.ui_prefs || (this.__user.ui_prefs = {});
      const saved = (prefs["nav.open"] || {})[id];
      // Varsayılan (kullanıcı isteği): kök (1. seviye) klasörler açık; 2. seviye klasörler (alt sayfalar —
      // sekmeleri alt seçenek olan Bakım, Loglar, Disk kullanımı, Kullanıcılar, Ayarlar…) kapalı, yani 2'den
      // derin menü seviyeleri katlı başlar.
      const page = ankamon.ui.Shell.PAGES.find(p => p.id === id);
      folder.setOpen(saved === undefined ? !(page && page.parent) : !!saved);
      folder.addListener("changeOpen", e => {
        if (this.__revealing) {
          return; // bkz. __reveal: gezinme için açılış kullanıcı tercihi sayılmaz
        }
        const open = { ...(prefs["nav.open"] || {}), [id]: e.getData() };
        prefs["nav.open"] = open;
        ankamon.io.Api.put("/auth/prefs", { key: "nav.open", value: open }).catch(() => {});
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

    /**
     * Bir sayfanın ağaç düğümü: alt sayfaları varsa klasör (kendisine tıklamak yine sayfayı açar). Alt sayfalar
     * sekme yapraklarından SONRA, kendi alt sayfalarıyla (iç içe — ör. Tahtalar ▸ Bakım ▸ Anomaliler).
     * @param childrenOf {Function} sayfa id → ağaçta altında duracak sayfalar
     */
    __buildNode(page, childrenOf) {
      const children = childrenOf(page.id);
      if (page.id === "network") {
        return this.__buildNetworkNode(page);
      }
      const label = `${ankamon.ui.Shell.ICON[page.id] || ""} ${page.label}`.trim();
      const tabs = this.__tabsOf(page);
      const node = children.length || tabs.length ? new qx.ui.tree.TreeFolder(label) : new qx.ui.tree.TreeFile(label);
      this.__hideThemeIcon(node);
      node.setUserData("page", page);
      if (page.retap) {
        this.__addRetap(node);
      }
      // Sekmeler alt seçenek: seçilince sayfa o sekmede açılır; seçiliyken yeniden tıklamak sayfayı yeniler.
      tabs.forEach(tab => {
        const leaf = new qx.ui.tree.TreeFile(tab.label);
        this.__hideThemeIcon(leaf);
        leaf.setUserData("page", page);
        leaf.setUserData("tab", tab.key);
        this.__addRetap(leaf);
        node.add(leaf);
      });
      if (children.length) {
        children.forEach(child => node.add(this.__buildNode(child, childrenOf)));
      }
      if (children.length || tabs.length) {
        this.__rememberOpen(node, page.id);
      }
      return node;
    },

    /**
     * "Ağ" klasörü: alt düğümleri sunucunun bağlı olduğu (ve daha önce bağlı olduğu) ağlardır, sayfa
     * açılmasa da 60 sn'de bir; Ağ sayfası açıkken her liste tazelenişinde güncellenir.
     */
    __buildNetworkNode(page) {
      const folder = new qx.ui.tree.TreeFolder(`${ankamon.ui.Shell.ICON.network} ${page.label}`);
      this.__hideThemeIcon(folder);
      folder.setUserData("page", page);
      this.__rememberOpen(folder, page.id);
      this.__networkFolder = folder;
      qx.event.message.Bus.subscribe(ankamon.ui.network.Ops.NETWORKS_CHANGED, msg => this.__fillNetworks(msg.getData().networks));
      this.__networkTimer = new qx.event.Timer(60000);
      this.__networkTimer.addListener("interval", this.__loadNetworks, this);
      this.__networkTimer.start();
      this.__loadNetworks();
      return folder;
    },

    async __loadNetworks() {
      try {
        const data = await ankamon.io.Api.get("/network");
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
      const Ops = ankamon.ui.network.Ops;
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
        leaf.setLabel(`${ankamon.ui.Shell.ICON.subnet} ${Ops.networkLabel(net)} (${net.online}/${net.devices})` +
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
      ankamon.io.Api.put("/auth/nav-order", { order }).catch(() => {});
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
      const page = ankamon.ui.Shell.PAGES.find(p => p.id === data.page);
      if (!page || !this.__allowed(page)) {
        return;
      }
      // Alt düğümler de aranır (ör. "Tahtalar" altındaki "Loglar" klasörü); kip yaprakları hariç. İstenen
      // sekmenin yaprağı varsa o (ör. Genel bakış ▸ Sensörler → Bakım ▸ Sensörler), yoksa sayfanın düğümü.
      const items = this.__tree.getRoot().getItems(true);
      const leaf = (data.tab && items.find(n => n.getUserData("page") === page && n.getUserData("tab") === data.tab)) ||
        items.find(n => n.getUserData("page") === page && !n.getUserData("tab"));
      if (leaf) {
        this.__reveal(leaf);
        this.__silentTree = true;
        this.__tree.setSelection([leaf]);
        this.__silentTree = false;
      }
      const widget = this.__open(page);
      if (widget.openWith) {
        widget.openWith(data);
      } else if (data.tab) {
        widget.selectTab(data.tab);
      }
    },

    /** Sekmeli sayfa açılınca ağaçta o an açık sekmenin yaprağı vurgulanır (sessizce; üst klasör açılır). */
    __selectTabLeaf(page, key) {
      const leaf = key && this.__tree.getRoot().getItems(true)
        .find(n => n.getUserData("page") === page && n.getUserData("tab") === key);
      if (leaf) {
        this.__reveal(leaf);
        // Az önce açılan klasörün yaprakları henüz yerleşmedi: seçim onu görünür alana kaydırırken
        // konumu okur — önce düzen uygulanır (yoksa "Cannot read properties of null (reading 'left')").
        qx.ui.core.queue.Manager.flush();
        this.__silentTree = true;
        this.__tree.setSelection([leaf]);
        this.__silentTree = false;
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
     * @return {ankamon.page.Logs|null}
     */
    __openLogsPage(mode) {
      const page = ankamon.ui.Shell.PAGES.find(p => p.id === "logs");
      if (!page || !this.__allowed(page)) {
        return null;
      }
      let leaf = null;
      this.__tree.getRoot().getItems(true).forEach(item => {
        if (!leaf && item.getUserData("page") === page && item.getUserData("tab") === mode) {
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
      // Logo simgesi: ekran çerçevesi başlık yazısının renginde (temaların koyu/mavi başlık zemininde seçilsin).
      header.add(new qx.ui.basic.Label(ankamon.ui.Logo.icon(32, "currentColor")).set({ rich: true, textColor: "app-header-text" }));
      header.add(new qx.ui.basic.Label("Ankamon").set({ font: "app-title", textColor: "app-header-text" }));
      header.add(new qx.ui.core.Spacer(), { flex: 1 });
      header.add(new qx.ui.basic.Label(this.__user.full_name || this.__user.username).set({ textColor: "app-header-text" }));
      const logout = new qx.ui.form.Button("Çıkış");
      logout.addListener("execute", async () => {
        await ankamon.io.Api.post("/auth/logout").catch(() => null);
        qx.event.message.Bus.dispatchByName(ankamon.io.Api.UNAUTHORIZED);
      });
      header.add(logout);
      return header;
    }
  }
});
