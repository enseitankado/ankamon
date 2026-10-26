/**
 * Anomaliler (Tahtalar altında): ağdaki bilgisayarlarda işletim sistemi, donanım ve kullanıcı
 * davranışına dair sıra dışı durumlar. Veriyi worker'ın kuralları ön hesaplar (bkz.
 * worker/ankamon/anomaly, backend AnomaliesApi); ilk kural "Oturumsuz açık" (tahta 15 dk'dır açık,
 * oturum açılmamış).
 *
 * Üç sekme, tek veri (sayfa /anomalies'i dönemle çeker, sekmelere verir):
 *  - "Anlık" (ui.anomaly.Live): şu an süren anomaliler (dönemden bağımsız).
 *  - "Geçmiş" (ui.anomaly.History): dönemle örtüşen tüm kayıtlar, sütun süzgeçli.
 *  - "Tahta özeti" (ui.anomaly.Summary): tahta başına sayı/süre; çift tık → o tahtanın Geçmiş'i.
 * Kayıtlar tahta silinse ya da logları silinse de kalır (bkz. 033_anomalies.sql).
 */
qx.Class.define("ankamon.page.Anomalies", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, null);

    this._actions.add(new qx.ui.basic.Label("Rapor dönemi:").set({ alignY: "middle" }));
    this.__period = new qx.ui.form.SelectBox().set({ width: 140 });
    ankamon.page.Anomalies.PERIODS.forEach(([days, label]) => {
      const item = new qx.ui.form.ListItem(label, null, days);
      this.__period.add(item);
      if (days === 30) {
        this.__period.setSelection([item]);
      }
    });
    this.__period.setToolTipText("Geçmiş ve Tahta özeti bu dönemi gösterir; Anlık her zaman şu an sürenleri.");
    this.__period.addListener("changeSelection", () => this.refresh());
    this._actions.add(this.__period);
    this._addButton("Yenile", () => this.refresh());

    this.__tabs = new qx.ui.tabview.TabView();
    this.__live = new ankamon.ui.anomaly.Live(this);
    this.__history = new ankamon.ui.anomaly.History(this);
    this.__summary = new ankamon.ui.anomaly.Summary(this);
    [this.__live, this.__history, this.__summary].forEach(tab => this.__tabs.add(tab));
    this._rememberTab(this.__tabs, "anomalies");
    this.add(this.__tabs, { flex: 1 });

    this.__timer = new qx.event.Timer(ankamon.page.Anomalies.REFRESH_MS);
    this.__timer.addListener("interval", this.refresh, this);
    this.__timer.start();
  },

  statics: {
    REFRESH_MS: 30000,
    /** [gün (0 = tümü), etiket] */
    PERIODS: [[1, "Son 24 saat"], [7, "Son 7 gün"], [30, "Son 30 gün"], [90, "Son 90 gün"], [365, "Son 1 yıl"], [0, "Tümü"]],

    /** Kaydın ayrıntı metni (türe göre). */
    describe(a) {
      const d = a.detail || {};
      if (a.kind === "no_login") {
        const after = d.reason === "logout"
          ? `Son oturum${d.user ? " (" + d.user + ")" : ""} kapandıktan sonra açık kaldı`
          : "Açılıştan beri oturum açılmadı";
        return after;
      }
      return "";
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
    __period: null,
    __live: null,
    __history: null,
    __summary: null,

    async _refresh() {
      const days = this.__period.getSelection()[0].getModel();
      const to = Math.floor(Date.now() / 1000);
      const from = days ? to - days * 86400 : 0;
      const data = await ankamon.io.Api.get("/anomalies", { from, to });
      const rows = data.anomalies.map(a => Object.assign(a, {
        kindLabel: (data.kinds[a.kind] || {}).label || a.kind,
        text: ankamon.page.Anomalies.describe(a)
      }));
      this.__live.setData(rows.filter(a => a.ended_at === null), data.kinds);
      this.__history.setData(rows);
      this.__summary.setData(rows, from);
    },

    /** Tahta özeti → o tahtanın Geçmiş'i (çift tık). */
    showBoard(board) {
      this.__tabs.setSelection([this.__history]);
      this.__history.filterBoard(board);
    }
  }
});
