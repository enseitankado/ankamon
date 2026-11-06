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
 * Tahtalar ▸ Sensörler / Ahenk (sol menüde Tahtalar altında, eski "Bakım"): sekmeler — "Sensörler" (Grafana panosu, page.Metrics) ve eklenti sekmeleri (ör. "Ahenk"). Sorun
 * tespiti raporu (page.Diagnose) ve yardımı (page.MaintenanceHelp) "Tahta sağlığı"na taşındı (bkz. page.Anomalies);
 * eski {tab: "diagnose"|"help"} istekleri oraya yönlenir. Her sekme yalnız kendi yetkisiyle görünür (bkz. ui.Shell PAGES).
 *
 * İçteki sayfalar olduğu gibi kullanılır: sayfa açılınca ya da sekme değişince görünen sekmenin sayfası
 * activate() edilir (kendi yenilemesi). openWith({tab: "metrics"|"diagnose"}) o sekmeyi seçer —
 * Genel bakış'ın "Sensörler" bağlantıları buraya gelir.
 */
qx.Class.define("ankamon.page.Maintenance", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, null);
    this._actions.exclude();
    this.__tabs = new qx.ui.tabview.TabView();
    const add = (key, label, feature, create) => {
      if (feature && !this._can(feature)) {
        return;
      }
      const tab = new qx.ui.tabview.Page(label).set({ layout: new qx.ui.layout.Grow(), padding: 8 });
      tab.setUserData("key", key);
      tab.setUserData("page", create(user));
      tab.add(tab.getUserData("page"));
      // Sayfa kendi sekme kulakçığına ipucu verebilir (ör. Bakım: ne yaptığı + otomatik tarama takvimi).
      if (tab.getUserData("page").bindTabButton) {
        tab.getUserData("page").bindTabButton(tab.getButton());
      }
      this.__tabs.add(tab);
    };
    add("metrics", "Sensörler", "metrics", u => new ankamon.page.Metrics(u));
    // Eklentiler Bakım'a sekme ekleyebilir (bkz. ankamon.ext.Extensions.addMaintenanceTab). Ahenk artık bir
    // eklenti (ext/ankamon-ahenk) ve kendi init'inde etkinse bu sekmeyi kaydeder; burada yalnız yetki bakılır.
    ankamon.ext.Extensions.maintenanceTabs().forEach(t => add(t.key, t.label, t.feature, t.create));
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
      if (opts && (opts.tab === "diagnose" || opts.tab === "help")) {
        qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_PAGE, { page: "anomalies", tab: opts.tab === "help" ? "help" : "reports" });
        return;
      }
      const tab = this.__tabs.getChildren().find(t => t.getUserData("key") === (opts && opts.tab));
      if (tab && this.__tabs.getSelection()[0] !== tab) {
        this.__tabs.setSelection([tab]);
      }
    }
  }
});
