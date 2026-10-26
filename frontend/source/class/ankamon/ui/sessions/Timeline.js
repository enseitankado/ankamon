/**
 * vis-timeline (https://github.com/visjs/vis-timeline, Apache-2.0/MIT) sarmalayıcısı: satırlar
 * (tahta ya da kullanıcı) ve başlangıç/bitişli çubuklar (oturumlar); fare tekerleği/sürükleme ile
 * yakınlaştırma-kaydırma kütüphanenin kendisinden gelir.
 *
 * Kütüphane derlemede node_modules'tan resource/ankamon/vis/'e kopyalanır (bkz. Dockerfile) ve
 * yalnız bu bileşen ilk kez ekrana geldiğinde yüklenir — diğer sayfaların açılışını ağırlaştırmaz.
 *
 * Olaylar: "changeRange" {start, end: Date} (kullanıcı kaydırma/yakınlaştırmayı bitirince ya da
 * setWindow/fit ile), "itemContextmenu" {item: öğe kimliği, event: DOM olayı}, "groupContextmenu"
 * {group: satır kimliği, event: DOM olayı} (soldaki satır adına sağ tıklama).
 *
 * @asset(ankamon/vis/*)
 */
qx.Class.define("ankamon.ui.sessions.Timeline", {
  extend: qx.ui.core.Widget,

  events: {
    changeRange: "qx.event.type.Data",
    itemContextmenu: "qx.event.type.Data",
    groupContextmenu: "qx.event.type.Data"
  },

  construct() {
    super();
    this.setMinHeight(160);
    this.addListenerOnce("appear", () => this.__init());
    // vis kendi kabının boyutunu yalnız pencere yeniden boyutlanınca okur; qooxdoo yerleşimi
    // (bölme sürükleme, sekme değişimi) değişince elle yeniden çizdirilir.
    this.addListener("resize", () => qx.event.Timer.once(() => this.__timeline && this.__timeline.redraw(), this, 0));
  },

  statics: {
    __loading: null,

    /** Kütüphaneyi (bir kez) yükler. @return {Promise} */
    load() {
      if (!this.__loading) {
        const rm = qx.util.ResourceManager.getInstance();
        qx.bom.Stylesheet.includeFile(rm.toUri("ankamon/vis/vis-timeline-graph2d.min.css"));
        qx.bom.Stylesheet.createElement(this.CSS);
        const loader = new qx.util.DynamicScriptLoader([rm.toUri("ankamon/vis/vis-timeline-graph2d.min.js")]);
        // start() yalnız qx.promise açıkken Promise döndürür; olaylar her durumda gelir.
        this.__loading = new Promise((resolve, reject) => {
          loader.addListenerOnce("ready", () => resolve());
          loader.addListenerOnce("failed", e => {
            this.__loading = null;
            reject(new Error(String(e.getData())));
          });
          loader.start();
        });
      }
      return this.__loading;
    },

    /** Oturum durumu sınıfları (bkz. ui.sessions.Users.STATES) ve uygulama temasına uyum. */
    CSS: `
      .vis-timeline { border-color: #dadce0; font-family: inherit; font-size: 12px; }
      .vis-item { border-radius: 3px; border-width: 1px; font-size: 11px; }
      .vis-item.vis-selected { box-shadow: 0 0 0 2px #1a73e8; }
      .vis-item .vis-item-content { padding: 1px 4px; }
      .vis-labelset .vis-label .vis-inner { padding: 4px 8px; }
      .tm-group-header { position: absolute; top: 0; left: 0; z-index: 2; box-sizing: border-box;
        align-items: flex-end; padding: 0 8px 4px; font-weight: bold; overflow: hidden; white-space: nowrap; }
      .vis-item.tm-s-ok, .tm-legend.tm-s-ok { background: #ceead6; border-color: #34a853; color: #0d652d; }
      .vis-item.tm-s-open, .tm-legend.tm-s-open { background: #d2e3fc; border-color: #1a73e8; color: #174ea6; }
      .vis-item.tm-s-locked, .tm-legend.tm-s-locked { background: #e9defc; border-color: #8430ce; color: #5e1d99; }
      .vis-item.tm-s-offline, .tm-legend.tm-s-offline { background: #fad2cf; border-color: #d93025; color: #a50e0e; }
      .vis-item.tm-s-superseded, .tm-legend.tm-s-superseded { background: #feefc3; border-color: #f29900; color: #8a4d00; }
      .vis-item.tm-s-web, .tm-legend.tm-s-web { background: #e8eaed; border-color: #80868b; color: #3c4043; }
      .vis-item.vis-background.tm-off { background: repeating-linear-gradient(135deg,
        rgba(95,99,104,.16) 0 6px, rgba(95,99,104,.08) 6px 12px); }
      .tm-legend.tm-off { background: rgba(95,99,104,.22); border-color: #9aa0a6; }
      .tm-legend { display: inline-block; width: 12px; height: 12px; border-radius: 2px;
        border: 1px solid; vertical-align: -2px; margin: 0 4px 0 10px; }
    `,

    /** Eksen etiketleri Türkçe (kütüphanenin gömülü moment'i yalnız İngilizce ay adı bilir). */
    __label(date, scale, major) {
      const d = date.toDate ? date.toDate() : new Date(date);
      const f = opts => d.toLocaleString("tr-TR", opts);
      if (major) {
        switch (scale) {
          case "millisecond": case "second": case "minute":
            return f({ day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
          case "hour":
            return f({ day: "numeric", month: "long", year: "numeric", weekday: "long" });
          case "weekday": case "day": case "week":
            return f({ month: "long", year: "numeric" });
          case "month":
            return f({ year: "numeric" });
          default:
            return "";
        }
      }
      switch (scale) {
        case "millisecond": case "second":
          return f({ hour: "2-digit", minute: "2-digit", second: "2-digit" });
        case "minute": case "hour":
          return f({ hour: "2-digit", minute: "2-digit" });
        case "weekday":
          return f({ day: "numeric", weekday: "short" });
        case "day": case "week":
          return f({ day: "numeric", month: "short" });
        case "month":
          return f({ month: "short" });
        default:
          return f({ year: "numeric" });
      }
    }
  },

  members: {
    __timeline: null,
    __ready: false,
    __items: null,
    __groups: null,
    __pending: null,
    __pendingWindow: null,
    __pendingFit: false,
    __header: "",
    __headerEl: null,

    /**
     * Satır adları sütununun başlığı (ör. "Bilgisayar", "Kullanıcı"): eksen satırının solundaki boş köşeye
     * yazılır; her yeniden çizimde sütunun genişliğine/eksenin yüksekliğine uydurulur.
     */
    setGroupHeader(text) {
      this.__header = text || "";
      this.__placeHeader();
    },

    __placeHeader() {
      if (!this.__timeline || this.isDisposed()) {
        return;
      }
      const left = this.__timeline.dom.leftContainer;   // .vis-panel.vis-left (dom.left içindeki içerik kutusu)
      if (!this.__headerEl) {
        this.__headerEl = document.createElement("div");
        this.__headerEl.className = "tm-group-header";
        this.__timeline.dom.root.appendChild(this.__headerEl);
      }
      this.__headerEl.textContent = this.__header;
      // Sekme gizliyken (ör. sayfa açılışında Kullanıcılar sekmesi seçili değilken) çizim boyutsuz
      // yapılır: eksen yerleşene dek kısa aralıklarla yeniden ölçülür.
      const top = parseFloat(left.style.top) || 0;   // vis panelin yerini satır içi stille verir
      if (!top && this.__header) {
        qx.event.Timer.once(this.__placeHeader, this, 250);
      }
      Object.assign(this.__headerEl.style, {
        width: left.offsetWidth + "px",
        height: top + "px",
        display: this.__header ? "flex" : "none"
      });
    },

    /**
     * Satırları ve çubukları verir. Var olan kimlikler yerinde güncellenir, artık olmayanlar
     * silinir — kullanıcının yakınlaştırdığı aralık ve kaydırma konumu korunur.
     * @param groups {Array} [{id, content, title?}]  @param items {Array} vis öğeleri
     */
    setData(groups, items) {
      if (!this.__timeline) {
        this.__pending = { groups, items };
        return;
      }
      this.__sync(this.__groups, groups);
      this.__sync(this.__items, items);
    },

    /** Görünen aralığı ayarlar. @param start {Date} @param end {Date} */
    setWindow(start, end) {
      if (!this.__ready) {
        this.__pendingWindow = [start, end];
        this.__pendingFit = false;
        return;
      }
      this.__timeline.setWindow(start, end, { animation: false });
      this.__fireRange();
    },

    /** Aralığı, görünen bütün çubukları kapsayacak şekilde ayarlar. */
    fit() {
      if (!this.__ready) {
        this.__pendingFit = true;
        this.__pendingWindow = null;
        return;
      }
      if (this.__items.length) {
        this.__timeline.fit({ animation: false });
      }
      this.__fireRange();
    },

    /** @return {Map|null} {start, end: Date} — kütüphane henüz yüklenmediyse bekleyen aralık */
    getWindow() {
      if (this.__ready) {
        const w = this.__timeline.getWindow();
        return { start: w.start, end: w.end };
      }
      return this.__pendingWindow ? { start: this.__pendingWindow[0], end: this.__pendingWindow[1] } : null;
    },

    __sync(dataSet, rows) {
      const ids = new Set(rows.map(r => r.id));
      dataSet.remove(dataSet.getIds().filter(id => !ids.has(id)));
      dataSet.update(rows);
    },

    __fireRange() {
      const w = this.__timeline.getWindow();
      this.fireDataEvent("changeRange", { start: w.start, end: w.end });
    },

    async __init() {
      try {
        await ankamon.ui.sessions.Timeline.load();
      } catch (e) {
        this.getContentElement().getDomElement().textContent = "Zaman çizelgesi kütüphanesi yüklenemedi.";
        return;
      }
      const label = ankamon.ui.sessions.Timeline.__label;
      this.__items = new vis.DataSet();
      this.__groups = new vis.DataSet();
      const now = Date.now();
      this.__timeline = new vis.Timeline(this.getContentElement().getDomElement(), this.__items, this.__groups, {
        height: "100%",
        stack: true,
        orientation: { axis: "top", item: "top" },
        groupOrder: "content",
        verticalScroll: true,
        horizontalScroll: false,
        showCurrentTime: true,
        zoomMin: 5 * 60 * 1000,
        zoomMax: 3 * 365 * 24 * 3600 * 1000,
        margin: { item: { horizontal: 0, vertical: 4 }, axis: 4 },
        tooltip: { followMouse: true, overflowMethod: "cap", delay: 150 },
        locale: "tr",
        locales: { tr: { current: "şimdi", time: "saat", deleteSelected: "Seçileni sil" } },
        format: {
          minorLabels: (date, scale) => label(date, scale, false),
          majorLabels: (date, scale) => label(date, scale, true)
        }
      });
      this.__timeline.on("rangechanged", props => {
        if (props.byUser) {
          this.__fireRange();
        }
      });
      this.__timeline.on("contextmenu", props => {
        if (props.item !== null && props.item !== undefined) {
          props.event.preventDefault();
          this.fireDataEvent("itemContextmenu", { item: props.item, event: props.event });
        } else if (props.what === "group-label" && props.group !== null && props.group !== undefined) {
          props.event.preventDefault();
          this.fireDataEvent("groupContextmenu", { group: props.group, event: props.event });
        }
      });
      // vis ilk çiziminde aralığı kendisi belirler (veriye sığdırır) ve ondan önce verilen aralığı
      // ezer; bekleyen aralık (yoksa son 7 gün) bu yüzden ilk "changed"den SONRA uygulanır.
      const applyPending = () => {
        this.__timeline.off("changed", applyPending);
        this.__ready = true;
        if (this.__pendingFit) {
          this.fit();
        } else if (this.__pendingWindow) {
          this.setWindow(...this.__pendingWindow);
        } else {
          this.setWindow(new Date(now - 7 * 24 * 3600 * 1000), new Date(now + 3600 * 1000));
        }
        this.__pendingFit = false;
        this.__pendingWindow = null;
      };
      this.__timeline.on("changed", applyPending);
      // "changed" çizim bitmeden gelir (panel konumları henüz yazılmamış): ölçüm bir tur sonra.
      this.__timeline.on("changed", () => qx.event.Timer.once(this.__placeHeader, this, 0));
      if (this.__pending) {
        this.setData(this.__pending.groups, this.__pending.items);
        this.__pending = null;
      }
    }
  },

  destruct() {
    if (this.__timeline) {
      this.__timeline.destroy();
    }
    this.__timeline = this.__items = this.__groups = null;
  }
});
