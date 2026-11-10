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
 * Sağlık (sol menüde; eski "Bakım ▸ Bakım" sorun tespiti raporu ile "Anomaliler" tek bölümde): tahtaların donanım,
 * yazılım ve ağ sorunlarını önden görmek, aksiyon gereken durumları bulmak. Sayfa kimliği "anomalies" kalır (yetki,
 * nav_order, hatırlanan sekme kayıtları).
 *
 * Bulgular iki yoldan gelir; kullanıcı her bulguda hangisinden geldiğini görür (bkz. ui.health.Status):
 *   - Sürekli izleme (yetki "anomalies"): tahtaya bağlanmadan, loglardan/ölçümlerden birkaç dakikada bir (worker/ankamon/anomaly).
 *   - SSH denetimi (yetki "diagnose"): Ankamon tahtaya SSH ile girip ölçer; haftalık otomatik ya da Tara'dan elle
 *     (worker/ankamon/executor/diagnose.py).
 *
 * Sekmeler (bu sırayla; her biri yalnız kendi yetkisiyle):
 *  - "Durum" (ui.health.Status): her tahtanın şu anki sağlığı, iki yolun bulguları tek tabloda (GET /api/board-health).
 *  - "Denetle" (page.Diagnose; kimlik "reports", eski adı "Denetim raporları"): SSH denetimlerinin raporları (eski Bakım
 *    sekmesi). Durum'un hemen sağında (kullanıcı isteği).
 *  - "Geçmiş" (ui.anomaly.Records): sürekli izleme kayıtları, seçili dönem — üstte tahta × bulgu özeti, altta kayıtlar
 *    (eski "Geçmiş" ve "Özet" sekmeleri birleşti — kullanıcı isteği 2026-11-10). "Rapor dönemi" seçicisi sekmenin içinde.
 *  - "Tara" (ui.anomaly.Scan): seçilen tahtalarda o an yoklama — sürekli izleme denetimleri ve tam SSH denetimi.
 *  - "Bildirimler" (ui.anomaly.Notifications).
 *  - "Yardım": iç sekmeler "Kılavuz" (page.MaintenanceHelp) ve "Denetim türleri" (ui.health.Catalog — eski ayrı
 *    "Denetimler" sekmesi; satıra çift tık: ayrıntı ve yöneticiye ayarlar penceresi, bkz. ui.health.CheckTypeWindow).
 * Kayıtlar tahta silinse ya da logları silinse de kalır (bkz. 033_anomalies.sql).
 */
qx.Class.define("ankamon.page.Anomalies", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, null);
    const watch = this._can("anomalies");
    const ssh = this._can("diagnose");

    this._addButton("Yenile", () => this.refresh());

    this.__tabs = new qx.ui.tabview.TabView();
    this.__status = new ankamon.ui.health.Status(this);
    this.__tabs.add(this.__status);
    if (ssh) {
      this.__reportsPage = new ankamon.page.Diagnose(user);
      this.__reports = this.__hosted("reports", "Denetle", this.__reportsPage);
    }
    if (watch) {
      this.__history = new ankamon.ui.anomaly.Records(this, this.__periodRow());
      this.__tabs.add(this.__history);
    }
    if (watch || ssh) {
      this.__scan = new ankamon.ui.anomaly.Scan(this);
      this.__tabs.add(this.__scan);
    }
    if (watch) {
      this.__notifications = new ankamon.ui.anomaly.Notifications(this);
      this.__tabs.add(this.__notifications);
    }
    // Yardım: kılavuz + Denetim türleri (iç sekmeler). Sekme seçilince kılavuz sayfası activate() edilir (userData page).
    this.__help = new qx.ui.tabview.Page("Yardım").set({ layout: new qx.ui.layout.Grow(), padding: 8 });
    this.__help.setUserData("key", "help");
    this.__helpTabs = new qx.ui.tabview.TabView();
    const guidePage = new ankamon.page.MaintenanceHelp(user);
    const guide = new qx.ui.tabview.Page("Kılavuz").set({ layout: new qx.ui.layout.Grow(), padding: 4 });
    guide.add(guidePage);
    this.__helpTabs.add(guide);
    this.__catalog = new ankamon.ui.health.Catalog(this);
    this.__helpTabs.add(this.__catalog);
    this.__help.setUserData("page", guidePage);
    this.__help.add(this.__helpTabs);
    this.__tabs.add(this.__help);
    this._rememberTab(this.__tabs, "anomalies");
    // Gömülü sayfalar (Denetle, Yardım) kendi verilerini sekmeye geçilince tazeler.
    this.__tabs.addListener("changeSelection", e => {
      const hosted = e.getData()[0] && e.getData()[0].getUserData("page");
      if (hosted) {
        hosted.activate();
      }
    });
    this.add(this.__tabs, { flex: 1 });

    this.__timer = new qx.event.Timer(ankamon.page.Anomalies.REFRESH_MS);
    this.__timer.addListener("interval", this.refresh, this);
    this.__timer.start();
  },

  statics: {
    REFRESH_MS: 30000,
    /** [gün (0 = tümü), etiket] */
    PERIODS: [[1, "Son 24 saat"], [7, "Son 7 gün"], [30, "Son 30 gün"], [90, "Son 90 gün"], [365, "Son 1 yıl"], [0, "Tümü"]],
    /** Eski sekme kimlikleri (sol menü, hatırlanan sekme, bağlantılar) → yenisi. */
    OLD_TABS: { "Anlık": "status", "diagnose": "reports", "catalog": "help", "summary": "Geçmiş" },

    /** Kaydın ayrıntı metni (türe göre). */
    describe(a) {
      const d = a.detail || {};
      if (a.kind === "no_login") {
        const after = d.reason === "logout"
          ? `Son oturum${d.user ? " (" + d.user + ")" : ""} kapandıktan sonra açık kaldı`
          : "Açılıştan beri oturum açılmadı";
        return after;
      }
      if (a.kind === "ntp_unsynced") {
        const parts = [];
        if (d.unsynced) {
          parts.push("Saat NTP ile eşitlenmemiş");
        }
        if (d.offset_max_s !== null && d.offset_max_s !== undefined && Math.abs(d.offset_max_s) > 1) {
          parts.push(`sunucuya göre en çok ${Math.round(Math.abs(d.offset_max_s))} sn sapma`);
        }
        return parts.join("; ") || "Saat eşitlenmemiş";
      }
      // Eklenti kuralları ayrıntı metnini kendileri verir (detail.text — bkz. worker anomaly eklenti kancası).
      return d.text || "";
    }
  },

  destruct() {
    if (this.__timer) {
      this.__timer.stop();
      this.__timer.dispose();
    }
  },

  members: {
    __timer: null,
    __tabs: null,
    __status: null,
    __history: null,
    __reports: null,
    __reportsPage: null,
    __scan: null,
    __catalog: null,
    __helpTabs: null,
    __days: 30,
    __periodBoxes: null,
    __notifications: null,
    __help: null,

    /** Başka bir sayfayı (Base) sekme olarak barındırır; sekme seçilince o sayfa activate() edilir. */
    __hosted(key, label, page) {
      const tab = new qx.ui.tabview.Page(label).set({ layout: new qx.ui.layout.Grow(), padding: 8 });
      tab.setUserData("key", key);
      tab.setUserData("page", page);
      tab.add(page);
      if (page.bindTabButton) {
        page.bindTabButton(tab.getButton());
      }
      this.__tabs.add(tab);
      return tab;
    },

    /** "Rapor dönemi" satırı (Geçmiş ve Özet'in tepesinde); bütün seçiciler aynı değeri gösterir. */
    __periodRow() {
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      row.add(new qx.ui.basic.Label("Rapor dönemi:"));
      const box = new qx.ui.form.SelectBox().set({ width: 140, toolTipText: "Geçmiş ve Özet bu dönemi gösterir; Durum her zaman şu anı." });
      ankamon.page.Anomalies.PERIODS.forEach(([days, label]) => {
        const item = new qx.ui.form.ListItem(label, null, days);
        box.add(item);
        if (days === this.__days) {
          box.setSelection([item]);
        }
      });
      box.addListener("changeSelection", e => {
        const item = e.getData()[0];
        if (!item || item.getModel() === this.__days) {
          return;
        }
        this.__days = item.getModel();
        // Öteki sekmenin seçicisi de aynı döneme geçsin.
        (this.__periodBoxes || []).forEach(other => {
          const same = other.getChildren().find(it => it.getModel() === this.__days);
          if (other !== box && same) {
            other.setSelection([same]);
          }
        });
        this.refresh();
      });
      (this.__periodBoxes = this.__periodBoxes || []).push(box);
      row.add(box);
      return row;
    },

    async _refresh() {
      const tasks = [ankamon.io.Api.get("/board-health")];
      if (this.__history) {
        const days = this.__days;
        const to = Math.floor(Date.now() / 1000);
        const from = days ? to - days * 86400 : 0;
        tasks.push(ankamon.io.Api.get("/anomalies", { from, to }).then(data => ({ data, from })));
      }
      const [health, anomalies] = await Promise.all(tasks);
      if (this.isDisposed()) {
        return;
      }
      this.__status.setData(health);
      this.__catalog.setData(health);
      if (anomalies) {
        const { data, from } = anomalies;
        const rows = data.anomalies.map(a => Object.assign(a, {
          kindLabel: (data.kinds[a.kind] || {}).label || a.kind,
          source: (data.kinds[a.kind] || {}).source || "",
          kindDesc: (data.kinds[a.kind] || {}).description || "",
          text: ankamon.page.Anomalies.describe(a)
        }));
        this.__history.setData(rows, from);
        this.__scan.setKinds(data.kinds, data.last_scan_job);
      } else if (this.__scan) {
        this.__scan.setKinds({}, null);
      }
      // Açık gömülü sayfa (rapor/yardım) da tazelensin.
      const hosted = this.__tabs.getSelection()[0] && this.__tabs.getSelection()[0].getUserData("page");
      if (hosted) {
        hosted.refresh();
      }
    },

    /** Bkz. ui.Shell OPEN_PAGE: {tab} o sekmeyi seçer; eski kimlikler (Anlık, diagnose) yenisine çevrilir. */
    openWith(opts) {
      const key = opts && (ankamon.page.Anomalies.OLD_TABS[opts.tab] || opts.tab);
      if (key) {
        this.selectTab(key);
      }
      if (opts && opts.tab === "catalog") {
        this.__helpTabs.setSelection([this.__catalog]);
      }
    },

    /**
     * Durum'da çift tık: sürekli izleme bulgusu → Geçmiş'te o tahta; SSH denetimi bulgusu → Denetle, tahta listesi o
     * tahtaya süzülmüş (Durum her tahtanın en son denetimini gösterdiğinden Denetle "Son durum"a geçer).
     */
    openFinding(f) {
      if (f.path === "watch" && this.__history) {
        this.showBoard(f.board);
      } else if (f.path === "ssh" && this.__reports) {
        this.__reportsPage.showBoard(f.board);
        this.__tabs.setSelection([this.__reports]);
      }
    },

    /** Durum'dan → o tahtanın Geçmiş'i (çift tık). */
    showBoard(board) {
      this.__tabs.setSelection([this.__history]);
      this.__history.showBoard(board);
    },

    /** Tara'da başlatılan SSH denetimi bitince raporuna geçmek için. */
    showReports() {
      if (this.__reports) {
        this.__tabs.setSelection([this.__reports]);
      }
    }
  }
});
