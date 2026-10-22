/**
 * Sensörler (Bakım sayfasının sekmesi — bkz. page.Maintenance): Grafana panosu gömülü açılır
 * (oturum Tiha-Mon'dan devralınır).
 *
 * Varsayılan: "Çevrim içi tahtalar" panosu (docker/grafana/dashboards/cevrimici-tahtalar.json) — şu an
 * çevrim içi TÜM tahtalar, her grafikte tahta başına bir çizgi; lejant tablosunda son/en yüksek değerler.
 * Düğme satırındaki seçim kutusundan tek bir tahta seçilince o tahtanın ayrıntılı panosu (tahta-genel-bakis,
 * var-board) açılır. Seçim yalnız bu sayfa açıkken hatırlanır.
 */
qx.Class.define("tihamon.page.Metrics", {
  extend: tihamon.page.Base,

  statics: {
    ALL_URL: "/grafana/d/tihamon-cevrimici/cevrim-ici-tahtalar?kiosk",
    BOARD_URL: "/grafana/d/tihamon-genel/tahta-genel-bakis?kiosk&var-board="
  },

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
    this.__select = new qx.ui.form.SelectBox().set({ width: 280, toolTipText: "Gösterilecek tahtalar" });
    this.__select.add(new qx.ui.form.ListItem("Tüm çevrim içi tahtalar", null, null));
    this.__select.addListener("changeSelection", () => {
      if (!this.__filling) {
        this.__show();
      }
    });
    this._actions.add(this.__select);
    this.__open = this._addButton("Grafana'yı yeni sekmede aç", () => window.open(this.__url(), "_blank", "noopener"));
    this.__open.setToolTipText("Panoları tam ekran incelemek ve düzenlemek için");
    this.__frame = new qx.ui.embed.Iframe("about:blank");
    this.add(this.__frame, { flex: 1 });
  },

  members: {
    __frame: null,
    __select: null,
    __filling: false,
    __shown: null,

    /** Seçili tahta kimliği; null = tüm çevrim içi tahtalar. */
    __boardId() {
      const sel = this.__select.getSelection()[0];
      return sel ? sel.getModel() : null;
    },

    __url() {
      const id = this.__boardId();
      return id === null ? tihamon.page.Metrics.ALL_URL : tihamon.page.Metrics.BOARD_URL + id;
    },

    /** Panoyu yalnız adres değiştiyse yükler (sekmeye her dönüşte Grafana baştan çizilmesin). */
    __show() {
      const url = this.__url();
      if (url !== this.__shown) {
        this.__shown = url;
        this.__frame.setSource(url);
      }
    },

    /** Belirli bir tahtanın ayrıntılı grafiklerini göster. */
    async showBoard(boardId) {
      await this._refresh();
      const item = this.__select.getChildren().find(i => i.getModel() === boardId);
      if (item) {
        this.__select.setSelection([item]);
      }
    },

    async _refresh() {
      // Tahta listesi her açılışta tazelenir (yeni eklenen / çevrim içi-dışı değişen tahtalar); seçim korunur.
      let boards = [];
      try {
        boards = (await tihamon.io.Api.get("/boards")).boards;
      } catch (e) {
        // "boards" yetkisi yoksa yalnız "Tüm çevrim içi tahtalar" kalır.
      }
      const keep = this.__boardId();
      this.__filling = true;
      try {
        this.__select.getChildren().slice(1).forEach(item => {
          this.__select.remove(item);
          item.dispose();
        });
        const name = b => b.label || b.hostname || b.ip || "#" + b.id;
        boards
          .slice()
          .sort((a, b) => (b.online - a.online) || name(a).localeCompare(name(b), "tr"))
          .forEach(b => this.__select.add(new qx.ui.form.ListItem(name(b) + (b.online ? "" : " (çevrim dışı)"), null, b.id)));
        const again = this.__select.getChildren().find(i => i.getModel() === keep);
        this.__select.setSelection([again || this.__select.getChildren()[0]]);
      } finally {
        this.__filling = false;
      }
      this.__show();
    }
  }
});
