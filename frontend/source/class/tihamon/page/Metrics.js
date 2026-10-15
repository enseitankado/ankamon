/**
 * Sensörler (Bakım sayfasının sekmesi — bkz. page.Maintenance): Grafana panosu gömülü açılır
 * (oturum Tiha-Mon'dan devralınır).
 * Sol menüden bir tahtaya tıklanınca o tahtanın panosu (var-board) yüklenir.
 */
qx.Class.define("tihamon.page.Metrics", {
  extend: tihamon.page.Base,

  construct(user) {
    // Başlık yok: Bakım sayfasının "Sensörler" sekmesinde durur, sekme adı yeterli (bkz. page.Maintenance).
    super(user, null);
    // Düğme satırının başında yardım: verinin nasıl toplandığı/saklandığı, canlı değerlerle (bkz. ui.MetricsHelp).
    const help = new qx.ui.form.Button("?").set({
      width: 30, height: 30, minWidth: 30, padding: 0, font: "bold",
      toolTipText: "Sensör verisi nasıl toplanıyor, saklanıyor ve sunuluyor? (canlı bilgiler)"
    });
    help.addListener("execute", () => tihamon.ui.MetricsHelp.open());
    this._actions.add(help);
    this.__open = this._addButton("Grafana'yı yeni sekmede aç", () => window.open(this.__url(), "_blank", "noopener"));
    this.__open.setToolTipText("Panoları tam ekran incelemek ve düzenlemek için");
    this.__frame = new qx.ui.embed.Iframe("about:blank");
    this.add(this.__frame, { flex: 1 });
  },

  members: {
    __frame: null,
    __boardId: null,
    __loaded: false,

    __url() {
      const base = "/grafana/d/tihamon-genel/tahta-genel-bakis?kiosk";
      return this.__boardId ? base + "&var-board=" + this.__boardId : base;
    },

    /** Belirli bir tahtanın grafiklerini göster (sol menüden tahta tıklanınca). */
    showBoard(boardId) {
      this.__boardId = boardId;
      this.__loaded = true;
      this.__frame.setSource(this.__url());
    },

    async _refresh() {
      // İlk açılışta pano yüklenir; tahta seçilmediyse, Grafana'nın varsayılanı (verisi olan tahta) gelir.
      if (!this.__loaded) {
        this.__loaded = true;
        this.__frame.setSource(this.__url());
      }
    }
  }
});
