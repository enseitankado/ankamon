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
 * Görev yöneticisi penceresi (Tahtalar/Ekranlar sağ menüsü "Görev yöneticisi" — kullanıcı isteği: Windows Görev
 * Yöneticisi'nin özellikleri ve görünümü). Sekmeler (Windows 11 gibi solda): İşlemler, Performans, Uygulama
 * geçmişi, Başlangıç uygulamaları, Kullanıcılar, Ayrıntılar, Hizmetler, Ayarlar. Üstte arama, Yeni görev
 * çalıştır, Görevi sonlandır, Verimlilik modu, Görünüm (güncelleme hızı, her zaman üstte).
 *
 * Pencere açık kaldıkça tahtaya TEK canlı SSH bağlantısı (bkz. Connection, worker screen/taskmgr.py) tutulur;
 * pencere kapanınca ya da sayfa yenilenince WebSocket kapanır → SSH ve tahtadaki ajan sonlanır.
 * Model (getModel): ajan çerçevelerinden türetilen süreç haritası, ağaç, uygulamalar, toplamlar ve 60 sn geçmiş.
 */
qx.Class.define("ankamon.ui.taskmgr.Window", {
  extend: qx.ui.window.Window,

  statics: {
    TABS: [["processes", "İşlemler"], ["performance", "Performans"], ["history", "Uygulama geçmişi"],
      ["startup", "Başlangıç uygulamaları"], ["users", "Kullanıcılar"], ["details", "Ayrıntılar"],
      ["services", "Hizmetler"], ["settings", "Ayarlar"]],
    PREF: "taskmgr.settings",

    /** Sağ menüden: tahta başına tek pencere (açıksa öne getirilir). */
    open(board, user) {
      const self = ankamon.ui.taskmgr.Window;
      self.__open = self.__open || new Map();
      const existing = self.__open.get(board.id);
      if (existing && !existing.isDisposed()) {
        existing.restore();
        existing.open();
        existing.activate();
        return existing;
      }
      const win = new self(board, user);
      self.__open.set(board.id, win);
      win.addListener("close", () => self.__open.delete(board.id));
      qx.core.Init.getApplication().getRoot().add(win);
      win.open();
      return win;
    }
  },

  construct(board, user) {
    const name = board.label || board.hostname || board.ip || "#" + board.id;
    super("Görev Yöneticisi — " + name);
    this.__board = board;
    this.__boardName = name;
    this.__user = user;
    this.__settings = Object.assign({ interval: 1, startTab: "processes", onTop: false, memPct: false },
      (user.ui_prefs || {})[ankamon.ui.taskmgr.Window.PREF] || {});
    this.__model = this.__emptyModel();
    const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
    this.set({
      layout: new qx.ui.layout.VBox(6), contentPadding: 8, showMinimize: true, allowMaximize: true, showMaximize: true,
      width: Math.min(1180, root.width - 40), height: Math.min(760, root.height - 40),
      alwaysOnTop: !!this.__settings.onTop, resizable: true
    });
    this.addListenerOnce("appear", () => this.center());

    // --- üst çubuk (Windows 11: arama + komutlar) ---------------------------------------------------------
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
    this.__search = new qx.ui.form.TextField().set({ placeholder: "Ad, PID, kullanıcı ya da komut ara", width: 280, liveUpdate: true });
    this.__search.addListener("changeValue", () => this.__refresh());
    bar.add(this.__search);
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
    refreshNow.addListener("execute", () => this.__conn.send("interval", { sec: this.__settings.interval || 1 }).catch(() => {}));
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
    this.__status = new qx.ui.basic.Label("Tahtaya bağlanılıyor…").set({ rich: true, textColor: "app-muted" });
    foot.add(this.__status, { flex: 1 });
    this.__reconnect = new qx.ui.form.Button("Yeniden bağlan").set({ visibility: "excluded", padding: [2, 10] });
    this.__reconnect.addListener("execute", () => this.__connect());
    foot.add(this.__reconnect);
    this.add(foot);

    // --- bağlantı: pencere kapanınca SSH de kapanır ----------------------------------------------------------
    this.__conn = new ankamon.ui.taskmgr.Connection(board.id);
    this.__conn.addListener("frame", e => this.__onFrame(e.getData()));
    this.__conn.addListener("opened", () => {
      this.__reconnect.exclude();
      this.__conn.send("interval", { sec: this.__settings.interval }).catch(() => {});
      this.__onTab();
    });
    this.__conn.addListener("closed", e => {
      this.__status.setValue(`<span style="color:#c42b1c">⚠ ${ankamon.ui.taskmgr.Fmt.esc(e.getData().text)}</span>`);
      this.__reconnect.show();
    });
    this.addListener("close", () => {
      this.__conn.close();
      qx.event.Timer.once(() => this.destroy(), null, 0);
    });
    this.addListener("keypress", e => {
      if (e.getKeyIdentifier() === "F5") {
        e.preventDefault();
      }
    });
    this.__connect();
  },

  destruct() {
    if (this.__conn) {
      this.__conn.dispose();
    }
  },

  members: {
    __board: null,
    __boardName: null,
    __user: null,
    __settings: null,
    __model: null,
    __conn: null,
    __search: null,
    __tabs: null,
    __tabMap: null,
    __status: null,
    __reconnect: null,
    __endBtn: null,
    __ecoBtn: null,
    __speedButtons: null,
    __onTopBox: null,
    __pendingServices: null,

    getUser() {
      return this.__user;
    },

    getConn() {
      return this.__conn;
    },

    getModel() {
      return this.__model;
    },

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
      this.__conn.send("interval", { sec: v }).catch(() => {});
      this.__updateStatus();
    },

    __connect() {
      this.__model = this.__emptyModel();
      this.__status.setValue("Tahtaya bağlanılıyor…");
      this.__conn.open();
    },

    __emptyModel() {
      const m = {
        static: null, snap: null, hz: 100, procs: new Map(), children: new Map(), windows: new Map(),
        appRoots: [], appOf: new Map(), session: null, users: null, services: null, startup: null,
        memTotal: 0, totals: { cpu: 0, memUsed: 0, diskBusy: 0, netPct: 0 },
        hist: { cpu: [], cores: [], mem: [], disks: {}, nets: {}, gpus: [] },
        netAcc: new Map(), netSince: Date.now()
      };
      m.descendants = root => {
        const out = [];
        const stack = [root];
        while (stack.length) {
          const pid = stack.pop();
          if (m.procs.has(pid)) {
            out.push(pid);
          }
          (m.children.get(pid) || []).forEach(c => stack.push(c));
        }
        return out;
      };
      m.appName = root => {
        const p = m.procs.get(root);
        if (!p) {
          return String(root);
        }
        const exe = (p.exe || "").split("/").pop() || p.name;
        return exe.charAt(0).toUpperCase() + exe.slice(1);
      };
      return m;
    },

    __push(arr, v) {
      arr.push(v);
      if (arr.length > ankamon.ui.taskmgr.Graph.POINTS) {
        arr.shift();
      }
    },

    __onFrame(f) {
      const m = this.__model;
      if (f.t === "static") {
        m.static = f;
        m.hz = f.hz || 100;
        return;
      }
      if (f.t === "services") {
        m.services = f.items;
        this.__tabMap.get("services").update(m);
        if (this.__pendingServices) {
          this.__tabMap.get("services").reveal(this.__pendingServices);
          this.__pendingServices = null;
        }
        return;
      }
      if (f.t === "startup") {
        m.startup = f;
        this.__tabMap.get("startup").update(m);
        return;
      }
      if (f.t === "error") {
        this.warn("görev yöneticisi ajanı: " + f.msg);
        return;
      }
      if (f.t !== "snap") {
        return;
      }
      m.snap = f;
      if (f.users) {
        m.users = f.users;
      }
      m.session = f.session || m.session;
      // Süreçler: [pid,ppid,ad,durum,kullanıcı,cpu,bellek,disk,ağ,iş parçacığı,nice,başlangıç,tik,çekirdek,komut,yol,verimlilik,uid]
      m.procs = new Map();
      m.children = new Map();
      f.procs.forEach(r => {
        const p = { pid: r[0], ppid: r[1], name: r[2], state: r[3], user: r[4], cpu: r[5], mem: r[6], disk: r[7], net: r[8],
          threads: r[9], nice: r[10], start: r[11], ticks: r[12], kthread: !!r[13], cmd: r[14], exe: r[15], eco: !!r[16], uid: r[17] };
        m.procs.set(p.pid, p);
        if (!m.children.has(p.ppid)) {
          m.children.set(p.ppid, []);
        }
        m.children.get(p.ppid).push(p.pid);
        if (p.net) {
          m.netAcc.set(p.pid, (m.netAcc.get(p.pid) || 0) + p.net * (f.dt || 1));
        }
      });
      // Uygulamalar: penceresi olan süreçler; atası da pencereliyse ona katılır (tek uygulama).
      m.windows = new Map(Object.entries(f.windows || {}).map(([k, v]) => [Number(k), v]));
      const winPids = new Set([...m.windows.keys()].filter(pid => m.procs.has(pid)));
      m.appRoots = [...winPids].filter(pid => {
        let p = m.procs.get(pid);
        while (p && p.ppid > 1) {
          if (winPids.has(p.ppid)) {
            return false;
          }
          p = m.procs.get(p.ppid);
        }
        return true;
      });
      m.appOf = new Map();
      m.appRoots.forEach(root => m.descendants(root).forEach(pid => m.appOf.set(pid, root)));
      // Toplamlar ve 60 sn geçmiş.
      const mem = f.mem;
      m.memTotal = mem.total;
      const used = mem.total - mem.avail;
      const up = (f.nets || []).filter(n => n.up);
      const linkBits = up.reduce((a, n) => a + (Number(n.speed) > 0 ? Number(n.speed) * 1e6 : 0), 0);
      m.totals = {
        cpu: f.cpu.total, memUsed: used,
        diskBusy: Math.max(0, ...(f.disks || []).map(d => d.busy)),
        netPct: linkBits ? (100 * up.reduce((a, n) => a + (n.rx + n.tx) * 8, 0)) / linkBits : 0
      };
      const h = m.hist;
      this.__push(h.cpu, f.cpu.total);
      f.cpu.cores.forEach((v, i) => this.__push(h.cores[i] = h.cores[i] || [], v));
      this.__push(h.mem, (100 * used) / (mem.total || 1));
      (f.disks || []).forEach(d => {
        const hd = h.disks[d.name] = h.disks[d.name] || { busy: [], r: [], w: [] };
        this.__push(hd.busy, d.busy);
        this.__push(hd.r, d.r);
        this.__push(hd.w, d.w);
      });
      (f.nets || []).forEach(n => {
        const hn = h.nets[n.name] = h.nets[n.name] || { rx: [], tx: [] };
        this.__push(hn.rx, n.rx);
        this.__push(hn.tx, n.tx);
      });
      (f.gpus || []).forEach((g, i) => this.__push(h.gpus[i] = h.gpus[i] || [], g.busy ?? g.mhz ?? 0));
      this.__refresh();
    },

    /** Görünen sekme + Performans (sol liste grafikleri hep güncel kalsın) + durum satırı. */
    __refresh() {
      const tab = this.__tabs.getSelection()[0];
      if (tab) {
        tab.update(this.__model);
      }
      this.__updateStatus();
      const sel = this.__selection();
      this.__endBtn.setEnabled(!!sel);
      this.__ecoBtn.setEnabled(!!sel);
    },

    __updateStatus() {
      const m = this.__model;
      if (!m.snap) {
        return;
      }
      const F = ankamon.ui.taskmgr.Fmt;
      const paused = !this.__settings.interval ? " · <b>Güncelleme duraklatıldı</b>" : "";
      this.__status.setValue(`🟢 ${F.esc(this.__boardName)} (${F.esc(m.static ? m.static.hostname : "")}) · ` +
        `İşlemler: ${m.procs.size} · CPU kullanımı: ${F.pct(m.totals.cpu, 0)} · ` +
        `Fiziksel bellek: ${F.pct((100 * m.totals.memUsed) / (m.memTotal || 1), 0)} · ` +
        `Çalışma süresi: ${F.uptime(m.snap.uptime)}${paused}`);
    },

    /** Sekme değişti: ajandan yalnız gereken seyrek bölümler istenir (hizmetler, başlangıç), sekme tazelenir. */
    __onTab() {
      const tab = this.__tabs.getSelection()[0];
      const key = tab ? tab.getUserData("key") : "";
      const want = [];
      if (key === "services" || key === "details") {
        want.push("services");
      }
      if (key === "startup") {
        want.push("startup");
      }
      this.__conn.send("want", { what: want }).catch(() => {});
      this.__refresh();
    },

    __selection() {
      const tab = this.__tabs.getSelection()[0];
      return tab && tab.selected ? tab.selected() : null;
    },

    __endSelected() {
      const s = this.__selection();
      if (s) {
        this.endTask(s.pid, s.tree, s.name);
      }
    },

    __ecoSelected() {
      const s = this.__selection();
      const p = s && this.__model.procs.get(s.pid);
      if (p) {
        this.efficiency(s.pid, !p.eco, p.name);
      }
    },

    selectTab(key) {
      const tab = this.__tabMap.get(key);
      if (tab) {
        this.__tabs.setSelection([tab]);
      }
      return tab;
    },

    // ---- işlemler (sekmeler çağırır) ------------------------------------------------------------------------
    async endTask(pid, tree, name) {
      const F = ankamon.ui.taskmgr.Fmt;
      const p = this.__model.procs.get(pid);
      const system = p && p.uid < 1000;
      const text = (tree ? `<b>${F.esc(name)}</b> (${pid}) işlem ağacı sonlandırılsın mı?<br><br>Bu işlem ve başlattığı tüm işlemler kapanır.`
        : `<b>${F.esc(name)}</b> (${pid}) sonlandırılsın mı?`) +
        (system ? "<br><br><b>Bu bir sistem işlemi.</b> Sonlandırmak tahtayı kararsız hale getirebilir ya da oturumu kapatabilir." : "") +
        "<br><br>Kaydedilmemiş veriler kaybolur.";
      if (!(await this.__confirm(text, tree ? "İşlem ağacını sonlandır" : "İşlemi sonlandır"))) {
        return;
      }
      try {
        await this.__conn.send(tree ? "killtree" : "kill", { pid });
        if (!tree) {
          // Windows gibi: 3 sn içinde kapanmazsa zorla sonlandırma önerilir.
          qx.event.Timer.once(async () => {
            if (this.__model.procs.has(pid) && !this.isDisposed() &&
              await this.__confirm(`<b>${F.esc(name)}</b> (${pid}) kapanmadı. Zorla sonlandırılsın mı (SIGKILL)?`, "Zorla sonlandır")) {
              this.__conn.send("kill", { pid, force: true }).catch(e => ankamon.ui.Dialog.error(e));
            }
          }, this, 3000);
        }
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async efficiency(pid, on, name) {
      try {
        await this.__conn.send("efficiency", { pid, on });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async setPriority(pid, nice, name, label) {
      if (nice < -5 && !(await this.__confirm(`<b>${ankamon.ui.taskmgr.Fmt.esc(name)}</b> önceliği "${label}" yapılsın mı?<br><br>` +
        "Çok yüksek öncelik tahtanın diğer işlerini (ses, ekran, giriş) yavaşlatabilir.", "Önceliği değiştir"))) {
        return;
      }
      try {
        await this.__conn.send("renice", { pid, nice });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async setAffinity(pid, name) {
      let res;
      try {
        res = await this.__conn.send("getaffinity", { pid });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      const win = this.__dialog("İşlemci benzeşimi", 360);
      win.add(new qx.ui.basic.Label(`<b>${ankamon.ui.taskmgr.Fmt.esc(name)}</b> (${pid}) hangi işlemcilerde çalışabilir?`).set({ rich: true }));
      const all = new qx.ui.form.CheckBox("<Tüm işlemciler>").set({ value: res.cpus.length === res.ncpu });
      win.add(all);
      const boxes = [];
      for (let i = 0; i < res.ncpu; i++) {
        const b = new qx.ui.form.CheckBox(`CPU ${i}`).set({ value: res.cpus.includes(i), marginLeft: 20 });
        boxes.push(b);
        win.add(b);
      }
      all.addListener("execute", () => boxes.forEach(b => b.setValue(all.getValue())));
      const ok = new qx.ui.form.Button("Tamam");
      const cancel = new qx.ui.form.Button("İptal");
      cancel.addListener("execute", () => win.close());
      ok.addListener("execute", async () => {
        const cpus = boxes.map((b, i) => (b.getValue() ? i : -1)).filter(i => i >= 0);
        if (!cpus.length) {
          ankamon.ui.Dialog.alert("İşlemin en az bir işlemcide çalışması gerekir.");
          return;
        }
        try {
          await this.__conn.send("affinity", { pid, cpus });
          win.close();
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
      });
      ankamon.ui.Dialog.buttons(win, [cancel, ok]);
      win.open();
    },

    async showProps(pid) {
      let res;
      try {
        res = await this.__conn.send("props", { pid });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      const F = ankamon.ui.taskmgr.Fmt;
      const p = res.props;
      const row = (k, v) => `<tr><td style="opacity:.7;padding:3px 16px 3px 0;vertical-align:top;white-space:nowrap">${F.esc(k)}</td>` +
        `<td style="word-break:break-all">${F.esc(v ?? "—")}</td></tr>`;
      const win = this.__dialog(`${p.name} Özellikleri`, 620);
      win.add(new qx.ui.embed.Html(`<table style="width:100%;border-collapse:collapse">` + [
        row("Ad", p.name), row("PID / Üst PID", `${p.pid} / ${p.ppid}`), row("Kullanıcı", p.user), row("Durum", p.state),
        row("Konum (yol)", p.exe), row("Çalışma dizini", p.cwd), row("Komut satırı", p.cmdline),
        row("Başlangıç", p.started ? new Date(p.started * 1000).toLocaleString("tr-TR") : null),
        row("CPU süresi", p.cpu_time !== null ? F.cpuTime(p.cpu_time) : null), row("Öncelik", `${F.priority(p.nice)} (nice ${p.nice})`),
        row("Disk önceliği (ionice)", p.ionice), row("İşlemci benzeşimi", (p.affinity || []).map(c => "CPU " + c).join(", ")),
        row("İş parçacıkları", p.threads), row("Bellek (RSS / sanal / tepe)", `${p.vm_rss} / ${p.vm_size} / ${p.vm_peak}`),
        row("Takas", p.vm_swap), row("Açık dosya tanıtıcıları", p.fds), row("Bağlam değişimi (gönüllü / zorunlu)", (p.ctx || []).join(" / ")),
        row("Bekleme kanalı (wchan)", p.wchan), row("Denetim grubu (cgroup)", (p.cgroup || []).join(" "))
      ].join("") + "</table>").set({ minHeight: 420, overflowY: "auto", selectable: true }));
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [close]);
      win.open();
    },

    async showLocation(pid) {
      try {
        const res = await this.__conn.send("props", { pid });
        const F = ankamon.ui.taskmgr.Fmt;
        ankamon.ui.Dialog.alert(`<b>Konum:</b> ${F.esc(res.props.exe || "(çekirdek iş parçacığı — dosyası yok)")}` +
          `<br><b>Çalışma dizini:</b> ${F.esc(res.props.cwd || "—")}<br><br>` +
          `<span style="opacity:.7">Tahtanın dosyalarına sağ menü ▸ Dosyalar ▸ Dosya yöneticisi ile göz atabilirsiniz.</span>`, "Dosya konumu");
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    goToDetails(pid) {
      const tab = this.selectTab("details");
      tab.reveal(pid);
    },

    goToServices(names) {
      const tab = this.selectTab("services");
      if (this.__model.services) {
        tab.reveal(names);
      } else {
        this.__pendingServices = names;
      }
    },

    runTask() {
      const F = ankamon.ui.taskmgr.Fmt;
      const win = this.__dialog("Yeni görev oluştur", 520);
      const s = this.__model.session;
      win.add(new qx.ui.basic.Label("Tahtada çalıştırmak istediğiniz programın ya da komutun adını yazın " +
        `(ör. <i>firefox</i>, <i>nemo /home</i>, <i>xdg-open https://eba.gov.tr</i>). Program tahtanın ekranında ` +
        (s && s.user && s.user !== "lightdm" ? `<b>${F.esc(s.user)}</b> kullanıcısı olarak açılır.` : "açılır (oturum açık değil: root olarak).")).set({ rich: true, wrap: true }));
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      row.add(new qx.ui.basic.Label("Aç:"));
      const field = new qx.ui.form.TextField();
      row.add(field, { flex: 1 });
      win.add(row);
      const admin = new qx.ui.form.CheckBox("Bu görevi yönetici (root) ayrıcalıklarıyla oluştur");
      win.add(admin);
      const ok = new qx.ui.form.Button("Tamam");
      const cancel = new qx.ui.form.Button("İptal");
      cancel.addListener("execute", () => win.close());
      const go = async () => {
        const cmd = (field.getValue() || "").trim();
        if (!cmd) {
          return;
        }
        try {
          await this.__conn.send("run", { cmd, admin: admin.getValue() });
          win.close();
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
      };
      ok.addListener("execute", go);
      field.addListener("keypress", e => {
        if (e.getKeyIdentifier() === "Enter") {
          go();
        }
      });
      ankamon.ui.Dialog.buttons(win, [cancel, ok]);
      win.open();
      win.addListenerOnce("appear", () => field.focus());
    },

    /** Diyaloglar: görev yöneticisi "her zaman üstte" iken arkada kalmasınlar. */
    __dialog(caption, width) {
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
