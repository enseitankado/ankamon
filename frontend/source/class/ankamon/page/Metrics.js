/**
 * Sensörler (Bakım sayfasının sekmesi — bkz. page.Maintenance): Grafana panosu gömülü açılır
 * (oturum Ankamon'dan devralınır).
 *
 * Varsayılan: "Çevrim içi tahtalar" panosu (docker/grafana/dashboards/cevrimici-tahtalar.json) — şu an
 * çevrim içi TÜM tahtalar, her grafikte tahta başına bir çizgi; lejant tablosunda son/en yüksek değerler.
 * Düğme satırındaki seçim kutusundan tek bir tahta seçilince o tahtanın ayrıntılı panosu (tahta-genel-bakis,
 * var-board) açılır. Seçim yalnız bu sayfa açıkken hatırlanır.
 */
qx.Class.define("ankamon.page.Metrics", {
  extend: ankamon.page.Base,

  statics: {
    ALL_URL: "/grafana/d/ankamon-cevrimici/cevrim-ici-tahtalar?kiosk",
    BOARD_URL: "/grafana/d/ankamon-genel/tahta-genel-bakis?kiosk&var-board="
  },

  construct(user) {
    // Başlık yok: Bakım sayfasının "Sensörler" sekmesinde durur, sekme adı yeterli (bkz. page.Maintenance).
    super(user, null);
    // Düğme satırının başında yardım: verinin nasıl toplandığı/saklandığı, canlı değerlerle (bkz. ui.MetricsHelp).
    const help = new qx.ui.form.Button("?").set({
      width: 30, height: 30, minWidth: 30, padding: 0, font: "bold",
      toolTipText: "Sensör verisi nasıl toplanıyor, saklanıyor ve sunuluyor? (canlı bilgiler)"
    });
    help.addListener("execute", () => ankamon.ui.MetricsHelp.open());
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
    // Sensör verisi hiç gelmeyen tahtalar için kurulum yönergesi (bkz. __updateNotice).
    this.__notice = new qx.ui.basic.Label("").set({ rich: true, wrap: true, selectable: true, visibility: "excluded",
      padding: [8, 12], backgroundColor: "#fff4ce", textColor: "#3b2f00" });
    this.add(this.__notice);
    this.__frame = new qx.ui.embed.Iframe("about:blank");
    this.add(this.__frame, { flex: 1 });
  },

  members: {
    __frame: null,
    __notice: null,
    __coverage: null,
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
      return id === null ? ankamon.page.Metrics.ALL_URL : ankamon.page.Metrics.BOARD_URL + id;
    },

    /**
     * Sensör verisi hiç olmayan tahtalar için bilgilendirme: tüm tahtalar görünümünde o tahtaların listesi,
     * tek tahtada yalnız o tahta. Kurulum hazır komutlarla yapılır (actions/node-exporter, sensors-superio).
     */
    __updateNotice() {
      const esc = qx.bom.String.escape;
      const list = this.__coverage || [];
      const id = this.__boardId();
      const missing = list.filter(b => !b.has_data && (id === null || b.id === id));
      const noBoard = list.filter(b => b.has_data && !b.has_board_sensors && (id === null || b.id === id));
      const how = "Kurmak için Tahtalar'da tahtaları işaretleyip <b>Komut çalıştır ▸ Hazır / Serbest komut çalıştır</b> " +
        "penceresinden önce <b>Sensörler — Metrik izlemeyi kur</b> (işlemci, bellek, disk, ağ, sıcaklık), ardından fan ve " +
        "anakart ölçümleri için <b>Sensörler — Fan/pil/anakart sensörlerini etkinleştir</b> hazır komutunu çalıştırın. " +
        "Veri birkaç dakika içinde grafiklere gelmeye başlar.";
      const names = arr => arr.slice(0, 12).map(b => esc(b.name) + (b.online ? "" : " (kapalı)")).join(", ") +
        (arr.length > 12 ? ` ve ${arr.length - 12} tahta daha` : "");
      let html = "";
      if (missing.length) {
        html = (id === null
          ? `<b>${missing.length} tahtada hiç sensör verisi yok:</b> ${names(missing)}.<br>`
          : "<b>Bu tahtada hiç sensör verisi yok:</b> sensör istemcisi (metrik izleme) kurulu değil ya da çalışmıyor.<br>") + how;
      } else if (id !== null && noBoard.length) {
        html = "Bu tahtada fan / anakart sensörü verisi yok. <b>Komut çalıştır ▸ Sensörler — Fan/pil/anakart sensörlerini etkinleştir</b> " +
          "hazır komutu anakartın donanım izleme yongası destekleniyorsa bunları açar.";
      }
      this.__notice.setValue(html);
      this.__notice.setVisibility(html ? "visible" : "excluded");
    },

    /** Panoyu yalnız adres değiştiyse yükler (sekmeye her dönüşte Grafana baştan çizilmesin). */
    __show() {
      this.__updateNotice();
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
        boards = (await ankamon.io.Api.get("/boards")).boards;
      } catch (e) {
        // "boards" yetkisi yoksa yalnız "Tüm çevrim içi tahtalar" kalır.
      }
      try {
        this.__coverage = (await ankamon.io.Api.get("/metrics/coverage")).boards;
      } catch (e) {
        this.__coverage = null; // bilgilendirme gösterilmez; grafikler yine açılır
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
