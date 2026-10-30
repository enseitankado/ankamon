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
 * Tahtalar sayfasının "Donanım izleme" sekmesi — Ekranlar sekmesinin donanım karşılığı. Her tahtanın
 * "bilgisayar"ı (OPS/PC modülü) stilize bir anakart çizimi olarak gösterilir ve canlı başarım +
 * yavaş sensörler + statik envanter bu çizimin üzerine bindirilir (çizim ve metrik yerleşimi gömülü
 * sayfada: docker/rootfs/screen/computer.html). Bu sınıf yalnız KABUĞU yönetir: iframe'li sayfa,
 * araç çubuğu, kutucuk boyutu slider'ı, görünürlükle akış duraklatma ve üst sayfayla "tm-*" köprüsü.
 *
 * Köprü sözleşmesi EKRAN ÖNİZLEMESİYLE (Boards.__createScreensPage) birebir aynıdır; sağ menü ve
 * seçim grid'le tek kaynaktır. İşin veri/menü ucu Boards sayfasındadır ve kurucuya `api` ile verilir:
 *   list()                      → o an gösterilecek tahtaların zenginleştirilmiş listesi (Boards.__computerList)
 *   syncSelection(ids)          → kutucukta değişen seçimi grid onay kutularına yansıt (Boards.__checkFromPreview)
 *   openMenu(id, x, y, ids, el) → grid satır menüsünün AYNISINI aç (Boards.__openPreviewMenuAt)
 *   info(id)                    → çift tıkta Bilgi kartı (BoardOps.infoCard)
 *   wake(id)                    → güç tasarrufundaki kutucuğa basınca Ekranı uyandır
 *   saveOrder(order)            → sürükle-bırak sırasını kalıcılaştır (Ekranlar'la ortak — Boards.__saveScreenOrder)
 * Grid seçimi değişince Boards pushSelection(ids) çağırır; liste değişince pushList().
 */
qx.Class.define("ankamon.ui.boards.ComputerTiles", {
  extend: qx.core.Object,

  construct(api) {
    super();
    this.__api = api;
    // Etiket "Donanım izleme" (kullanıcı isteği); kimlik eski adı "Donanımlar" kalır — kullanıcıların kayıtlı
    // son sekmesi (ui_prefs "tab.boards") ve sol ağaçtaki yaprak (ui.Shell PAGES) bu anahtarla eşleşir.
    this.__page = new qx.ui.tabview.Page("Donanım izleme");
    this.__page.setUserData("key", "Donanımlar");
    this.__page.setLayout(new qx.ui.layout.VBox());
    this.__page.setPadding([8, 0, 0, 0]);
    this.__page.add(this.__createToolbar());
    // qx.ui.embed.Iframe değil düz <iframe> (Html): Iframe her pointerdown'da üstüne saydam bir katman
    // koyup kutucuk tıklamalarını yutuyor (bkz. screen/index.html'deki aynı not).
    this.__frame = new qx.ui.embed.Html("").set({ overflowX: "hidden", overflowY: "hidden" });
    this.__page.add(this.__frame, { flex: 1 });
    this.__page.add(this.__createSizeRow());

    this.__onMessage = e => {
      const el = this.__iframeEl();
      if (!el || e.source !== el.contentWindow || e.origin !== window.location.origin || !e.data) {
        return;
      }
      const d = e.data;
      if (d.type === "tm-ready") {
        this.__previewKey = null;
        this.pushList();
        this.__pushSize(false);
        if (this.__paused) {
          this.__pushPause(true);
        }
        this.pushSelection(this.__lastSelection || []);
      } else if (d.type === "tm-select") {
        this.__api.syncSelection(d.ids || []);
      } else if (d.type === "tm-click") {
        qx.ui.menu.Manager.getInstance().hideAll();
      } else if (d.type === "tm-menu") {
        this.__api.openMenu(d.id, d.x, d.y, d.ids, this.__iframeEl());
      } else if (d.type === "tm-show") {
        this.__api.info(d.id);
      } else if (d.type === "tm-wake") {
        this.__api.wake(d.id);
      } else if (d.type === "tm-reorder") {
        this.__api.saveOrder(d.order || []);
      }
    };
    window.addEventListener("message", this.__onMessage);

    // Görünürlük yoklaması (sekme değişimi + Shell sayfa değişimi): Ekranlar'daki __checkScreens ile aynı.
    this.__timer = new qx.event.Timer(1000);
    this.__timer.addListener("interval", this.__check, this);
    this.__timer.start();
  },

  members: {
    __api: null,
    __page: null,
    __frame: null,
    __onMessage: null,
    __timer: null,
    __running: false,
    __paused: false,
    __hiddenAt: null,
    __previewKey: null,
    __sizeSlider: null,
    __sizeLabel: null,
    __tileSize: 320,
    __sliderThemeListener: null,
    __lastSelection: null,

    getPage() {
      return this.__page;
    },

    __createToolbar() {
      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }))
        .set({ padding: [2, 8, 6, 8] });
      bar.add(new qx.ui.basic.Label(
        "Her tahtanın bilgisayarı (OPS modülü) — canlı işlemci, bellek, sıcaklık, fan, disk ve ağ")
        .set({ textColor: "app-muted", rich: true }));
      return bar;
    },

    /** Kutucuk boyutu slider'ı — Ekranlar sekmesindekiyle aynı ince/narin tasarım (bkz. Boards.__createSizeRow). */
    __createSizeRow() {
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" })).set({ padding: [2, 8] });
      row.add(new qx.ui.basic.Label("Boyut:").set({ font: "small", textColor: "app-muted" }));
      const slider = new qx.ui.form.Slider().set({
        minimum: 180, maximum: 640, singleStep: 10, value: this.__loadTileSize(), width: 200,
        height: 12, maxHeight: 12, allowGrowY: false, alignY: "middle", decorator: null, padding: 0,
        toolTipText: "Bütün kutucukları aynı boyuta getirir (tek tek boyut: kutucuğun kenarından sürükleyin)"
      });
      const knob = slider.getChildControl("knob").set({
        width: 12, height: 12, minWidth: 12, minHeight: 12, maxHeight: 12, decorator: null, alignY: "middle"
      });
      const paint = () => {
        const mgr = qx.theme.manager.Color.getInstance();
        const pick = (names, fallback) => {
          const name = names.find(n => mgr.isDynamic(n));
          return name ? mgr.resolve(name) : fallback;
        };
        const line = pick(["app-border"], "#c8c8c8");
        const accent = pick(["primary", "background-selected", "selected-start", "table-row-background-selected"], "#0067c0");
        slider.getContentElement().setStyle("background", `linear-gradient(transparent 5px, ${line} 5px, ${line} 7px, transparent 7px)`);
        knob.getContentElement().setStyles({ background: accent, borderRadius: "50%" });
      };
      paint();
      this.__sliderThemeListener = qx.theme.manager.Meta.getInstance().addListener("changeTheme", () => qx.event.Timer.once(paint, this, 0));
      this.__sizeSlider = slider;
      this.__tileSize = slider.getValue();
      slider.addListener("changeValue", e => {
        this.__tileSize = e.getData();
        this.__saveTileSize(this.__tileSize);
        this.__pushSize(true);
        this.__updateSizeLabel();
      });
      row.add(slider);
      this.__sizeLabel = new qx.ui.basic.Label("").set({ font: "small", textColor: "app-muted", minWidth: 42 });
      row.add(this.__sizeLabel);
      this.__updateSizeLabel();
      return row;
    },

    __updateSizeLabel() {
      if (this.__sizeLabel) {
        this.__sizeLabel.setValue(this.__tileSize + " px");
      }
    },

    __loadTileSize() {
      try {
        const v = parseInt(localStorage.getItem("ankamon.computers.tileSize"), 10);
        if (v && v >= 180 && v <= 640) {
          return v;
        }
      } catch (e) {
        // localStorage erişilemiyor olabilir — varsayılana düş.
      }
      return 320;
    },

    __saveTileSize(v) {
      try {
        localStorage.setItem("ankamon.computers.tileSize", String(v));
      } catch (e) {
        // sorun değil — yalnız kalıcılık kaybolur.
      }
    },

    __iframeEl() {
      const dom = this.__frame && this.__frame.getContentElement().getDomElement();
      return dom ? dom.querySelector("iframe") : null;
    },

    __start() {
      this.__running = true;
      const list = this.__api.list();
      this.__previewKey = JSON.stringify(list);
      const url = "/screen/computer.html#" + btoa(unescape(encodeURIComponent(JSON.stringify({}))));
      this.__frame.setHtml(`<iframe src="${url}" style="border:0;width:100%;height:100%;display:block"></iframe>`);
      // İlk liste "tm-ready" ile istenecek (sayfa hazır olunca); burada ayrıca göndermeye gerek yok.
    },

    /** Grid'in gösterilen tahta listesi değiştiyse kutucuklara bildirir (yalnız fark varsa). */
    pushList() {
      if (!this.__running) {
        return;
      }
      const list = this.__api.list();
      const key = JSON.stringify(list);
      const el = this.__iframeEl();
      if (key === this.__previewKey || !el || !el.contentWindow) {
        return;
      }
      this.__previewKey = key;
      el.contentWindow.postMessage({ type: "tm-boards", boards: list }, window.location.origin);
    },

    /** Grid onay kutularındaki seçimi kutucuklara yansıtır (bkz. Boards.__updateActionState). */
    pushSelection(ids) {
      this.__lastSelection = ids || [];
      const el = this.__iframeEl();
      if (this.__running && el && el.contentWindow) {
        el.contentWindow.postMessage({ type: "tm-selection", ids: this.__lastSelection }, window.location.origin);
      }
    },

    __pushSize(reset) {
      const el = this.__iframeEl();
      if (el && el.contentWindow) {
        el.contentWindow.postMessage({ type: "tm-size", px: this.__tileSize, reset: !!reset }, window.location.origin);
      }
    },

    __pushPause(paused) {
      this.__paused = paused;
      const el = this.__iframeEl();
      if (el && el.contentWindow) {
        el.contentWindow.postMessage({ type: "tm-pause", paused }, window.location.origin);
      }
    },

    /**
     * Sekme/sayfa görünürlüğü: ilk görünüşte sayfayı kurar; uzun süre görünmezse akışları duraklatır
     * (kutucuklar yerinde kalır, sayfa yeniden kurulmaz); yeniden görününce sürdürür — Ekranlar'daki
     * __checkScreens/__pausePreview ile aynı davranış.
     */
    __check() {
      const seen = this.__page.getVisibility() === "visible" && this.__page.isSeeable() && !document.hidden;
      if (seen) {
        this.__hiddenAt = null;
        if (!this.__running) {
          this.__start();
        } else if (this.__paused) {
          this.__pushPause(false);
        }
      } else if (this.__running && !this.__paused) {
        const now = Date.now();
        if (this.__hiddenAt === null) {
          this.__hiddenAt = now;
        } else if (now - this.__hiddenAt >= ankamon.page.Boards.SCREENS_STOP_MS) {
          this.__pushPause(true);
        }
      }
    },

    /** Temizlik (Boards.destruct'tan çağrılır): qx.core.Object.dispose ile çakışmasın diye ayrı ad. */
    shutdown() {
      if (this.__timer) {
        this.__timer.stop();
        this.__timer.dispose();
      }
      if (this.__onMessage) {
        window.removeEventListener("message", this.__onMessage);
      }
      if (this.__sliderThemeListener) {
        qx.theme.manager.Meta.getInstance().removeListenerById(this.__sliderThemeListener);
      }
    }
  }
});
