/**
 * Sistem sayfasının (bkz. page.System) sekmelerinin ortak tabanı: üstte durum satırı, sekme her
 * göründüğünde (sekme geçişi, sayfaya dönüş) ve sayfa açılışında load() — ayrı "Yenile"
 * düğmesi yok. Alt sınıflar _load() içinde veriyi alıp kendi içeriğini kurar.
 */
qx.Class.define("tihamon.ui.system.Tab", {
  extend: qx.ui.tabview.Page,
  type: "abstract",

  /**
   * @param page {tihamon.page.Base} tablo yardımcıları (_createTable/_addColumnFilters) için
   * @param label {String} sekme başlığı
   */
  construct(page, label) {
    super(label);
    this._page = page;
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);
    this._bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this._status = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    this._bar.add(this._status, { flex: 1 });
    this.add(this._bar);
    // Eşzamanlı ikinci çağrı (ör. sayfa açılışı + appear) load()'daki __loading ile yutulur.
    this.addListener("appear", () => this.load());
  },

  members: {
    _page: null,
    _bar: null,
    _status: null,
    __loading: false,

    async load() {
      if (this.__loading) {
        return;
      }
      this.__loading = true;
      try {
        await this._load();
        this._status.setValue(this._statusText ? this._statusText() : "");
      } catch (e) {
        this._status.setValue(`<span style="color:#c5221f">Yüklenemedi: ${qx.bom.String.escape(e.message || String(e))}</span>`);
      } finally {
        this.__loading = false;
      }
    },

    /** Sekme gerçekten ekranda mı (TabView seçili olmayan sayfayı "hidden" yapar — isSeeable yetmez). */
    _isShown() {
      return this.isSeeable() && this.getVisibility() === "visible";
    },

    /** @abstract */
    async _load() {}
  }
});
