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
 * Disk kullanımı ve veri silme (Sistem altında; 'logs.manage' yetkisiyle — eski açılır pencere,
 * kullanıcı isteğiyle sayfa oldu). İlk sekme "Özet": veri türlerinin kapladığı alan daire grafikte,
 * dilime tıklayınca ilgili sekme açılır (bkz. ui.DiskUsageSummary). Diğer sekmeler ui.DiskUsageTab
 * (türlere özgü kısımlar ui.DiskUsage.specs()).
 */
qx.Class.define("ankamon.page.DiskUsage", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, "Disk kullanımı");
    this.__tabs = new qx.ui.tabview.TabView();
    const specs = ankamon.ui.DiskUsage.specs();
    this.__summary = new ankamon.ui.DiskUsageSummary(specs, mode => this.openWith({ tab: mode }));
    // Sekme kimlikleri ağaçtaki alt seçeneklerle aynı (bkz. ui.Shell PAGES tabs): "summary" + spec.mode.
    this.__summary.setUserData("key", "summary");
    this.__tabs.add(this.__summary);
    specs.forEach(spec => {
      const tab = new ankamon.ui.DiskUsageTab(this, spec);
      tab.setUserData("key", spec.mode);
      this.__tabs.add(tab);
    });
    this._rememberTab(this.__tabs, "diskusage"); // son seçili sekme (bkz. Base._rememberTab)
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
