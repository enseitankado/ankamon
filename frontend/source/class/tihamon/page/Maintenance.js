/**
 * Bakım (sol menüde Tahtalar > Bakım): sekmeler — "Bakım" (sorun tespiti raporu, page.Diagnose),
 * "Sensörler" (Grafana panosu, page.Metrics) ve "Ahenk" (Ahenk kontrol sonuçları, page.Ahenk). Kullanıcı isteğiyle Sensörler ayrı menü öğesi olmaktan
 * çıkıp buraya taşındı. Her sekme yalnız kendi yetkisiyle görünür ("diagnose" / "metrics"); sayfa
 * ikisinden biri olan kullanıcıya açılır (bkz. ui.Shell PAGES features).
 *
 * İçteki sayfalar olduğu gibi kullanılır: sayfa açılınca ya da sekme değişince görünen sekmenin sayfası
 * activate() edilir (kendi yenilemesi). openWith({tab: "metrics"|"diagnose"}) o sekmeyi seçer —
 * Genel bakış'ın "Sensörler" bağlantıları buraya gelir.
 */
qx.Class.define("tihamon.page.Maintenance", {
  extend: tihamon.page.Base,

  construct(user) {
    super(user, null);
    this._actions.exclude();
    this.__tabs = new qx.ui.tabview.TabView();
    const add = (key, label, feature, Page) => {
      if (!this._can(feature)) {
        return;
      }
      const tab = new qx.ui.tabview.Page(label).set({ layout: new qx.ui.layout.Grow(), padding: 8 });
      tab.setUserData("key", key);
      tab.setUserData("page", new Page(user));
      tab.add(tab.getUserData("page"));
      this.__tabs.add(tab);
    };
    add("diagnose", "Bakım", "diagnose", tihamon.page.Diagnose);
    add("metrics", "Sensörler", "metrics", tihamon.page.Metrics);
    // Ahenk kontrol sonuçları (hazır işlem "Ahenk kontrol" — bkz. page.Ahenk).
    add("ahenk", "Ahenk", "diagnose", tihamon.page.Ahenk);
    this._rememberTab(this.__tabs, "maintenance"); // son seçili sekme (dinleyiciden önce: activate tetiklenmesin)
    this.__tabs.addListener("changeSelection", () => {
      const page = this.__current();
      if (page && !this.__switching) {
        page.activate();
      }
    });
    this.add(this.__tabs, { flex: 1 });
  },

  members: {
    __tabs: null,
    __switching: false,

    __current() {
      const tab = this.__tabs.getSelection()[0];
      return tab ? tab.getUserData("page") : null;
    },

    async _refresh() {
      const page = this.__current();
      if (page) {
        await page.refresh();
      }
    },

    /** Bkz. ui.Shell OPEN_PAGE: {tab: "metrics"|"diagnose"|"ahenk"} o sekmeyi seçer (ve sayfasını yeniler). */
    openWith(opts) {
      const tab = this.__tabs.getChildren().find(t => t.getUserData("key") === (opts && opts.tab));
      if (tab && this.__tabs.getSelection()[0] !== tab) {
        this.__tabs.setSelection([tab]);
      }
    }
  }
});
