/**
 * Disk kullanımı ve veri silme (Sistem altında; 'logs.manage' yetkisiyle — eski açılır pencere,
 * kullanıcı isteğiyle sayfa oldu). İlk sekme "Özet": veri türlerinin kapladığı alan daire grafikte,
 * dilime tıklayınca ilgili sekme açılır (bkz. ui.DiskUsageSummary). Diğer sekmeler ui.DiskUsageTab
 * (türlere özgü kısımlar ui.DiskUsage.specs()).
 */
qx.Class.define("tihamon.page.DiskUsage", {
  extend: tihamon.page.Base,

  construct(user) {
    super(user, "Disk kullanımı");
    this.__tabs = new qx.ui.tabview.TabView();
    const specs = tihamon.ui.DiskUsage.specs();
    this.__summary = new tihamon.ui.DiskUsageSummary(specs, mode => this.openWith({ tab: mode }));
    this.__tabs.add(this.__summary);
    specs.forEach(spec => this.__tabs.add(new tihamon.ui.DiskUsageTab(this, spec)));
    this.add(this.__tabs, { flex: 1 });
  },

  members: {
    __tabs: null,
    __summary: null,

    /**
     * Shell OPEN_PAGE {diskUsage: mode} → {tab: mode}: o veri sekmesini seçer ("system" | "command" |
     * "queue" | "metrics" | "jobs" | "diagnose" | "backups"); bilinmeyen/boş anahtar Özet'i açar.
     */
    openWith(opts) {
      const tab = this.__tabs.getChildren().find(t => t.getSpec && t.getSpec().mode === opts.tab) || this.__summary;
      this.__tabs.setSelection([tab]);
    },

    /** Sayfa her açıldığında (ya da ağaçta yeniden tıklanınca): yalnız görünen sekme tazelenir. */
    async _refresh() {
      const tab = this.__tabs.getSelection()[0];
      if (tab) {
        await tab.load();
      }
    }
  }
});
