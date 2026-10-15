/**
 * Arayüzün en altındaki durum çubuğu: arka plan işlemlerinin (worker) etkinlik akışını gösterir.
 * Varsayılan olarak katlıdır (yalnız başlık satırı); baştaki ok düğmesine ya da başlık çubuğunun
 * herhangi bir yerine tıklamak açar/kapatır. Açıkken
 * üstteki tutamaç sürüklenerek yüksekliği ayarlanabilir; yükseklik tarayıcının localStorage'ında
 * tutulur (yalnız bu tarayıcıya özgüdür, sunucuya gitmez).
 *
 * /api/activity ucunu artımlı (last_id) yoklar; en yeni satırlar altta birikir. Üst bar sağda,
 * sunucunun anlık kaynak kullanımını gösterir (/api/system/stats, 1 sn'de bir). Listenin sağ
 * menüsünde Temizle (eskiden başlıktaki ayrı düğmeydi) + Sistem/Komut loglarına kısayol var.
 */
qx.Class.define("tihamon.ui.StatusBar", {
  extend: qx.ui.container.Composite,

  statics: {
    STORAGE_KEY: "tihamon.statusbar.height",
    DEFAULT_HEIGHT: 160,
    MIN_HEIGHT: 80,
    MAX_HEIGHT: 500,
    STATS_INTERVAL_MS: 1000,
    // CPU/RAM bu yüzdeyi bu kadar (ms) sürekli AŞARSA kırmızı + ⚠ ile vurgulanır (kullanıcı isteği).
    WARN_PERCENT: 85,
    WARN_SUSTAIN_MS: 10000
  },

  construct() {
    super(new qx.ui.layout.VBox());
    this.set({
      backgroundColor: "app-nav",
      decorator: new qx.ui.decoration.Decorator().set({ widthTop: 1, color: "app-border" })
    });
    this.__height = this.__loadHeight();

    // Sürükleme tutamacı: yalnız açıkken görünür; yukarı sürükleyince büyür (çubuk en altta).
    this.__grip = new qx.ui.core.Widget().set({
      height: 4, cursor: "ns-resize", backgroundColor: "app-border", visibility: "excluded"
    });
    this.__grip.addListener("pointerdown", this.__onGripDown, this);
    this.add(this.__grip);

    const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" })).set({
      padding: [4, 8], cursor: "pointer"
    });
    this.__foldButton = new qx.ui.form.Button("▸").set({ width: 24, padding: [0, 4], toolTipText: "Aç/kapat" });
    this.__foldButton.addListener("execute", () => this.__setFolded(!this.__folded));
    head.add(this.__foldButton);
    head.add(new qx.ui.basic.Label("Arka plan işlemleri"));
    head.add(new qx.ui.core.Spacer(), { flex: 1 });
    // Sunucu durumu: CPU/RAM/disk/ağ, sağa hizalı, 1 sn'de bir güncellenir (bkz. __pollStats).
    this.__stats = new qx.ui.basic.Label("").set({ font: "app-mono", textColor: "app-muted", rich: true });
    head.add(this.__stats);
    this.add(head);
    // Çubuğun herhangi bir yerine tıklamak da aç/kapat yapar; ok düğmesinin kendi execute'ü zaten
    // çalışır, burada yalnız onun DIŞINDAKİ alana tıklanınca tetiklenir.
    head.addListener("tap", e => {
      if (e.getTarget() !== this.__foldButton) {
        this.__setFolded(!this.__folded);
      }
    });

    this.__list = new qx.ui.form.List().set({ font: "app-mono", backgroundColor: "surface", visibility: "excluded" });
    this.__list.setContextMenu(this.__buildListMenu());
    this.add(this.__list, { flex: 1 });

    // Varsayılan: katlı. Akış yine de arka planda yoklanmaya devam eder; açılınca kayıtlar hazır olur.
    this.__setFolded(true);

    this.__lastId = 0;
    this.__timer = new qx.event.Timer(4000);
    this.__timer.addListener("interval", this.__poll, this);
    this.__poll();
    this.__timer.start();

    this.__statsTimer = new qx.event.Timer(tihamon.ui.StatusBar.STATS_INTERVAL_MS);
    this.__statsTimer.addListener("interval", this.__pollStats, this);
    this.__pollStats();
    this.__statsTimer.start();
  },

  destruct() {
    if (this.__timer) {
      this.__timer.stop();
      this.__timer.dispose();
    }
    if (this.__statsTimer) {
      this.__statsTimer.stop();
      this.__statsTimer.dispose();
    }
  },

  members: {
    __list: null,
    __stats: null,
    __timer: null,
    __statsTimer: null,
    __lastId: null,
    __folded: true,
    __height: null,
    __grip: null,
    __foldButton: null,
    __dragStartY: null,
    __dragStartHeight: null,
    __cpuHighSince: null,
    __memHighSince: null,

    __loadHeight() {
      try {
        const v = parseInt(localStorage.getItem(tihamon.ui.StatusBar.STORAGE_KEY), 10);
        if (v && v >= tihamon.ui.StatusBar.MIN_HEIGHT && v <= tihamon.ui.StatusBar.MAX_HEIGHT) {
          return v;
        }
      } catch (e) {
        // localStorage erişilemiyor olabilir (gizli pencere vb.); varsayılana düş.
      }
      return tihamon.ui.StatusBar.DEFAULT_HEIGHT;
    },

    __saveHeight() {
      try {
        localStorage.setItem(tihamon.ui.StatusBar.STORAGE_KEY, String(this.__height));
      } catch (e) {
        // sorun değil — yalnız kalıcılık kaybolur.
      }
    },

    /** Listenin sağ menüsü: Temizle (eskiden başlıktaki düğme) + Loglar sayfasına kısayollar. */
    __buildListMenu() {
      const menu = new qx.ui.menu.Menu();
      const clear = new qx.ui.menu.Button("Temizle");
      clear.addListener("execute", () => this.__list.removeAll());
      menu.add(clear);
      menu.add(new qx.ui.menu.Separator());
      tihamon.ui.Shell.LOG_KINDS.forEach(kind => {
        const btn = new qx.ui.menu.Button(kind.label);
        btn.addListener("execute", () => qx.event.message.Bus.dispatchByName(tihamon.ui.Shell.OPEN_LOGS_MODE, kind.mode));
        menu.add(btn);
      });
      return menu;
    },

    __setFolded(folded) {
      this.__folded = folded;
      this.__foldButton.setLabel(folded ? "▸" : "▾");
      this.__list.setVisibility(folded ? "excluded" : "visible");
      this.__grip.setVisibility(folded ? "excluded" : "visible");
      // Katlıyken yükseklik yalnız başlık kadar (null = içeriğe göre otomatik); açıkken kayıtlı değer.
      this.setHeight(folded ? null : this.__height);
      // Açılır açılmaz en güncel satır görünsün; sonraki yoklamayı (4 sn'ye kadar) beklemeye gerek yok.
      if (!folded) {
        this.__scrollToEnd();
      }
    },

    __scrollToEnd() {
      const children = this.__list.getChildren();
      if (children.length) {
        this.__list.scrollChildIntoView(children[children.length - 1]);
      }
    },

    __onGripDown(e) {
      this.__dragStartY = e.getDocumentTop();
      this.__dragStartHeight = this.__height;
      this.__grip.capture();
      this.__grip.addListenerOnce("pointerup", this.__onGripUp, this);
      this.__grip.addListener("pointermove", this.__onGripMove, this);
    },

    __onGripMove(e) {
      // Çubuk pencerenin en altında dock'lu: yukarı sürüklemek (fare yukarı = documentTop küçülür) büyütmeli.
      const dy = this.__dragStartY - e.getDocumentTop();
      this.__height = Math.max(
        tihamon.ui.StatusBar.MIN_HEIGHT,
        Math.min(tihamon.ui.StatusBar.MAX_HEIGHT, this.__dragStartHeight + dy)
      );
      this.setHeight(this.__height);
    },

    __onGripUp() {
      this.__grip.releaseCapture();
      this.__grip.removeListener("pointermove", this.__onGripMove, this);
      this.__saveHeight();
    },

    /** @param mb {Number} megabayt; 1024'ü geçince GB'a döner. */
    __formatMb(mb) {
      return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : Math.round(mb) + " MB";
    },

    /**
     * CPU/RAM bu kadar (WARN_PERCENT) yüzdeyi sürekli (WARN_SUSTAIN_MS) aşarsa kırmızı + ⚠ ile
     * vurgulanır (kullanıcı isteği) — tek bir anlık sıçrama değil, SÜREKLİ yüksek kullanım hedeflenir;
     * __cpuHighSince/__memHighSince ilk eşik üstü anı tutar, altına inince sıfırlanır.
     */
    async __pollStats() {
      let s;
      try {
        s = await tihamon.io.Api.get("/system/stats");
      } catch (e) {
        return; // bir sonraki sn'de yeniden denenir; çubuğu eski değerde bırak.
      }
      const F = tihamon.util.Format;
      const now = Date.now();
      const THRESHOLD = tihamon.ui.StatusBar.WARN_PERCENT;
      const SUSTAIN = tihamon.ui.StatusBar.WARN_SUSTAIN_MS;

      this.__cpuHighSince = (s.cpu_percent !== null && s.cpu_percent >= THRESHOLD)
        ? (this.__cpuHighSince || now) : null;
      this.__memHighSince = (s.mem_percent !== null && s.mem_percent >= THRESHOLD)
        ? (this.__memHighSince || now) : null;
      const cpuWarn = this.__cpuHighSince !== null && (now - this.__cpuHighSince) >= SUSTAIN;
      const memWarn = this.__memHighSince !== null && (now - this.__memHighSince) >= SUSTAIN;

      const cpuText = s.cpu_percent === null ? "—" : F.percent(s.cpu_percent);
      const memText = s.mem_percent === null ? "—"
        : `${F.percent(s.mem_percent)} (${this.__formatMb(s.mem_used_mb)}${s.mem_total_mb ? " / " + this.__formatMb(s.mem_total_mb) : ""})`;
      const disk = s.disk_read_mbps === null ? "—" : `↓${s.disk_read_mbps.toFixed(1)} ↑${s.disk_write_mbps.toFixed(1)} MB/sn`;
      const net = s.net_rx_mbit === null ? "—" : `↓${s.net_rx_mbit.toFixed(1)} ↑${s.net_tx_mbit.toFixed(1)} Mbit/sn`;

      const part = (warn, label, value) => warn
        ? `⚠ <span style="color:#e74c3c;font-weight:bold">${label} ${value}</span>`
        : `${label} ${value}`;
      this.__stats.setValue(
        `${part(cpuWarn, "CPU", cpuText)}   ${part(memWarn, "RAM", memText)}   Disk ${disk}   Ağ ${net}`
      );

      const warnings = [];
      if (cpuWarn) {
        warnings.push(`CPU %${Math.round(s.cpu_percent)} — ${SUSTAIN / 1000} sn'den uzun süredir %${THRESHOLD} üzerinde`);
      }
      if (memWarn) {
        warnings.push(`RAM %${Math.round(s.mem_percent)} — ${SUSTAIN / 1000} sn'den uzun süredir %${THRESHOLD} üzerinde`);
      }
      this.__stats.setToolTipText(warnings.length ? warnings.join("\n") : null);
    },

    async __poll() {
      let data;
      try {
        data = await tihamon.io.Api.get("/activity", this.__lastId ? { after: this.__lastId } : {});
      } catch (e) {
        return;
      }
      if (!data.events.length) {
        return;
      }
      this.__lastId = data.last_id;
      const F = tihamon.util.Format;
      data.events.forEach(ev => {
        const item = new qx.ui.form.ListItem(`${F.dateTime(ev.ts)}  ${ev.message}`);
        if (ev.level === "error") {
          item.setTextColor("error");
        } else if (ev.level === "warn") {
          item.setTextColor("app-warn");
        }
        this.__list.add(item);
      });
      // En çok 200 satır tut.
      const extra = this.__list.getChildren().length - 200;
      for (let i = 0; i < extra; i++) {
        this.__list.removeAt(0);
      }
      // Katlıyken de kaydırır: açıkken her zaman en güncel satırda olunur, 4 sn'lik yoklama
      // aralığında ayrıca beklenmez.
      this.__scrollToEnd();
    }
  }
});
