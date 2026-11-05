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
 * Görev yöneticisi penceresi (Tahtalar/Ekranlar sağ menüsü ve araç çubuğu "Görev yöneticisi" — kullanıcı isteği:
 * Windows Görev Yöneticisi'nin özellikleri ve görünümü). Sekmeler (Windows 11 gibi solda): İşlemler, Performans,
 * Uygulama geçmişi, Başlangıç uygulamaları, Kullanıcılar, Ayrıntılar, Hizmetler, Ayarlar. Üstte arama, Yeni görev
 * çalıştır, Görevi sonlandır, Verimlilik modu, Görünüm (güncelleme hızı, her zaman üstte).
 *
 * Çoklu tahta (kullanıcı isteği: seçili her tahta için ayrı pencere değil, tek pencerede süzme ile): pencere seçili
 * tahtaların HER BİRİ için bir canlı bağ (ui.taskmgr.TaskBoardLink: tahtaya tek SSH + ajan, kendi modeli) tutar.
 * Tablo sekmelerinde bütün tahtaların satırları tek tabloda, "Bilgisayar" sütunuyla ("takma ad [bilgisayar adı]");
 * satır kimlikleri tahtayla birleşiktir ("<tahta id>:<kimlik>") ve satır işlemleri satırın tahtasına gider.
 * Üstteki "Bilgisayar" süzgeci (ui.taskmgr.TaskBoardPicker, çoklu seçim) ve arama kutusu (bilgisayar adını da
 * arar) birlikte süzer; Performans sekmesinde tahta seçici vardır. Tek tahtada görünüm eskisi gibidir (Bilgisayar
 * sütunu ve süzgeci yok). Pencere kapanınca ya da sayfa yenilenince BÜTÜN WebSocket'ler kapanır → SSH'ler ve
 * tahtalardaki ajanlar sonlanır. Çok tahtada tablo tazelemesi birleştirilir (güncelleme aralığında bir kez).
 */
qx.Class.define("ankamon.ui.taskmgr.Window", {
  extend: qx.ui.window.Window,

  statics: {
    TABS: [["processes", "İşlemler"], ["performance", "Performans"], ["history", "Uygulama geçmişi"],
      ["startup", "Başlangıç uygulamaları"], ["users", "Kullanıcılar"], ["details", "Ayrıntılar"],
      ["services", "Hizmetler"], ["settings", "Ayarlar"]],
    PREF: "taskmgr.settings",
    /** Çok tahtada bağlantılar arka arkaya bu aralıkla (ms) açılır — 30 SSH'nin aynı anda başlamaması için. */
    CONNECT_STAGGER: 120,

    /**
     * Sağ menüden / araç çubuğundan: verilen tahtaların (çevrim içi olanlar) hepsiyle TEK pencere. Aynı tahta
     * kümesi için açık pencere varsa öne getirilir.
     * @param boards {Array|Map} tahta(lar) {id, label, hostname, ip}
     */
    open(boards, user) {
      const self = ankamon.ui.taskmgr.Window;
      const list = (Array.isArray(boards) ? boards : [boards]).filter(Boolean);
      if (!list.length) {
        return null;
      }
      const key = [...new Set(list.map(b => b.id))].sort((a, b) => a - b).join(",");
      self.__open = self.__open || new Map();
      const existing = self.__open.get(key);
      if (existing && !existing.isDisposed()) {
        existing.restore();
        existing.open();
        existing.activate();
        return existing;
      }
      const win = new self(list, user);
      self.__open.set(key, win);
      win.addListener("close", () => self.__open.delete(key));
      qx.core.Init.getApplication().getRoot().add(win);
      win.open();
      return win;
    }
  },

  construct(boards, user) {
    super("Görev Yöneticisi");
    const seen = new Set();
    const list = (Array.isArray(boards) ? boards : [boards]).filter(b => b && !seen.has(b.id) && seen.add(b.id));
    this.__user = user;
    this.__settings = Object.assign({ interval: 1, startTab: "processes", onTop: false, memPct: false },
      (user.ui_prefs || {})[ankamon.ui.taskmgr.Window.PREF] || {});
    this.__chosen = new Set();
    // Tahta başına bağ; sıra: "Bilgisayar" adına göre (doğal sıralama: A1-2 < A1-10).
    this.__links = list.map(b => new ankamon.ui.taskmgr.TaskBoardLink(b))
      .sort((a, b) => a.getDisplay().localeCompare(b.getDisplay(), "tr", { numeric: true }));
    this.__linkById = new Map(this.__links.map(l => [l.getId(), l]));
    this.__multi = this.__links.length > 1;
    this.setCaption("Görev Yöneticisi — " + (this.__multi ? `${this.__links.length} tahta` : this.__links[0].getName()));
    const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
    this.set({
      layout: new qx.ui.layout.VBox(6), contentPadding: 8, showMinimize: true, allowMaximize: true, showMaximize: true,
      width: Math.min(this.__multi ? 1320 : 1180, root.width - 40), height: Math.min(760, root.height - 40),
      alwaysOnTop: !!this.__settings.onTop, resizable: true
    });
    this.addListenerOnce("appear", () => this.center());

    // --- üst çubuk (Windows 11: arama + komutlar) ---------------------------------------------------------
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
    this.__search = new qx.ui.form.TextField().set({
      placeholder: this.__multi ? "Ad, PID, kullanıcı, komut ya da bilgisayar ara" : "Ad, PID, kullanıcı ya da komut ara",
      width: 280, liveUpdate: true
    });
    this.__search.addListener("changeValue", () => this.__refresh());
    bar.add(this.__search);
    if (this.__multi) {
      this.__picker = new ankamon.ui.taskmgr.TaskBoardPicker(this);
      bar.add(this.__picker);
    }
    bar.add(new qx.ui.core.Spacer(), { flex: 1 });
    const btn = (label, handler, tip) => {
      const b = new qx.ui.form.Button(label).set({ toolTipText: tip || null, padding: [3, 10] });
      b.addListener("execute", handler, this);
      bar.add(b);
      return b;
    };
    btn("▸ Yeni görev çalıştır", () => this.runTask(), "Tahtada bir program/komut başlatır");
    this.__endBtn = btn("✕ Görevi sonlandır", () => this.__endSelected(), "Seçili işlemi sonlandırır (Delete)");
    this.__ecoBtn = btn("🍃 Verimlilik modu", () => this.__ecoSelected(), "Seçili işlemin önceliğini ve disk önceliğini en düşüğe alır");
    const view = new qx.ui.menu.Menu();
    const speed = new qx.ui.menu.Menu();
    const speedGroup = new qx.ui.form.RadioGroup();
    this.__speedButtons = ankamon.ui.taskmgr.SettingsTab.SPEEDS.map(([l, v]) => {
      const b = new qx.ui.menu.RadioButton(l).set({ value: v === this.__settings.interval });
      b.setUserData("v", v);
      b.addListener("execute", () => this.setSpeed(v));
      speedGroup.add(b);
      speed.add(b);
      return b;
    });
    view.add(new qx.ui.menu.Button("Güncelleme hızı", null, null, speed));
    const refreshNow = new qx.ui.menu.Button("Şimdi yenile");
    refreshNow.addListener("execute", () => this.__sendAll("interval", { sec: this.__settings.interval || 1 }));
    view.add(refreshNow);
    this.__onTopBox = new qx.ui.menu.CheckBox("Her zaman üstte").set({ value: !!this.__settings.onTop });
    this.__onTopBox.addListener("execute", () => this.setSetting("onTop", this.__onTopBox.getValue()));
    view.add(this.__onTopBox);
    bar.add(new qx.ui.form.MenuButton("Görünüm", null, view).set({ padding: [3, 10] }));
    this.add(bar);

    // --- sekmeler (solda, Windows 11 gezinti çubuğu gibi) --------------------------------------------------
    this.__tabs = new qx.ui.tabview.TabView("left");
    this.__tabMap = new Map();
    // Tam adlarla: qooxdoo derleyicisi bağımlılığı yalnız tam sınıf adından görür — kısaltma değişkeniyle
    // (T.ProcessesTab) yazılınca sınıflar build paketine girmiyor, pencere "e is not a constructor" ile açılmıyordu.
    [ankamon.ui.taskmgr.ProcessesTab, ankamon.ui.taskmgr.PerformanceTab, ankamon.ui.taskmgr.AppHistoryTab,
      ankamon.ui.taskmgr.StartupTab, ankamon.ui.taskmgr.UsersTab, ankamon.ui.taskmgr.DetailsTab,
      ankamon.ui.taskmgr.ServicesTab, ankamon.ui.taskmgr.SettingsTab]
      .forEach(Cls => {
        const tab = new Cls(this);
        this.__tabMap.set(tab.getUserData("key"), tab);
        this.__tabs.add(tab);
      });
    const start = this.__tabMap.get(this.__settings.startTab);
    if (start) {
      this.__tabs.setSelection([start]);
    }
    this.__tabs.addListener("changeSelection", () => this.__onTab());
    this.add(this.__tabs, { flex: 1 });

    // --- durum satırı ----------------------------------------------------------------------------------------
    const foot = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__status = new qx.ui.basic.Label(this.__multi ? "Tahtalara bağlanılıyor…" : "Tahtaya bağlanılıyor…").set({ rich: true, textColor: "app-muted" });
    foot.add(this.__status, { flex: 1 });
    if (this.__multi) {
      // Bağlanamayan tahtalar: tek tek ya da hepsi yeniden bağlanır (menü durum değiştikçe yeniden kurulur).
      this.__reconnect = new qx.ui.form.MenuButton("Bağlanamayanlar").set({ visibility: "excluded", padding: [2, 10] });
    } else {
      this.__reconnect = new qx.ui.form.Button("Yeniden bağlan").set({ visibility: "excluded", padding: [2, 10] });
      this.__reconnect.addListener("execute", () => this.reconnect(this.__links[0]));
    }
    foot.add(this.__reconnect);
    this.add(foot);

    // --- bağlar: pencere kapanınca bütün SSH'ler de kapanır ----------------------------------------------------
    this.__links.forEach((link, i) => {
      link.addListener("updated", e => this.__onUpdated(link, e.getData().kind));
      link.addListener("changeLinkState", () => this.__onLinkState(link));
      if (i === 0) {
        link.connect();
      } else {
        qx.event.Timer.once(() => {
          if (!this.isDisposed() && link.getState() === "connecting" && !link.isOpen()) {
            link.connect();
          }
        }, this, i * ankamon.ui.taskmgr.Window.CONNECT_STAGGER);
      }
    });
    this.addListener("close", () => {
      this.__closed = true;
      this.__links.forEach(l => l.close());
      qx.event.Timer.once(() => this.destroy(), null, 0);
    });
    this.addListener("keypress", e => {
      if (e.getKeyIdentifier() === "F5") {
        e.preventDefault();
      }
    });
  },

  destruct() {
    if (this.__refreshTimer) {
      clearTimeout(this.__refreshTimer);
    }
    (this.__links || []).forEach(l => l.dispose());
    this.__links = this.__linkById = null;
  },

  members: {
    __user: null,
    __settings: null,
    __links: null,
    __linkById: null,
    __multi: false,
    __chosen: null,
    __closed: false,
    __picker: null,
    __search: null,
    __tabs: null,
    __tabMap: null,
    __status: null,
    __reconnect: null,
    __reconnectSig: null,
    __endBtn: null,
    __ecoBtn: null,
    __speedButtons: null,
    __onTopBox: null,
    __pendingServices: null,
    __refreshTimer: null,

    getUser() {
      return this.__user;
    },

    // ---- tahtalar ---------------------------------------------------------------------------------------------
    /** Bütün tahta bağları (pencere sırasıyla). */
    getLinks() {
      return this.__links;
    },

    /** @param id {Number|String} tahta kimliği */
    getLink(id) {
      return this.__linkById.get(Number(id)) || null;
    },

    /** Pencere birden çok tahtayla mı açıldı ("Bilgisayar" sütunu ve süzgeci yalnız o zaman). */
    isMulti() {
      return this.__multi;
    },

    /** "Bilgisayar" süzgecine uyan bağlar (süzgeç boşsa hepsi). */
    getVisibleLinks() {
      return this.__links.filter(l => !this.__chosen.size || this.__chosen.has(l.getId()));
    },

    hasBoardFilter() {
      return this.__chosen.size > 0;
    },

    isBoardChosen(id) {
      return this.__chosen.has(Number(id));
    },

    /** "Bilgisayar" süzgeci: seçili tahta kimlikleri (boş → hepsi). */
    setBoardFilter(ids) {
      this.__chosen = new Set((ids || []).map(Number).filter(id => this.__linkById.has(id)));
      if (this.__picker) {
        this.__picker.sync();
      }
      this.__tabMap.forEach(tab => tab.onBoardFilter());
      this.__refresh();
    },

    /** Süzgeçte tek tahta varsa o (yeni görev, Performans varsayılanı), yoksa null. Tek tahtalı pencerede o tahta. */
    getSingleChosen() {
      if (!this.__multi) {
        return this.__links[0];
      }
      return this.__chosen.size === 1 ? this.getLink([...this.__chosen][0]) : null;
    },

    /**
     * Arama metni tahtanın "Bilgisayar" adıyla eşleşiyor mu (yalnız çok tahtada): eşleşirse o tahtanın bütün
     * satırları gösterilir (satırın kendi alanları ayrıca aranmaz).
     */
    boardMatches(link, q) {
      return this.__multi && !!q && link.getDisplay().toLowerCase().includes(q);
    },

    /** Uyumluluk (testler): verilen ya da ilk tahtanın modeli / bağlantısı. */
    getModel(id) {
      const link = id === undefined ? this.__links[0] : this.getLink(id);
      return link ? link.getModel() : null;
    },

    getConn(id) {
      const link = id === undefined ? this.__links[0] : this.getLink(id);
      return link ? link.getConn() : null;
    },

    reconnect(link) {
      if (!this.__closed) {
        link.connect();
      }
    },

    /** Bütün açık bağlara komut (görünüm komutları: interval, want); hatalar yutulur. */
    __sendAll(op, args) {
      this.__links.forEach(l => {
        if (l.isOpen()) {
          l.send(op, args).catch(() => {});
        }
      });
    },

    // ---- ayarlar ------------------------------------------------------------------------------------------------
    getSettings() {
      return this.__settings;
    },

    getTabKeys() {
      return ankamon.ui.taskmgr.Window.TABS;
    },

    getFilter() {
      return (this.__search.getValue() || "").trim().toLowerCase();
    },

    setSetting(key, value) {
      this.__settings[key] = value;
      if (key === "onTop") {
        this.setAlwaysOnTop(!!value);
        this.__onTopBox.setValue(!!value);
      }
      ankamon.page.Base.savePref(this.__user, ankamon.ui.taskmgr.Window.PREF, Object.assign({}, this.__settings));
      this.__refresh();
    },

    setSpeed(v) {
      this.setSetting("interval", v);
      this.__speedButtons.forEach(b => b.setValue(b.getUserData("v") === v));
      const settingsTab = this.__tabMap.get("settings");
      if (settingsTab) {
        settingsTab.syncSpeed(v);
      }
      this.__sendAll("interval", { sec: v });
      this.__updateStatus();
    },

    // ---- bağ olayları -----------------------------------------------------------------------------------------
    __onLinkState(link) {
      if (this.__closed) {
        return;
      }
      if (link.getState() === "open") {
        link.send("interval", { sec: this.__settings.interval }).catch(() => {});
        link.send("want", { what: this.__want() }).catch(() => {});
      }
      if (this.__picker) {
        this.__picker.sync();
      }
      this.__updateReconnect();
      this.__updateStatus();
      if (link.getState() !== "open") {
        // Kopan/yeniden bağlanan tahtanın satırları tablodan düşsün (model boşaldı).
        this.__scheduleRefresh();
      }
    },

    __onUpdated(link, kind) {
      if (this.__closed) {
        return;
      }
      if (kind === "services" && this.__pendingServices && this.__pendingServices.link === link) {
        const pending = this.__pendingServices;
        this.__pendingServices = null;
        this.__tabMap.get("services").reveal(link, pending.names);
        return;
      }
      const key = this.__currentKey();
      if ((kind === "services" && key !== "services" && key !== "details") || (kind === "startup" && key !== "startup")) {
        return;
      }
      this.__scheduleRefresh();
    },

    /**
     * Çerçeve geldi: görünen sekme tazelenir. Tek tahtada hemen (eskisi gibi); çok tahtada bütün tahtaların
     * çerçeveleri birleştirilir — güncelleme aralığında (en az 0,5 sn) bir kez (30 tahtada saniyede 30 kez tabloyu
     * yeniden kurmak tarayıcıyı boğardı).
     */
    __scheduleRefresh() {
      if (!this.__multi) {
        this.__refresh();
        return;
      }
      if (this.__refreshTimer) {
        return;
      }
      const delay = Math.max(500, (this.__settings.interval || 1) * 1000);
      this.__refreshTimer = setTimeout(() => {
        this.__refreshTimer = null;
        if (!this.isDisposed()) {
          this.__refresh();
        }
      }, delay);
    },

    /** Görünen sekme + durum satırı + üst düğmeler. */
    __refresh() {
      const tab = this.__tabs.getSelection()[0];
      if (tab) {
        tab.update();
      }
      this.__updateStatus();
      const sel = this.__selection();
      this.__endBtn.setEnabled(!!sel);
      this.__ecoBtn.setEnabled(!!sel);
    },

    __updateStatus() {
      const F = ankamon.ui.taskmgr.Fmt;
      const paused = !this.__settings.interval ? " · <b>Güncelleme duraklatıldı</b>" : "";
      if (!this.__multi) {
        const link = this.__links[0];
        const m = link.getModel();
        if (link.getState() === "closed") {
          this.__status.setValue(`<span style="color:#c42b1c">⚠ ${F.esc(link.getError())}</span>`);
          return;
        }
        if (!m.snap) {
          this.__status.setValue("Tahtaya bağlanılıyor…");
          return;
        }
        this.__status.setValue(`🟢 ${F.esc(link.getName())} (${F.esc(m.static ? m.static.hostname : "")}) · ` +
          `İşlemler: ${m.procs.size} · CPU kullanımı: ${F.pct(m.totals.cpu, 0)} · ` +
          `Fiziksel bellek: ${F.pct((100 * m.totals.memUsed) / (m.memTotal || 1), 0)} · ` +
          `Çalışma süresi: ${F.uptime(m.snap.uptime)}${paused}`);
        return;
      }
      const all = this.__links;
      const open = all.filter(l => l.getState() === "open").length;
      const failed = all.filter(l => l.getState() === "closed").length;
      const connecting = all.length - open - failed;
      const shown = this.getVisibleLinks().filter(l => l.getModel().snap);
      const avg = f => (shown.length ? shown.reduce((a, l) => a + f(l.getModel()), 0) / shown.length : 0);
      const parts = [`${open ? "🟢" : "⏳"} ${open}/${all.length} tahtaya bağlı`];
      if (failed) {
        parts.push(`<span style="color:#c42b1c">⚠ ${failed} tahtaya bağlanılamadı</span>`);
      }
      if (connecting) {
        parts.push(`${connecting} bağlanıyor…`);
      }
      if (shown.length) {
        parts.push(`Gösterilen: ${shown.length} tahta`,
          `İşlemler: ${shown.reduce((a, l) => a + l.getModel().procs.size, 0)}`,
          `Ort. CPU: ${F.pct(avg(m => m.totals.cpu), 0)}`,
          `Ort. bellek: ${F.pct(avg(m => (100 * m.totals.memUsed) / (m.memTotal || 1)), 0)}`);
      }
      this.__status.setValue(parts.join(" · ") + paused);
    },

    /** Yeniden bağlan düğmesi (tek tahta) / "Bağlanamayanlar" menüsü (çok tahta). */
    __updateReconnect() {
      const failed = this.__links.filter(l => l.getState() === "closed");
      if (!this.__multi) {
        this.__reconnect.setVisibility(failed.length ? "visible" : "excluded");
        return;
      }
      const sig = failed.map(l => l.getId() + ":" + l.getError()).join("|");
      if (sig === this.__reconnectSig) {
        return;
      }
      this.__reconnectSig = sig;
      const old = this.__reconnect.getMenu();
      this.__reconnect.resetMenu();
      if (old) {
        old.dispose();
      }
      if (!failed.length) {
        this.__reconnect.exclude();
        return;
      }
      const F = ankamon.ui.taskmgr.Fmt;
      const menu = new qx.ui.menu.Menu();
      const all = new qx.ui.menu.Button(`↻ Tümünü yeniden bağlan (${failed.length})`);
      all.addListener("execute", () => this.__links.filter(l => l.getState() === "closed").forEach(l => this.reconnect(l)));
      menu.add(all);
      menu.add(new qx.ui.menu.Separator());
      failed.forEach(link => {
        const b = new qx.ui.menu.Button(`↻ ${F.esc(link.getDisplay())} — <span style="opacity:.7">${F.esc(link.getError() || "")}</span>`);
        b.getChildControl("label").setRich(true);
        b.addListener("execute", () => this.reconnect(link));
        menu.add(b);
      });
      this.__reconnect.set({ label: `⚠ Bağlanamayanlar (${failed.length})`, menu });
      this.__reconnect.show();
    },

    __currentKey() {
      const tab = this.__tabs.getSelection()[0];
      return tab ? tab.getUserData("key") : "";
    },

    /** Ajandan istenen seyrek bölümler: yalnız görünen sekmenin gerektirdikleri (bütün tahtalara aynı). */
    __want() {
      const key = this.__currentKey();
      const want = [];
      if (key === "services" || key === "details") {
        want.push("services");
      }
      if (key === "startup") {
        want.push("startup");
      }
      return want;
    },

    /** Sekme değişti: ajanlardan yalnız gereken seyrek bölümler istenir (hizmetler, başlangıç), sekme tazelenir. */
    __onTab() {
      this.__sendAll("want", { what: this.__want() });
      this.__refresh();
    },

    __selection() {
      const tab = this.__tabs.getSelection()[0];
      return tab && tab.selected ? tab.selected() : null;
    },

    __endSelected() {
      const s = this.__selection();
      if (s) {
        this.endTask(s.link, s.pid, s.tree, s.name);
      }
    },

    __ecoSelected() {
      const s = this.__selection();
      const p = s && s.link.getModel().procs.get(s.pid);
      if (p) {
        this.efficiency(s.link, s.pid, !p.eco, p.name);
      }
    },

    selectTab(key) {
      const tab = this.__tabMap.get(key);
      if (tab) {
        this.__tabs.setSelection([tab]);
      }
      return tab;
    },

    /** Onay/ileti metinlerinde tahta (yalnız çok tahtada): " — <i>A1-5 [etap-…]</i>". */
    whereHtml(link) {
      return this.__multi ? ` — <i>${ankamon.ui.taskmgr.Fmt.esc(link.getDisplay())}</i>` : "";
    },

    // ---- işlemler (sekmeler çağırır; her biri satırın tahtasına gider) ------------------------------------------
    async endTask(link, pid, tree, name) {
      const F = ankamon.ui.taskmgr.Fmt;
      const p = link.getModel().procs.get(pid);
      const system = p && p.uid < 1000;
      const text = (tree ? `<b>${F.esc(name)}</b> (${pid})${this.whereHtml(link)} işlem ağacı sonlandırılsın mı?<br><br>Bu işlem ve başlattığı tüm işlemler kapanır.`
        : `<b>${F.esc(name)}</b> (${pid})${this.whereHtml(link)} sonlandırılsın mı?`) +
        (system ? "<br><br><b>Bu bir sistem işlemi.</b> Sonlandırmak tahtayı kararsız hale getirebilir ya da oturumu kapatabilir." : "") +
        "<br><br>Kaydedilmemiş veriler kaybolur.";
      if (!(await this.__confirm(text, tree ? "İşlem ağacını sonlandır" : "İşlemi sonlandır"))) {
        return;
      }
      try {
        await link.send(tree ? "killtree" : "kill", { pid });
        if (!tree) {
          // Windows gibi: 3 sn içinde kapanmazsa zorla sonlandırma önerilir.
          qx.event.Timer.once(async () => {
            if (!this.isDisposed() && link.getModel().procs.has(pid) &&
              await this.__confirm(`<b>${F.esc(name)}</b> (${pid})${this.whereHtml(link)} kapanmadı. Zorla sonlandırılsın mı (SIGKILL)?`, "Zorla sonlandır")) {
              link.send("kill", { pid, force: true }).catch(e => ankamon.ui.Dialog.error(e));
            }
          }, this, 3000);
        }
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async efficiency(link, pid, on, name) {
      try {
        await link.send("efficiency", { pid, on });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async setPriority(link, pid, nice, name, label) {
      if (nice < -5 && !(await this.__confirm(`<b>${ankamon.ui.taskmgr.Fmt.esc(name)}</b>${this.whereHtml(link)} önceliği "${label}" yapılsın mı?<br><br>` +
        "Çok yüksek öncelik tahtanın diğer işlerini (ses, ekran, giriş) yavaşlatabilir.", "Önceliği değiştir"))) {
        return;
      }
      try {
        await link.send("renice", { pid, nice });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    /** İşlemci benzeşimi penceresi (bkz. TaskDialogs). */
    setAffinity(link, pid, name) {
      return ankamon.ui.taskmgr.TaskDialogs.affinity(this, link, pid, name);
    },

    /** Süreç özellikleri penceresi (bkz. TaskDialogs). */
    showProps(link, pid) {
      return ankamon.ui.taskmgr.TaskDialogs.props(this, link, pid);
    },

    async showLocation(link, pid) {
      try {
        const res = await link.send("props", { pid });
        const F = ankamon.ui.taskmgr.Fmt;
        ankamon.ui.Dialog.alert((this.__multi ? `<b>Bilgisayar:</b> ${F.esc(link.getDisplay())}<br>` : "") +
          `<b>Konum:</b> ${F.esc(res.props.exe || "(çekirdek iş parçacığı — dosyası yok)")}` +
          `<br><b>Çalışma dizini:</b> ${F.esc(res.props.cwd || "—")}<br><br>` +
          `<span style="opacity:.7">Tahtanın dosyalarına sağ menü ▸ Dosyalar ▸ Dosya yöneticisi ile göz atabilirsiniz.</span>`, "Dosya konumu");
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    goToDetails(link, pid) {
      const tab = this.selectTab("details");
      tab.reveal(link, pid);
    },

    goToServices(link, names) {
      const tab = this.selectTab("services");
      if (link.getModel().services) {
        tab.reveal(link, names);
      } else {
        this.__pendingServices = { link, names };
      }
    },

    /** Yeni görev çalıştır (çok tahtada tahta seçilerek — bkz. TaskDialogs.runTask). */
    runTask() {
      ankamon.ui.taskmgr.TaskDialogs.runTask(this);
    },

    /** Diyaloglar: görev yöneticisi "her zaman üstte" iken arkada kalmasınlar. */
    dialog(caption, width) {
      const win = ankamon.ui.Dialog.window(caption, width);
      if (this.getAlwaysOnTop()) {
        win.setAlwaysOnTop(true);
      }
      return win;
    },

    __confirm(text, ok) {
      if (!this.getAlwaysOnTop()) {
        return ankamon.ui.Dialog.confirm(text, ok);
      }
      // Her zaman üstte iken onay penceresi de üstte açılsın (Dialog.confirm normal katmanda açılır).
      this.setAlwaysOnTop(false);
      return ankamon.ui.Dialog.confirm(text, ok).finally(() => this.setAlwaysOnTop(!!this.__settings.onTop));
    }
  }
});
