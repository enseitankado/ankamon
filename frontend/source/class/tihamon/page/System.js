/**
 * Sistem (yalnız yönetici): Tiha-Mon konteynerinin kendisini izleme ve bakım — arka plan servisleri,
 * zamanlanmış veritabanı işleri, veritabanı, yapılandırma. Her sekme ayrı bir ui.system.* sınıfıdır;
 * backend: ServicesApi, SystemInfoApi (/api/system/*).
 */
qx.Class.define("tihamon.page.System", {
  extend: tihamon.page.Base,

  construct(user) {
    super(user, "Sistem");
    // "Yenile" düğmesi yok (kullanıcı isteği): sayfa her açıldığında (ya da ağaçta yeniden tıklanınca)
    // görünen sekme yüklenir — bkz. page.Base.activate, ui.Shell.__addRetap; sekme geçişinde de (ui.system.Tab).
    this.__tabs = new qx.ui.tabview.TabView();
    [tihamon.ui.system.Overview, tihamon.ui.system.Services, tihamon.ui.system.Schedules,
      tihamon.ui.system.Database, tihamon.ui.system.Config]
      .forEach(Tab => this.__tabs.add(new Tab(this)));
    this.add(this.__tabs, { flex: 1 });
  },

  members: {
    __tabs: null,

    /** Shell OPEN_PAGE: {tab: "database"} → Veritabanı sekmesini seçer (Genel bakış "Veritabanı" kartı). */
    openWith(opts) {
      const Tab = { database: tihamon.ui.system.Database }[opts.tab];
      const tab = Tab && this.__tabs.getChildren().find(t => t instanceof Tab);
      if (tab) {
        this.__tabs.setSelection([tab]); // sekme görününce kendini yükler (ui.system.Tab "appear")
      }
    },

    /** Sayfa her açıldığında: yalnız görünen sekme yeniden yüklenir (diğerleri açılınca). */
    async _refresh() {
      const tab = this.__tabs.getSelection()[0];
      if (tab) {
        await tab.load();
      }
    }
  }
});
