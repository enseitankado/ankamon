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
    USERS_INTERVAL_MS: 15000,
    // Açık sayfa/sekme/pencere bu aralıkla yoklanır; değişmişse hemen bildirilir (bkz. __currentView).
    VIEW_CHECK_MS: 3000,
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
    // Küçük ok (kullanıcı isteği); yazı sağdaki CPU/RAM ile aynı biçimde (app-mono, app-muted).
    this.__foldButton = new qx.ui.form.Button("▸").set({
      width: 18, height: 18, minWidth: 18, minHeight: 18, allowGrowY: false, padding: 0, toolTipText: "Aç/kapat"
    });
    this.__foldButton.addListener("execute", () => this.__setFolded(!this.__folded));
    head.add(this.__foldButton);
    head.add(new qx.ui.basic.Label("Arka plan işlemleri").set({ font: "app-mono", textColor: "app-muted" }));
    // Küçültülmüş pencereler (Ekranlar sekmesindeyken açılanlar — bkz. ui.WindowDock): tıklanınca geri açılır.
    this.__dock = new tihamon.ui.WindowDock();
    head.add(this.__dock);
    head.add(new qx.ui.core.Spacer(), { flex: 1 });
    // Oturum açmış Tiha-Mon kullanıcıları (kullanıcı isteği): sayı + üzerine gelince ayrıntı (bkz. __pollUsers).
    this.__usersTip = new qx.ui.tooltip.ToolTip("").set({ rich: true, showTimeout: 300, hideTimeout: 30000 });
    this.__usersLabel = new qx.ui.basic.Label("").set({
      font: "app-mono", textColor: "app-muted", rich: true, toolTip: this.__usersTip, marginRight: 12
    });
    head.add(this.__usersLabel);
    // Sunucu durumu: CPU/RAM/disk/ağ, sağa hizalı, 1 sn'de bir güncellenir (bkz. __pollStats).
    this.__stats = new qx.ui.basic.Label("").set({ font: "app-mono", textColor: "app-muted", rich: true });
    head.add(this.__stats);
    this.add(head);
    // Çubuğun herhangi bir yerine tıklamak da aç/kapat yapar; ok düğmesinin kendi execute'ü zaten
    // çalışır, burada yalnız onun DIŞINDAKİ alana tıklanınca tetiklenir.
    head.addListener("tap", e => {
      if (e.getTarget() !== this.__foldButton && e.getTarget() !== this.__usersLabel &&
          !qx.ui.core.Widget.contains(this.__dock, e.getTarget())) {
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

    this.__usersTimer = new qx.event.Timer(tihamon.ui.StatusBar.USERS_INTERVAL_MS);
    this.__usersTimer.addListener("interval", this.__pollUsers, this);
    this.__pollUsers();
    this.__usersTimer.start();

    this.__viewTimer = new qx.event.Timer(tihamon.ui.StatusBar.VIEW_CHECK_MS);
    this.__viewTimer.addListener("interval", () => {
      if (this.__currentView() !== this.__sentView) {
        this.__pollUsers();
      }
    });
    this.__viewTimer.start();

    // "Aktif" (kullanıcı isteği): sekme görünür + pencere odakta. Olaylar yalnız tetikleyici; durum kısa bir
    // gecikmeyle document.hasFocus() ile okunur — odak iframe'e (Ekranlar, terminal) geçince pencere "blur"
    // alır ama hasFocus() iç çerçeveleri de sayar, yanlışlıkla "pasif" bildirilmez. Değişince hemen gönderilir.
    this.__onFocusChange = () => qx.event.Timer.once(() => {
      if (!this.isDisposed() && this.__isFocused() !== this.__sentFocused) {
        this.__pollUsers();
      }
    }, this, 50);
    window.addEventListener("focus", this.__onFocusChange);
    window.addEventListener("blur", this.__onFocusChange);
    document.addEventListener("visibilitychange", this.__onFocusChange);
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
    if (this.__usersTimer) {
      this.__usersTimer.stop();
      this.__usersTimer.dispose();
    }
    if (this.__viewTimer) {
      this.__viewTimer.stop();
      this.__viewTimer.dispose();
    }
    if (this.__onFocusChange) {
      window.removeEventListener("focus", this.__onFocusChange);
      window.removeEventListener("blur", this.__onFocusChange);
      document.removeEventListener("visibilitychange", this.__onFocusChange);
    }
  },

  members: {
    __list: null,
    __stats: null,
    __timer: null,
    __statsTimer: null,
    __usersTimer: null,
    __usersLabel: null,
    __usersTip: null,
    __dock: null,
    __onFocusChange: null,
    __sentFocused: null,
    __viewTimer: null,
    __sentView: null,

    /**
     * Bu oturumun o an Tiha-Mon'da baktığı yer (alt çubuk ipucunda "Aktif"in sağında gösterilir): gezinme
     * ağacında seçili düğümün yolu + görünen sayfadaki seçili iç sekmeler + öndeki pencerenin başlığı,
     * ör. "Tahtalar ▸ Ekranlar · Web terminal — B Blok - Arge 2". Kabuğa (ui.Shell) bağımlılık olmasın diye
     * görünür widget ağacından okunur: Stack'te gizli sayfalar görünür olmadığından atlanır.
     */
    __currentView() {
      const text = s => String(s || "").replace(/<[^>]*>/g, "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
      const parts = [];
      const walk = w => {
        if (!w.isSeeable()) {
          return;
        }
        if (w instanceof qx.ui.tree.Tree) {
          const path = [];
          for (let item = w.getSelection()[0]; item && item !== w.getRoot(); item = item.getParent()) {
            path.unshift(text(item.getLabel()));
          }
          parts.push(...path.filter(Boolean));
          return;
        }
        if (w instanceof qx.ui.tabview.TabView) {
          const page = w.getSelection()[0];
          if (page && text(page.getLabel())) {
            parts.push(text(page.getLabel()));
          }
        }
        (w._getChildren ? w._getChildren() : []).forEach(child => child instanceof qx.ui.core.Widget && walk(child));
      };
      const shell = this.getLayoutParent();
      if (shell) {
        walk(shell);
      }
      let view = parts.join(" ▸ ");
      const root = qx.core.Init.getApplication().getRoot();
      const win = root.getActiveWindow && root.getActiveWindow();
      if (win && win.isSeeable() && text(win.getCaption())) {
        view += (view ? " · " : "") + text(win.getCaption());
      }
      return view.slice(0, 200);
    },

    /** Tiha-Mon sekmesi görünür VE tarayıcı penceresi odakta mı (iç çerçevelerdeki odak dahil). */
    __isFocused() {
      return document.visibilityState === "visible" && document.hasFocus();
    },

    /**
     * Oturum açmış Tiha-Mon kullanıcıları (/api/login-sessions/active): sayı her oturum sahibine; ipucundaki
     * ayrıntı (kullanıcı, giriş zamanı, bilgisayar, son etkinlik, açık sayfa) yalnız 'logins' yetkisine (sunucu süzer).
     */
    async __pollUsers() {
      let res;
      // Her yoklama bu oturumun "görünür + odakta" durumunu da bildirir (bkz. LoginSessionsApi::active).
      const focused = this.__isFocused();
      const view = this.__currentView();
      this.__sentFocused = focused;
      this.__sentView = view;
      try {
        res = await tihamon.io.Api.get("/login-sessions/active", { focused: focused ? 1 : 0, view });
      } catch (e) {
        return; // bir sonraki turda yeniden denenir
      }
      const F = tihamon.util.Format;
      const esc = qx.bom.String.escape;
      this.__usersLabel.setValue(`👤 ${res.users}`);
      if (!res.sessions) {
        this.__usersTip.setLabel(`Bağlı Tiha-Mon kullanıcısı: <b>${res.users}</b>`);
        return;
      }
      // Satır = kullanıcı + IP (sunucu gruplar); aynı yerden birden çok açık oturum varsa sayısı yazılır.
      // Bilgisayar: tahta/ağ envanterindeki takma ad (sunucu eşler), yoksa IP adresi.
      const rows = res.sessions.map(s => {
        const who = esc(s.username) + (s.full_name ? ` <span style="opacity:.7">(${esc(s.full_name)})</span>` : "");
        // Sunucu yalnız BAĞLI oturumları verir (çıkış yapmadan kapanmış tarayıcılar sayılmaz — bkz.
        // LoginSessionsApi::PRESENCE_MINUTES); odakta olmayan bağlı oturum "arka planda".
        const flags = [s.mine ? "siz" : "", s.active ? "" : "arka planda", s.sessions > 1 ? `${s.sessions} oturum` : ""]
          .filter(Boolean).join(", ");
        // Aktif = Tiha-Mon o kişinin tarayıcısında görünür sekmede ve pencere odakta (bkz. __isFocused).
        // Sağında o an açık sayfa/sekme/pencere (bkz. __currentView); arka plandaki oturumda soluk.
        const state = (s.active ? "<span style=\"color:#2e9d4a;font-weight:bold\">Aktif</span>" : "") +
          (s.view ? ` <span style="opacity:${s.active ? .85 : .6}">${s.active ? "— " : ""}${esc(s.view)}</span>` : "");
        const pc = s.computer ? `<span title="${esc(s.ip || "")}">${esc(s.computer)}</span>` : esc(s.ip || "");
        return `<tr><td><b>${who}</b>${flags ? ` <i>${flags}</i>` : ""}</td>` +
          `<td>${F.dateTime(s.started_ts)}</td><td>${pc}</td>` +
          `<td>${s.last_seen_ts ? F.ago(Math.round(s.last_seen_ts / 1000)) : "—"}</td><td>${state}</td></tr>`;
      });
      const th = "style=\"text-align:left;padding-right:14px\"";
      this.__usersTip.setLabel(
        `<b>Bağlı Tiha-Mon kullanıcıları: ${res.users}</b> (${res.total} oturum)` +
        `<table style="margin-top:4px;border-spacing:0 2px"><tr><th ${th}>Kullanıcı</th><th ${th}>Son giriş</th>` +
        `<th ${th}>Bilgisayar</th><th ${th}>Son etkinlik</th><th ${th}>Durum</th></tr>` +
        rows.join("").replace(/<td>/g, "<td style=\"padding-right:14px\">") + "</table>"
      );
    },
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
