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
    // Varlık grupları: Varlıklar ▸ <grup> düğümleri sunucudaki gruplarla eşitlenir (açılışta ve grup değişince).
    qx.event.message.Bus.subscribe(ankamon.ui.network.Ops.GROUPS_CHANGED, msg => this.__syncAssetGroups(msg.getData().groups));
    const networkPage = ankamon.ui.Shell.PAGES.find(p => p.id === "network");
    if (this.__allowed(networkPage)) {
      ankamon.io.Api.get("/network/groups").then(data => this.__syncAssetGroups(data.groups || [])).catch(() => {});
    }
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
      info: "ℹ", backup: "⬇", copy: "⧉", distribute: "⇉", collect: "⇇", bulk: "⇄", wakeScreen: "☀", sleepScreen: "☾", screenLock: "🔐", screenUnlock: "🔓", cast: "⇪", logout: "⏏", lock: "🔒", password: "🔑", diagnose: "⚕", system: "⚒", diskusage: "⛁", software: "⬢",
      network: "⇆", subnet: "▫", taskmgr: "☷", anomalies: "♥", leagues: "♛",
      screenshot: "📷", keyboard: "⌨", mouse: "🖱", touch: "☝", unlockInput: "🔓", relay: "⇶", relayStop: "⏹", chat: "💬", web: "🌐", webFilter: "🛡", wifi: "📶", movements: "☰"
    },

    // Uzaktan işlemler kaldırıldı; işlevi Tahtalar sayfasına ve ağaç sağ menülerine taşındı.
    //
    // "sessions" (Oturumlar): tahtalarda greeter ile oturum açan GERÇEK kullanıcıların kaydı
    // (bkz. page.Sessions) — "users" (Kullanıcılar, Ankamon'un KENDİ arayüz hesapları, yalnız
    // admin) ile KARIŞTIRILMASIN diye bilerek ayrı/farklı adda bir sayfa; "logs" yetkisini paylaşır
    // (log'lardan türetilen veri olduğundan).
    // Buraya eklenen sayfa/alt sayfa/sekme ağaçla birlikte üst başlıktaki yol gösterimine ve açılır listelerine de
    // kendiliğinden girer (bkz. ui.ShellNavPath); sayfaya ayrıca başlık yazılmaz.
    PAGES: [
      // retap: ağaçta zaten seçili düğüme yeniden tıklamak sayfayı yeniler (sayfada "Yenile" düğmesi yok).
      { id: "dashboard", label: "Genel bakış", feature: "dashboard", retap: true, create: u => new ankamon.page.Dashboard(u) },
      // Tahtalar (kullanıcı isteği 2026-11-06): altında "Liste" (bu sayfa — liste/ekran seçimi sayfanın içinde, bkz.
      // page.Boards), Sensörler ve eklenti sekmeleri (Ahenk; "diagnose" sayfasının sekmeleri, inline). selfLeaf: sayfanın
      // kendisi ağaçta ilk alt seçenek olarak da durur; Tahtalar'a tıklamak onu seçer (varsayılan seçenek).
      // "Tahtalar" → "Bilgisayarlar" → "Ağ" (kullanıcı isteği 2026-11-09; kimlik "boards" kalır). Ağ envanteri sayfası
      // ("network") onun altında "Ağ" alt menüsü.
      // Ağ ▸ Liste (ağ envanteri, "network") + Ağ ▸ Akıllı Tahtalar (bu sayfa; eski adı "Liste") — kullanıcı isteği 2026-11-09.
      { id: "boards", label: "Ağ", feature: "boards", selfLeaf: "Akıllı Tahtalar", create: u => new ankamon.page.Boards(u) },
      // parent: ağaçta o sayfanın düğümünün ALTINDA. Üst sayfa kullanıcıya kapalıysa kökte gösterilir — bkz. __createTree.
      // collapsed: kökte olsa da katlı başlar (uzun sekme listesi menüyü doldurmasın — bkz. __rememberOpen).
      // Sekmeleri ağaçta da (kullanıcı isteği: zaman çizelgesi sol menüden açılsın). key: Oturumlar sekmesinde
      // etiket, Zaman çizelgesinde userData "key" (eski adı "Kullanıcılar" — bkz. ui.sessions.Users).
      { id: "sessions", label: "Oturumlar", feature: "logs", collapsed: true, create: u => new ankamon.page.Sessions(u),
        tabs: [{ key: "Oturumlar", label: "Oturumlar" }, { key: "timeline", label: "Zaman çizelgesi" }, { key: "movements", label: "Hareketler" },
          { key: "chat", label: "Sohbet geçmişi" }] },
      // Ligler (kullanıcı isteği 2026-11-06): eskiden Oturumlar'ın "Şampiyonlar Ligi" / "Teneffüs Ligi" sekmeleri; adları
      // "Kullanım sıralaması" / "Ders arası sıralaması" oldu (bkz. page.Leagues). Eski bağlantılar __openPage'de yönlenir.
      // Bilgisayarlar'ın altında (kullanıcı isteği 2026-11-09); simge tek renkli metin karakteri (♛ — 🏆 emoji sarı çiziliyordu).
      // Simgesiz (kullanıcı isteği 2026-11-10: noIcon). "Ders arası sıralaması" → "Teneffüsler"; sayfadaki "Kullanıcılar /
      // Tahtalar" seçimi kalktı, her sıralamanın altında Kullanıcılar ve Bilgisayarlar yaprağı (group — bkz. __buildNode).
      // Akıllı Tahtalar'ın altında (kullanıcı isteği 2026-11-10: underSelf — üst düğümün kendi seçeneğinin altında).
      { id: "leagues", label: "Ligler", feature: "logs", parent: "boards", underSelf: true, collapsed: true, noIcon: true, create: u => new ankamon.page.Leagues(u),
        tabs: () => ankamon.page.Leagues.TABS.map(tab => ({ key: tab.key, label: tab.label, group: tab.group })) },
      // Sağlık: sorun tespiti (SSH denetimi) ile anomaliler (sürekli izleme) tek bölümde — bkz. page.Anomalies,
      // ui.health.Status. Kimlik "anomalies" kalır (nav_order, hatırlanan sekme); features: ikisinden biri yeterli, sekme
      // başına yetki sayfanın içinde. Eski "Bakım ▸ Bakım/Yardım" bağlantıları __openPage'de buraya yönlenir.
      // Etiket "Sağlık" (kullanıcı isteği 2026-11-10).
      { id: "anomalies", label: "Sağlık", features: ["anomalies", "diagnose"], collapsed: true, create: u => new ankamon.page.Anomalies(u),
        tabs: [{ key: "status", label: "Durum" }, { key: "reports", label: "Denetle", feature: "diagnose" },
          { key: "Geçmiş", label: "Geçmiş", feature: "anomalies" },
          { key: "Tarama", label: "Tara" },
          { key: "notifications", label: "Bildirimler", feature: "anomalies" }, { key: "help", label: "Yardım" }] },
      // Bakım: "Sensörler" (Grafana) ve eklenti sekmeleri (ör. Ahenk) — bkz. page.Maintenance. Sorun tespiti raporu
      // "Sağlık"a taşındı. features: herhangi biri yeterli (sekme başına yetki sayfanın içinde). Sensörler ayrı menü öğesi DEĞİL (kullanıcı
      // isteği); eski {page: "metrics"} bağlantıları __openPage'de buraya yönlenir. id "diagnose" kalır
      // (nav_order / nav.open kayıtları). Oturumlar'ın altında (kullanıcı isteği).
      // tabs: sayfanın sekmeleri ağaçta düğümün ALT seçenekleri de (kullanıcı isteği); sayfadaki sekme çubuğu
      // görünür kalır ve ikisi eşzamanlıdır (yaprak → Base.selectTab, sekme → TAB_CHANGED ile ağaç vurgusu).
      // key = sekmenin kimliği — sayfadaki sekmenin userData "key"i ya da etiketiyle AYNI olmalı; feature /
      // admin: o sekmenin yetkisi (sayfanın kendi sekme yetkisiyle aynı). Fonksiyon da olabilir (dinamik liste).
      // features: Sensörler "metrics", eklenti sekmeleri (ör. Ahenk) "diagnose" ister (PAGES sınıf yüklenirken kurulur,
      // eklentiler sonra: liste sabit kalır).
      // Bakım ana menüsü kalktı (kullanıcı isteği 2026-11-06): sekmeleri (Sensörler, Ahenk…) inline — kendi düğümü olmadan
      // doğrudan Tahtalar'ın altında. Tahtalar kullanıcıya kapalıysa kökte kendi düğümüyle ("Sensörler") durur.
      { id: "diagnose", label: "Sensörler", parent: "boards", inline: true, features: ["metrics", "diagnose"], collapsed: true,
        create: u => new ankamon.page.Maintenance(u),
        // Eklenti sekmeleri (Ahenk) Akıllı Tahtalar'ın altında (underSelf — kullanıcı isteği 2026-11-10); Sensörler Ağ'ın altında.
        tabs: () => [{ key: "metrics", label: "Sensörler", feature: "metrics" }]
          .concat(ankamon.ext.Extensions.maintenanceTabs().map(t => ({ key: t.key, label: t.label, feature: t.feature, underSelf: true }))) },
      // Loglar Sistem'in altında (kullanıcı isteği 2026-11-06); Sistem'e yetkisi olmayanlarda kökte (bkz. __createTree).
      { id: "logs", label: "Loglar", feature: "logs", parent: "system", collapsed: true, noIcon: true, create: u => new ankamon.page.Logs(u),
        tabs: () => ankamon.ui.Shell.LOG_KINDS.map(kind => ({ key: kind.mode, label: kind.label })) },
      // Ağ envanteri: bütün ağların cihazları tek listede (kullanıcı isteği 2026-11-09: ağ başına alt düğüm yok; ağ
      // işlemleri sayfadaki "Ağlar" düğmesinde — bkz. page.Network). Üst menü "Ağ"ın (boards) altında (kullanıcı isteği
      // 2026-11-09); o kullanıcıya kapalıysa kökte.
      // Ağ ▸ Varlıklar (kullanıcı isteği 2026-11-10: eski "Ağ ▸ Liste", simgesiz); first: üst düğümün kendi seçeneğinden
      // (Akıllı Tahtalar) önce. Akıllı Tahtalar listesi buradaki "Akıllı tahta" türlü satırlardan belirlenir (bkz. BoardsApi LISTED).
      // Ağ ▸ Varlıklar = bütün varlıklar (kullanıcı isteği 2026-11-10: "Varlıklar ▸ Tüm Varlıklar" alt düğümü kalktı). Kullanıcının
      // varlık grupları Ağ'ın DOĞRUDAN altında (bkz. __syncAssetGroups); grup seçilince AYNI sayfa o grubun üyelerine süzülür
      // (page.Network setGroup — kendi taraması yok, Varlıklar'dan türer). Ağ'ın alt seçeneklerinin sırası sürükle-bırakla
      // değişir (bkz. __makeChildReorderable).
      { id: "network", label: "Varlıklar", feature: "network", parent: "boards", first: true, noIcon: true,
        create: u => new ankamon.page.Network(u) },
      // Ankamon'un kendi bakımı (servisler, zamanlanmış işler, veritabanı, yapılandırma) — yalnız yönetici.
      { id: "system", label: "Sistem", admin: true, retap: true, create: u => new ankamon.page.System(u) },
      // Kullanıcılar ve Ayarlar "Sistem"in altında (kullanıcı isteği).
      // Disk kullanımı ve veri silme (eski açılır pencere — kullanıcı isteği: Sistem altında sayfa).
      // Sistem'in alt seçenekleri simgesiz (kullanıcı isteği 2026-11-10: noIcon).
      { id: "diskusage", label: "Disk kullanımı", feature: "logs.manage", parent: "system", retap: true, noIcon: true, create: u => new ankamon.page.DiskUsage(u),
        tabs: () => [{ key: "summary", label: "Özet" }].concat(ankamon.ui.DiskUsage.specs().map(spec => ({ key: spec.mode, label: spec.label }))) },
      // Konteynerdeki kritik yazılımlar: sürüm, durum, Ankamon'daki işlevi (yalnız yönetici).
      { id: "software", label: "Yazılımlar", admin: true, parent: "system", retap: true, noIcon: true, create: u => new ankamon.page.Software(u) },
      // Kullanıcılar ▸ Kullanıcılar (yalnız yönetici) + Oturumlar ('logins'): features yöneticide her zaman
      // sağlanır; 'logins' yetkili kullanıcı sayfayı yalnız Oturumlar sekmesiyle görür (bkz. page.Users).
      { id: "users", label: "Kullanıcılar", features: ["logins"], parent: "system", noIcon: true, create: u => new ankamon.page.Users(u),
        tabs: [{ key: "users", label: "Hesaplar", admin: true }, { key: "logins", label: "Oturumlar", feature: "logins" }] },
      // admin/feature yok: herkese açık (kendi tema tercihini herkes değiştirebilir); sayfa içinde
      // sistem ayarları (SSH/Samba/keşif) yalnız admin'e gösterilir — bkz. page.Settings. Sistem
      // yalnız yöneticiye açık olduğundan diğer kullanıcılarda kökte görünür (bkz. __createTree).
      // Sekmeler yalnız yöneticide (diğer kullanıcı yalnız kendi temasını görür, sekme yok).
      { id: "settings", label: "Ayarlar", parent: "system", noIcon: true, create: u => new ankamon.page.Settings(u),
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
    __dropTarget: null,
    __dropLine: null,
    __dragGhost: null,
    __navPath: null,

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
        // Kök gizliyken birinci düzey klasörlerin (Bakım, Ağ, Sistem) aç/kapa oku yalnız bununla
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
      // Üst sayfa kullanıcıya kapalıysa bir üstündekinin altına; hiçbiri açık değilse kökte (ör. Bakım kapalı → Anomaliler).
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
      // Sıralanabilen YALNIZ Ağ'ın alt seçenekleri (kullanıcı isteği 2026-11-10): ana düğümler ve diğer alt menüler sabit.
      // Varlıklar her zaman en üstte, taşınamaz (bkz. __pinnedChild). Kayıtlı sıra uygulanır.
      this.__nodes.filter(n => n instanceof qx.ui.tree.TreeFolder && n.getUserData("page").id === "boards").forEach(n => {
        n.getChildren().forEach(child => this.__makeChildReorderable(child));
        this.__applyChildOrder(n);
      });
      // Aç/kapa oku (Fluent teması satır içi SVG çizer): satır içi SVG yazı taban çizgisine oturup okun aşağı kaymasına yol
      // açıyordu (kullanıcı bildirimi 2026-11-10: kapalı düğümün ▸'si yazının alt kenarına yakın) — ağaçta blok çizilir.
      if (!document.getElementById("ankamon-nav-tree-css")) {
        const style = document.createElement("style");
        style.id = "ankamon-nav-tree-css";
        style.textContent = ".ankamon-nav-tree svg{display:block;width:100%;height:100%}";
        document.head.appendChild(style);
      }
      this.__tree.getContentElement().addClass("ankamon-nav-tree");

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
          // Varlık grubu düğümü: aynı sayfa o grubun üyelerine süzülür; Varlıklar: süzgeçsiz.
          this.__widget(item.getUserData("page")).setGroup(item.getUserData("assetGroup") || 0);
        }
        const tab = item.getUserData("tab");
        if (tab) {
          // Önce sekme seçilir, sonra sayfa gösterilir: sayfa açılınca doğrudan o sekmeyi yükler (tek yenileme).
          this.__widget(item.getUserData("page")).selectTab(tab);
        }
        const widget = this.__open(item.getUserData("page"));
        const self = item.getUserData("selfLeaf");
        if (self) {
          // Üst düğüm (ör. Tahtalar) = varsayılan alt seçeneği (Liste): vurgu ona geçer, sayfa zaten açıldı.
          qx.event.Timer.once(() => {
            this.__reveal(self);
            this.__silentTree = true;
            this.__tree.setSelection([self]);
            this.__silentTree = false;
          }, this, 0);
        } else if (!tab && this.__tabsOf(item.getUserData("page")).length) {
          // Seçim olayının içinde ağaç seçimi değiştirilemiyor (geri alınıyor): bir sonraki turda.
          qx.event.Timer.once(() => this.__selectTabLeaf(item.getUserData("page"), widget.currentTab()), this, 0);
        }
      });
      // Üst başlıktaki yol gösterimi ağacı izler: yeni sayfa/sekme ağaca girince orada da kendiliğinden görünür.
      this.__navPath.attach(this.__tree, item => {
        this.__reveal(item);
        this.__tree.setSelection([item]);
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
      folder.setOpen(saved === undefined ? !(page && (page.parent || page.collapsed)) : !!saved);
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
     * sekme yapraklarından SONRA, kendi alt sayfalarıyla (iç içe — ör. Bakım ▸ Anomaliler).
     * @param childrenOf {Function} sayfa id → ağaçta altında duracak sayfalar
     */
    __buildNode(page, childrenOf) {
      const all = childrenOf(page.id);
      // inline alt sayfa: kendi düğümü yok, sekmeleri doğrudan bu düğümün altında (ör. Tahtalar ▸ Sensörler/Ahenk).
      const children = all.filter(child => !child.inline);
      const inlineTabs = all.filter(child => child.inline).flatMap(child => this.__tabsOf(child).map(tab => ({ page: child, tab })));
      // noIcon: düğüm simgesiz (ICON'daki karakter sağ menüler vb. için kalır).
      const label = `${page.noIcon ? "" : ankamon.ui.Shell.ICON[page.id] || ""} ${page.label}`.trim();
      const tabs = this.__tabsOf(page).map(tab => ({ page, tab }));
      const branch = children.length || tabs.length || inlineTabs.length || page.selfLeaf;
      const node = branch ? new qx.ui.tree.TreeFolder(label) : new qx.ui.tree.TreeFile(label);
      this.__hideThemeIcon(node);
      node.setUserData("page", page);
      if (page.retap) {
        this.__addRetap(node);
      }
      // first: true alt sayfalar üst düğümün kendi seçeneğinden (selfLeaf) ÖNCE (ör. Ağ ▸ Liste, Akıllı Tahtalar).
      children.filter(child => child.first).forEach(child => node.add(this.__buildNode(child, childrenOf)));
      // underSelf: alt sayfa / satır içi sekme üst düğümün kendi seçeneğinin (selfLeaf) ALTINDA (ör. Ağ ▸ Akıllı Tahtalar ▸
      // Ahenk, Ligler); o zaman kendi seçeneği de klasör olur (kendisine tıklamak yine sayfayı açar).
      const underSelf = page.selfLeaf ? children.filter(child => child.underSelf && !child.first) : [];
      const underSelfTabs = page.selfLeaf && inlineTabs.some(({ tab }) => tab.underSelf);
      let selfNode = null;
      if (page.selfLeaf) {
        // Sayfanın kendisi ilk alt seçenek (ör. Tahtalar ▸ Liste): üst düğüme tıklamak bunu seçer (bkz. changeSelection).
        const self = underSelf.length || underSelfTabs ? new qx.ui.tree.TreeFolder(page.selfLeaf) : new qx.ui.tree.TreeFile(page.selfLeaf);
        selfNode = self;
        this.__hideThemeIcon(self);
        self.setUserData("page", page);
        self.setUserData("self", true);
        this.__addRetap(self);
        node.add(self);
        node.setUserData("selfLeaf", self);
        if (self instanceof qx.ui.tree.TreeFolder) {
          this.__rememberOpen(self, `${page.id}.self`);
        }
      }
      // Sekmeler alt seçenek: seçilince sayfa o sekmede açılır; seçiliyken yeniden tıklamak sayfayı yeniler.
      // tab.group: aynı gruptaki sekmeler o adlı bir ara düğümün altında (ör. Ligler ▸ Teneffüsler ▸ Kullanıcılar); ara
      // düğüme tıklamak ilk sekmesini açar (selfLeaf gibi vurgu ona geçer).
      const groups = {};
      tabs.concat(inlineTabs).forEach(({ page: owner, tab }) => {
        const leaf = new qx.ui.tree.TreeFile(tab.label);
        this.__hideThemeIcon(leaf);
        leaf.setUserData("page", owner);
        leaf.setUserData("tab", tab.key);
        this.__addRetap(leaf);
        if (!tab.group) {
          (tab.underSelf && selfNode ? selfNode : node).add(leaf);
          return;
        }
        let group = groups[tab.group];
        if (!group) {
          group = groups[tab.group] = new qx.ui.tree.TreeFolder(tab.group);
          this.__hideThemeIcon(group);
          group.setUserData("page", owner);
          group.setUserData("tab", tab.key);
          group.setUserData("group", true);
          group.setUserData("selfLeaf", leaf);
          node.add(group);
          this.__rememberOpen(group, `${page.id}.${tab.group}`);
        }
        group.add(leaf);
      });
      underSelf.forEach(child => selfNode.add(this.__buildNode(child, childrenOf)));
      children.filter(child => !child.first && !underSelf.includes(child)).forEach(child => node.add(this.__buildNode(child, childrenOf)));
      if (branch) {
        this.__rememberOpen(node, page.id);
      }
      return node;
    },

    /** Ağ ▸ Varlıklar: hep ilk alt seçenek, sürüklenemez ve önüne bir şey bırakılamaz (kullanıcı isteği 2026-11-10). */
    __pinnedChild(n) {
      return !!n && !n.getUserData("assetGroup") && !!n.getUserData("page") && n.getUserData("page").id === "network";
    },

    /**
     * Ağ'ın alt seçeneğini (Akıllı Tahtalar, Sensörler, varlık grupları) aynı düğüm içinde sürüklenebilir yapar. Sürüklerken
     * (kullanıcı isteği 2026-11-10: bırakmadan yeri görülsün) imleci izleyen bir etiket ve hedef satırın üstünde/altında
     * nereye yerleşeceğini gösteren kalın bir çizgi çizilir; bırakınca tam oraya (satırın üst yarısı: önüne, alt yarısı:
     * arkasına) geçer. Sıra kullanıcı başına ui_prefs'te ("nav.children.<ana düğüm>" — __childKey listesi) saklanır.
     */
    __makeChildReorderable(item) {
      if (item.getUserData("childReorder")) {
        return;
      }
      item.setUserData("childReorder", true);
      if (this.__pinnedChild(item)) {
        item.set({ droppable: true }); // üzerine bırakılınca arkasına geçer (önüne değil — bkz. __dropPlace)
      } else {
        item.set({ draggable: true, droppable: true });
        item.addListener("dragstart", e => {
          e.addAction("move");
          this.__dragItem = item;
          this.__dragFeedback(item.getLabel());
        });
        item.addListener("drag", e => {
          this.__moveDragFeedback(e.getDocumentLeft(), e.getDocumentTop());
          this.__showDropLine(e.getDocumentTop());
        });
        item.addListener("dragend", () => {
          this.__dragItem = null;
          this.__dropTarget = null;
          this.__hideDragVisuals();
        });
      }
      item.addListener("dragover", e => {
        // qx: preventDefault = bu hedefe bırakılamaz. Yalnız aynı düğümün kardeşleri arasında.
        const dragged = this.__dragItem;
        if (!dragged || dragged === item || dragged.getParent() !== item.getParent()) {
          e.preventDefault();
          return;
        }
        this.__dropTarget = item;
      });
      item.addListener("dragleave", () => {
        if (this.__dropTarget === item) {
          this.__dropTarget = null;
          this.__showDropLine(null);
        }
      });
      item.addListener("drop", e => {
        const dragged = this.__dragItem;
        const parent = item.getParent();
        if (!dragged || dragged === item || dragged.getParent() !== parent) {
          return;
        }
        const after = this.__dropPlace(item, e.getDocumentTop()) === "after";
        const order = parent.getChildren().filter(n => n !== dragged);
        order.splice(order.indexOf(item) + (after ? 1 : 0), 0, dragged);
        parent.add(...order); // add() zaten-ebeveynli öğeyi önce oradan söker (sırayla yeniden ekler).
        const key = "nav.children." + parent.getUserData("page").id;
        const value = order.map(n => this.__childKey(n));
        const prefs = this.__user.ui_prefs || (this.__user.ui_prefs = {});
        prefs[key] = value;
        ankamon.io.Api.put("/auth/prefs", { key, value }).catch(() => {});
      });
    },

    /** Bırakma yeri: satırın üst yarısı "before", alt yarısı "after"; sabit Varlıklar'ın önüne bırakılamaz. */
    __dropPlace(target, pageY) {
      const el = target.getContentElement().getDomElement();
      if (!el) {
        return "after";
      }
      const r = el.getBoundingClientRect();
      const y = pageY - window.scrollY;
      return this.__pinnedChild(target) || y > r.top + r.height / 2 ? "after" : "before";
    },

    /** Hedef satırın üst/alt kenarında yerleşme çizgisi (pageY null: gizle). */
    __showDropLine(pageY) {
      const target = this.__dropTarget;
      const el = target && pageY !== null ? target.getContentElement().getDomElement() : null;
      if (!this.__dropLine) {
        const line = this.__dropLine = document.createElement("div");
        line.style.cssText = "position:fixed;height:3px;border-radius:2px;background:#1a73e8;box-shadow:0 0 0 1px #fff;" +
          "pointer-events:none;z-index:100000;display:none";
        document.body.appendChild(line);
      }
      if (!el) {
        this.__dropLine.style.display = "none";
        return;
      }
      const r = el.getBoundingClientRect();
      const label = target.getChildControl("label").getContentElement().getDomElement();
      const left = label ? label.getBoundingClientRect().left : r.left;
      const top = this.__dropPlace(target, pageY) === "after" ? r.bottom - 1 : r.top - 2;
      Object.assign(this.__dropLine.style, { display: "block", left: left + "px", top: top + "px", width: Math.max(40, r.right - left - 8) + "px" });
    },

    /** İmleci izleyen yarı saydam etiket (sürüklenen seçeneğin adı). */
    __dragFeedback(text) {
      if (!this.__dragGhost) {
        const ghost = this.__dragGhost = document.createElement("div");
        ghost.style.cssText = "position:fixed;padding:3px 10px;border-radius:6px;background:rgba(26,115,232,.92);color:#fff;" +
          "font:13px sans-serif;pointer-events:none;z-index:100001;display:none;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25)";
        document.body.appendChild(ghost);
      }
      this.__dragGhost.textContent = "↕ " + text;
    },

    __moveDragFeedback(pageX, pageY) {
      if (this.__dragGhost) {
        Object.assign(this.__dragGhost.style, { display: "block", left: (pageX - window.scrollX + 14) + "px", top: (pageY - window.scrollY + 8) + "px" });
      }
    },

    __hideDragVisuals() {
      [this.__dropLine, this.__dragGhost].filter(Boolean).forEach(el => { el.style.display = "none"; });
    },

    /** Alt seçeneğin kalıcı kimliği (sıra kaydı için): grup, sayfanın kendi seçeneği, sekme ya da alt sayfa. */
    __childKey(n) {
      if (n.getUserData("assetGroup")) {
        return "group:" + n.getUserData("assetGroup");
      }
      if (n.getUserData("self")) {
        return "self";
      }
      if (n.getUserData("tab")) {
        return "tab:" + n.getUserData("page").id + ":" + n.getUserData("tab");
      }
      return "page:" + (n.getUserData("page") ? n.getUserData("page").id : n.getLabel());
    },

    /**
     * Kayıtlı alt seçenek sırasını uygular: kayıttakiler o sırayla, kayıtta olmayanlar (yeni grup vb.) mevcut yerlerinde.
     * Varlıklar (__pinnedChild) her durumda en üstte.
     */
    __applyChildOrder(folder) {
      const saved = ((this.__user.ui_prefs || {})["nav.children." + folder.getUserData("page").id]) || [];
      const pinned = folder.getChildren().find(n => this.__pinnedChild(n));
      if (!saved.length) {
        if (pinned && folder.getChildren()[0] !== pinned) {
          folder.addAt(pinned, 0);
        }
        return;
      }
      const kids = folder.getChildren().slice();
      const rank = new Map(saved.map((k, i) => [k, i]));
      const known = kids.filter(n => rank.has(this.__childKey(n))).sort((a, b) => rank.get(this.__childKey(a)) - rank.get(this.__childKey(b)));
      // Kayıtlı olanlar kendi aralarında kayıt sırasına girer; kayıtsızlar bulundukları konumu korur.
      let i = 0;
      const order = kids.map(n => (rank.has(this.__childKey(n)) ? known[i++] : n));
      if (pinned) {
        order.splice(order.indexOf(pinned), 1);
        order.unshift(pinned);
      }
      folder.add(...order);
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

    /**
     * Varlık gruplarının yapraklarını sunucudaki gruplarla eşitler: Ağ düğümünün DOĞRUDAN altında (kullanıcı isteği
     * 2026-11-10), varsayılan yeri Varlıklar'ın hemen ardı (ada göre); kullanıcının kayıtlı alt seçenek sırası uygulanır.
     * Yaprak seçilince Varlıklar sayfası o grubun üyelerine süzülür (bkz. changeSelection, page.Network setGroup).
     */
    __syncAssetGroups(groups) {
      const network = this.__tree.getRoot().getItems(true).find(n => n.getUserData("page") && n.getUserData("page").id === "network" &&
        !n.getUserData("assetGroup"));
      const folder = network && network.getParent() instanceof qx.ui.tree.TreeFolder && network.getParent() !== this.__tree.getRoot()
        ? network.getParent() : null;
      if (!folder) {
        return;
      }
      const old = folder.getChildren().filter(n => n.getUserData("assetGroup"));
      // Sıradan bağımsız (kullanıcı grupları sürükleyerek yeniden dizmiş olabilir); ad ve üye sayısı değişince güncellenir.
      const sig = (id, name, n) => `${id}\u0000${name}\u0000${n}`;
      const have = new Set(old.map(n => sig(n.getUserData("assetGroup"), n.getLabel(), n.getUserData("memberCount"))));
      const sameList = old.length === groups.length && groups.every(g => have.has(sig(g.id, g.name, g.members.length)));
      if (sameList) {
        return;
      }
      const selected = this.__tree.getSelection()[0];
      const selectedId = selected && selected.getUserData("assetGroup");
      this.__silentTree = true;
      try {
        old.forEach(n => {
          folder.remove(n);
          n.dispose();
        });
        let at = folder.getChildren().indexOf(network) + 1;
        groups.forEach(group => {
          const leaf = new qx.ui.tree.TreeFile(group.name);
          this.__hideThemeIcon(leaf);
          leaf.setUserData("page", network.getUserData("page")); // Varlıklar sayfası (üst düğüm Ağ/Akıllı Tahtalar değil)
          leaf.setUserData("assetGroup", group.id);
          leaf.setUserData("memberCount", group.members.length);
          leaf.setToolTipText(`${group.name}: ${group.members.length} varlık (Varlıklar'dan türer; sürükleyerek yeri değişir)`);
          this.__addRetap(leaf);
          folder.addAt(leaf, at++);
          this.__makeChildReorderable(leaf);
          if (group.id === selectedId) {
            this.__tree.setSelection([leaf]);
          }
        });
        this.__applyChildOrder(folder);
        if (selectedId && !groups.some(g => g.id === selectedId)) {
          this.__tree.setSelection([network]);
        }
      } finally {
        this.__silentTree = false;
      }
      this.__styleNavLevels();
    },

    /** Bkz. OPEN_PAGE. Ağaçtaki vurgu da açılan sayfaya taşınır (sessizce — çift yenileme olmasın). */
    __openPage(data) {
      if (data.diskUsage) {
        data = { page: "diskusage", tab: data.diskUsage }; // Disk kullanımı sayfası, o sekmede
      }
      if (data.page === "metrics") {
        data = { ...data, page: "diagnose", tab: "metrics" }; // Sensörler: "diagnose" sayfasının sekmesi (Tahtalar altında)
      }
      if (data.page === "sessions" && ["league", "breakLeague"].includes(data.tab)) {
        data = { ...data, page: "leagues" }; // sıralamalar Ligler sayfasında
      }
      if (data.page === "diagnose" && (!data.tab || data.tab === "diagnose" || data.tab === "help")) {
        data = { ...data, page: "anomalies", tab: data.tab === "help" ? "help" : "reports" }; // sorun tespiti Sağlık'ta
      }
      const page = ankamon.ui.Shell.PAGES.find(p => p.id === data.page);
      if (!page || !this.__allowed(page)) {
        return;
      }
      // Alt düğümler de aranır (ör. "Bakım" altındaki "Anomaliler"); kip yaprakları hariç. İstenen
      // sekmenin yaprağı varsa o (ör. Genel bakış ▸ Sensörler → Bakım ▸ Sensörler), yoksa sayfanın düğümü.
      const items = this.__tree.getRoot().getItems(true);
      const leaf = (data.group && items.find(n => n.getUserData("page") === page && n.getUserData("assetGroup") === data.group)) ||
        (data.tab && items.find(n => n.getUserData("page") === page && n.getUserData("tab") === data.tab && !n.getUserData("group"))) ||
        items.find(n => n.getUserData("page") === page && n.getUserData("self")) ||
        items.find(n => n.getUserData("page") === page && !n.getUserData("tab"));
      if (leaf) {
        this.__reveal(leaf);
        this.__silentTree = true;
        this.__tree.setSelection([leaf]);
        this.__silentTree = false;
      }
      if (page.id === "network") {
        this.__widget(page).setGroup(data.group || 0); // {page: "network", group: id} — bkz. page.Network setGroup
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
        .find(n => n.getUserData("page") === page && n.getUserData("tab") === key && !n.getUserData("group"));
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

    /** Logonun altındaki "v0.1.0 · abc1234" satırı; bilgi gelene kadar yer kaplamaz. */
    __createBuildStampLabel() {
      const label = new qx.ui.basic.Label().set({
        font: "app-surum-damgasi", textColor: "app-header-text", opacity: 0.75, visibility: "excluded"
      });
      ankamon.io.Api.get("/surum-damgasi").then(stamp => {
        const parts = [stamp.version && `v${stamp.version}`, stamp.commit].filter(Boolean);
        if (!parts.length) {
          return;
        }
        label.setValue(parts.join(" · "));
        if (stamp.built_at) {
          label.setToolTipText(`Derleme: ${new Date(stamp.built_at).toLocaleString("tr-TR")}`);
        }
        label.show();
      }).catch(() => null);
      return label;
    },

    __createHeader() {
      const header = new qx.ui.container.Composite(new qx.ui.layout.HBox(10).set({ alignY: "middle" })).set({
        padding: [8, 14],
        backgroundColor: "app-header"
      });
      // Sol menüyü katlama (kullanıcı isteği 2026-11-10: üst paneli katlayan düğme gibi ok — açıkken sola, katlıyken sağa).
      const arrow = path => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"` +
        ` stroke-linecap="round" stroke-linejoin="round" style="display:block;pointer-events:none"><path d="${path}"/></svg>`;
      const LEFT = "M15 6l-6 6l6 6";
      const RIGHT = "M9 6l6 6l-6 6";
      const fold = new qx.ui.form.Button(arrow(LEFT)).set({ rich: true, center: true, toolTipText: "Menüyü gizle", width: 36 });
      fold.getChildControl("label").set({ minWidth: 18, minHeight: 18 });
      fold.addListener("execute", () => {
        const show = !this.__navPane.isVisible();
        this.__navPane.setVisibility(show ? "visible" : "excluded");
        fold.set({ label: arrow(show ? LEFT : RIGHT), toolTipText: show ? "Menüyü gizle" : "Menüyü göster" });
      });
      header.add(fold);
      // Logo simgesi: ekran çerçevesi başlık yazısının renginde (temaların koyu/mavi başlık zemininde seçilsin).
      // Tıklanınca geliştiriciye anonim mesaj penceresi (bkz. ui.DeveloperContactWindow).
      const logo = new qx.ui.basic.Label(ankamon.ui.Logo.icon(32, "currentColor")).set({
        rich: true, textColor: "app-header-text", cursor: "pointer", toolTipText: "Geliştiriciye yazın: eleştiri, öneri, teşekkür…"
      });
      logo.addListener("tap", () => ankamon.ui.DeveloperContactWindow.open());
      header.add(logo);
      const brand = new qx.ui.container.Composite(new qx.ui.layout.VBox()).set({ backgroundColor: "app-header" });
      // "Ankamon > Bakım > Sensörler": sayfa başlıklarının yerine (bkz. ui.ShellNavPath; ağaçtan beslenir — __createTree).
      this.__navPath = new ankamon.ui.ShellNavPath();
      brand.add(this.__navPath);
      brand.add(this.__createBuildStampLabel());
      header.add(brand);
      header.add(new qx.ui.core.Spacer(), { flex: 1 });
      header.add(new qx.ui.basic.Label(this.__user.full_name || this.__user.username).set({ textColor: "app-header-text" }));
      const logout = new qx.ui.form.Button("Çıkış");
      logout.addListener("execute", async () => {
        await ankamon.io.Api.post("/auth/logout").catch(() => null);
        qx.event.message.Bus.dispatchByName(ankamon.io.Api.UNAUTHORIZED);
      });
      header.add(logout);
      return this.__foldableHeader(header);
    },

    /**
     * Üst panel katlanabilir (kullanıcı isteği: dikey alan). Katlıyken yerinde ince bir şerit ve ortasında "Üst paneli göster"
     * düğmesi kalır; şeride ya da düğmeye tıklayınca panel geri açılır. Durum kullanıcı başına sunucuda kaydedilir ve girişte
     * oradan yüklenir (users.ui_prefs["header.folded"], bkz. AuthApi::prefs ve /auth/me).
     *
     * Oklar SVG (Tabler Icons chevron-up/down, MIT): "▴/▾" karakterleri bazı temaların yazı tipinde (ör. macOS) neredeyse
     * görünmüyordu (kullanıcı bildirimi). Düğmeler temanın kendi düğme görünümünde: her temada seçilir.
     */
    __foldableHeader(header) {
      const prefs = this.__user.ui_prefs || (this.__user.ui_prefs = {});
      const chevron = (path, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
        ` stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="display:block;pointer-events:none"><path d="${path}"/></svg>`;
      // pointer-events:none: tıklama SVG'ye düşünce bazı temalarda (Bernstein) düğmeye iletilmiyordu; düğmenin kendi öğesi alır.
      const UP = "M6 15l6 -6l6 6";
      const DOWN = "M6 9l6 6l6 -6";
      // rich düğmenin kendisine (Atom) verilir: etikete sonradan verilince boyut düz metne göre ölçülüyor, ok kırpılıyordu.
      const iconButton = (html, tip) => new qx.ui.form.Button(html).set({ rich: true, toolTipText: tip, center: true });
      const hide = iconButton(chevron(UP, 18), "Üst paneli gizle (yerinde kalan şeritten geri açılır)").set({ width: 36 });
      hide.getChildControl("label").set({ minWidth: 18, minHeight: 18 });
      header.add(hide);
      const strip = new qx.ui.container.Composite(new qx.ui.layout.HBox().set({ alignX: "center", alignY: "middle" })).set({
        backgroundColor: "app-header", padding: [2, 0], cursor: "pointer", toolTipText: "Üst paneli göster"
      });
      const showButton = iconButton(
        `<span style="display:inline-flex;align-items:center;gap:6px">${chevron(DOWN, 16)}` +
        '<span style="font-size:12px;line-height:16px">Üst paneli göster</span></span>', "Üst paneli göster").set({ padding: [1, 12] });
      strip.add(showButton);
      const apply = folded => {
        header.setVisibility(folded ? "excluded" : "visible");
        strip.setVisibility(folded ? "visible" : "excluded");
      };
      const set = folded => {
        apply(folded);
        prefs["header.folded"] = folded;
        ankamon.io.Api.put("/auth/prefs", { key: "header.folded", value: folded }).catch(() => {
          // Kalıcılık kaybı önemsiz: bir sonraki katlamada yeniden gönderilir.
        });
      };
      hide.addListener("execute", () => set(true));
      showButton.addListener("execute", () => set(false));
      strip.addListener("tap", e => {
        if (e.getTarget() === strip) {
          set(false); // şeridin boş yeri; düğmenin kendi tıklaması execute ile
        }
      });
      apply(!!prefs["header.folded"]);
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox());
      box.add(header);
      box.add(strip);
      return box;
    }
  }
});
