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
 * SSH etkinliği penceresi (kullanıcı isteği 2026-11-10/11; alt çubuk ▸ SSH panelinden açılır): Ankamon konteynerinin
 * dışarıya açtığı BÜTÜN bağlantılar ve gönderdiği komutlar, canlı.
 *  - "SSH bağlantıları": her SSH çağrısı (görev çalıştırıcı, worker yoklamaları, ekran/ses/sohbet akışları, dosya
 *    işlemleri, dosya yöneticisi, web terminal, ansible — bkz. backend SshActivityApi) + açıkken anlık trafiği.
 *  - "Tüm bağlantılar": Ankamon süreçlerinin bütün açık TCP bağlantıları (SSH, Telegraf → node_exporter, rsyslog'a
 *    gelen loglar, web/API istemcileri, ekran yansıtma …) — yön, servis, cihaz, anlık hız ve toplam (bkz.
 *    worker/ankamon/connwatch.py; yalnız bu pencere açıkken örneklenir).
 * Üstte açık bağlantıların toplam anlık trafiği. Satıra çift tıklama: komut (sözdizimi renkli) + çıktısı
 * (ui.ssh.CommandView). Pencere küçültülebilir (ui.WindowDock), boyutlandırılabilir, büyütülebilir.
 */
qx.Class.define("ankamon.ui.ssh.ActivityWindow", {
  extend: qx.core.Object,

  statics: {
    __instance: null,
    CONN_MS: 2000,

    /** Çağıran servis → okunur ad. */
    SOURCES: {
      runner: "Görev çalıştırıcı", worker: "Worker", screen: "Ekran/canlı akış", files: "Dosya işlemleri",
      filemanager: "Dosya yöneticisi", webssh: "Web terminal", ansible: "Ansible", files_bridge: "Dosya işlemleri"
    },

    /** Pencereyi açar (açıksa öne getirir / küçültülmüşse geri açar). */
    open() {
      const W = ankamon.ui.ssh.ActivityWindow;
      if (!W.__instance || W.__instance.isDisposed()) {
        W.__instance = new W();
      }
      W.__instance.show();
      return W.__instance;
    },

    /** bayt/sn → "1,2 MB/sn" (null: "—"). */
    rate(v) {
      return v === null || v === undefined ? "—" : ankamon.util.Format.bytes(Math.round(v)) + "/sn";
    }
  },

  construct() {
    super();
    const store = ankamon.ui.ssh.ActivityStore.getInstance();
    const win = this.__win = ankamon.ui.Dialog.window("SSH etkinliği — Ankamon'un dışarıya açtığı bağlantılar", 1250,
      { maximizable: true });
    win.set({ height: 580, resizable: true, contentPadding: 8, layout: new qx.ui.layout.VBox(6) });

    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__filter = new qx.ui.form.TextField().set({ placeholder: "Süz (cihaz, IP, kaynak, komut …)", width: 280 });
    this.__filter.addListener("input", () => this.__renderAll());
    bar.add(this.__filter);
    // Varsayılan: yalnız açık bağlantılar (kullanıcı isteği 2026-11-11).
    this.__openOnly = new qx.ui.form.CheckBox("Yalnız açık bağlantılar").set({ value: true });
    this.__openOnly.addListener("changeValue", () => this.__render());
    bar.add(this.__openOnly);
    this.__pause = new qx.ui.form.ToggleButton("Duraklat").set({ toolTipText: "Liste donar; kayıt arka planda sürer" });
    this.__pause.addListener("changeValue", e => {
      this.__pause.setLabel(e.getData() ? "Sürdür" : "Duraklat");
      if (!e.getData()) {
        this.__renderAll();
      }
    });
    bar.add(this.__pause);
    const clear = new qx.ui.form.Button("Temizle").set({ toolTipText: "Bitmiş bağlantıları listeden kaldırır (açık olanlar kalır)" });
    clear.addListener("execute", () => store.clearFinished());
    bar.add(clear);
    bar.add(new qx.ui.core.Spacer(), { flex: 1 });
    // Açık bağlantıların toplam anlık trafiği (kullanıcı isteği): ↓ alınan, ↑ gönderilen.
    this.__traffic = new qx.ui.basic.Label("Anlık trafik: ölçülüyor …").set({ rich: true, font: "bold" });
    bar.add(this.__traffic);
    win.add(bar);

    const tabs = new qx.ui.tabview.TabView().set({ contentPadding: 4 });
    // --- SSH bağlantıları
    const sshPage = new qx.ui.tabview.Page("SSH bağlantıları").set({ layout: new qx.ui.layout.VBox(4) });
    const columns = [
      ["start", "Başlangıç", 80], ["state", "Durum", 66], ["dur", "Süre", 62], ["name", "Cihaz", 160],
      ["target", "Hedef", 145], ["src", "Kaynak", 125], ["tool", "Araç", 46], ["extra", "Port / tünel", 100],
      ["down", "↓/sn", 82], ["up", "↑/sn", 82], ["bytes", "Aktarılan", 110], ["cmd", "Komut", null]
    ];
    const model = this.__model = new qx.ui.table.model.Simple();
    ankamon.page.Base.keepSortOnReload(model);
    model.setColumns(["key"].concat(columns.map(c => c[1])), ["key"].concat(columns.map(c => c[0])));
    const table = this.__table = this.__makeTable(model, columns);
    ankamon.page.Base.filterTable(table, { offset: 1, choicesFor: ["state", "name", "src", "tool"] });
    table.addListener("cellDbltap", e => this.__showCommand(model.getValue(0, e.getRow())));
    table.setToolTipText("Satıra çift tıklayın: komut (renkli) ve çıktısı");
    sshPage.add(table, { flex: 1 });
    this.__count = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    sshPage.add(this.__count);
    tabs.add(sshPage);

    // --- Tüm bağlantılar (ss)
    const allPage = new qx.ui.tabview.Page("Tüm bağlantılar").set({ layout: new qx.ui.layout.VBox(4) });
    const ccols = [
      ["dir", "Yön", 60], ["service", "Servis", 190], ["name", "Cihaz", 160], ["remote", "Uzak uç", 160],
      ["local", "Yerel uç", 160], ["proc", "Süreç", 120], ["down", "↓/sn", 82], ["up", "↑/sn", 82],
      ["recv", "Alınan", 90], ["sent", "Gönderilen", 90]
    ];
    const cmodel = this.__cmodel = new qx.ui.table.model.Simple();
    ankamon.page.Base.keepSortOnReload(cmodel);
    cmodel.setColumns(["key"].concat(ccols.map(c => c[1])), ["key"].concat(ccols.map(c => c[0])));
    const ctable = this.__makeTable(cmodel, ccols);
    ankamon.page.Base.filterTable(ctable, { offset: 1, choicesFor: ["dir", "service", "name", "proc"] });
    ctable.setToolTipText("Ankamon süreçlerinin açık TCP bağlantıları (yalnız bu pencere açıkken 2 sn'de bir ölçülür). " +
      "Giden: Ankamon'un başlattığı; gelen: tahtaların/tarayıcıların Ankamon'a açtığı (ör. log gönderimi).");
    allPage.add(ctable, { flex: 1 });
    this.__ccount = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    allPage.add(this.__ccount);
    tabs.add(allPage);
    win.add(tabs, { flex: 1 });

    this.__onChanged = () => this.__render();
    store.addListener("changed", this.__onChanged);
    store.subscribe(this, 1500);
    // Açık bağlantıların süresi saniyede bir ilerler.
    this.__tick = new qx.event.Timer(1000);
    this.__tick.addListener("interval", () => {
      if (win.isSeeable() && this.__hasOpen) {
        this.__render();
      }
    });
    this.__tick.start();
    // Bağlantılar + trafik (connwatch) — pencere görünürken.
    this.__connTimer = new qx.event.Timer(ankamon.ui.ssh.ActivityWindow.CONN_MS);
    this.__connTimer.addListener("interval", this.__pollConns, this);
    this.__connTimer.start();
    this.__pollConns();
    win.addListener("close", () => this.dispose());
    this.__render();
  },

  destruct() {
    const store = ankamon.ui.ssh.ActivityStore.getInstance();
    store.removeListener("changed", this.__onChanged);
    store.unsubscribe(this);
    this.__tick.stop();
    this.__tick.dispose();
    this.__connTimer.stop();
    this.__connTimer.dispose();
  },

  members: {
    __win: null,
    __model: null,
    __cmodel: null,
    __table: null,
    __filter: null,
    __openOnly: null,
    __pause: null,
    __count: null,
    __ccount: null,
    __traffic: null,
    __tick: null,
    __connTimer: null,
    __onChanged: null,
    __hasOpen: false,
    __conns: null,
    __connNames: null,
    __connBusy: false,

    show() {
      if (!this.__win.isVisible()) {
        this.__win.open();
      }
      this.__win.setActive(true);
    },

    __makeTable(model, columns) {
      const table = new qx.ui.table.Table(model, {
        tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj)
      }).set({ statusBarVisible: false, showCellFocusIndicator: false, columnVisibilityButtonVisible: false });
      const cm = table.getTableColumnModel();
      cm.setColumnVisible(0, false);
      const behavior = cm.getBehavior();
      columns.forEach((c, i) => behavior.setWidth(i + 1, c[2] || "1*"));
      return table;
    },

    __renderAll() {
      this.__render();
      this.__renderConns();
    },

    async __pollConns() {
      if (this.__connBusy || !this.__win.isSeeable()) {
        return;
      }
      this.__connBusy = true;
      try {
        const res = await ankamon.io.Api.get("/ssh-activity/connections");
        if (this.isDisposed()) {
          return;
        }
        this.__conns = res.ready ? res.conns : null;
        this.__connNames = res.names || {};
        this.__renderConns();
        this.__render();
      } catch (e) {
        // geçici hata: sonraki turda yeniden
      } finally {
        this.__connBusy = false;
      }
    },

    /** Bir SSH kaydına ait açık TCP bağlantıları (trafik için): sarmalayıcı pid'i ya da hedef IP + servis. */
    __connsOf(c) {
      const conns = this.__conns || [];
      if (/^\d+$/.test(String(c.pid))) {
        return conns.filter(x => x.sshpass === Number(c.pid));
      }
      const ip = String(c.target || "").split("@").pop();
      const svc = c.src === "webssh" ? "Web terminal" : (c.src === "filemanager" ? "sshfs" : null);
      return svc ? conns.filter(x => x.rip === ip && x.rport === 22 && String(x.service).includes(svc.split(" ")[0])) : [];
    },

    __render() {
      if (this.__pause.getValue()) {
        return;
      }
      const W = ankamon.ui.ssh.ActivityWindow;
      const store = ankamon.ui.ssh.ActivityStore.getInstance();
      const F = ankamon.util.Format;
      const now = Math.floor(Date.now() / 1000);
      const all = store.getConnections();
      const text = (this.__filter.getValue() || "").trim().toLocaleLowerCase("tr");
      const openOnly = this.__openOnly.getValue();
      let open = 0;
      const rows = [];
      all.forEach(c => {
        if (!c.end) {
          open++;
        }
        if (openOnly && c.end) {
          return;
        }
        const name = store.nameOf(c.target);
        const src = W.SOURCES[c.src] || c.src;
        const extra = [c.port ? "port " + c.port : "", c.tunnel ? "tünel → " + c.tunnel : ""].filter(Boolean).join(", ");
        const cmd = String(c.cmd || "").replace(/\s+/g, " ").trim().slice(0, 400);
        const state = c.end ? (c.lost ? "Kayıp" : "Bitti") : "● Açık";
        const dur = F.duration((c.end || now) - c.start);
        // Bugün başlayanlar yalnız saatle (sütun dar kalsın); daha eskiler tarih + saat.
        const started = new Date(c.start * 1000);
        const when = started.toDateString() === new Date().toDateString()
          ? started.toLocaleTimeString("tr-TR") : started.toLocaleString("tr-TR");
        let down = "", up = "", bytes = "";
        if (!c.end && this.__conns) {
          const cs = this.__connsOf(c);
          if (cs.length) {
            const sum = k => cs.reduce((a, x) => a + (x[k] || 0), 0);
            down = W.rate(sum("rate_in"));
            up = W.rate(sum("rate_out"));
            bytes = `↓${F.bytes(sum("recv"))} ↑${F.bytes(sum("sent"))}`;
          }
        }
        const row = [c.key, when, state, dur, name, c.target, src, c.tool, extra, down, up, bytes, cmd];
        if (text && !row.slice(1).join(" ").toLocaleLowerCase("tr").includes(text)) {
          return;
        }
        rows.push(row);
      });
      this.__hasOpen = open > 0;
      this.__model.setData(rows);
      this.__count.setValue(`${rows.length} SSH bağlantısı gösteriliyor · <b>${open}</b> açık` +
        (store.hasFailed() ? " · <span style=\"color:#e74c3c\">sunucuya ulaşılamadı</span>" : ""));
    },

    __renderConns() {
      if (this.__pause.getValue()) {
        return;
      }
      const W = ankamon.ui.ssh.ActivityWindow;
      const F = ankamon.util.Format;
      const conns = this.__conns;
      if (!conns) {
        this.__traffic.setValue("Anlık trafik: ölçülüyor …");
        this.__cmodel.setData([]);
        this.__ccount.setValue("Bağlantı izleyici ilk ölçümü yapıyor (birkaç saniye) …");
        return;
      }
      const text = (this.__filter.getValue() || "").trim().toLocaleLowerCase("tr");
      const names = this.__connNames || {};
      let rin = 0, rout = 0, nout = 0;
      const rows = [];
      // En çok trafik yaratan üstte (kullanıcı sütun başlığıyla başka sıralayabilir).
      const load = c => (c.rate_in || 0) + (c.rate_out || 0);
      conns.slice().sort((a, b) => load(b) - load(a)).forEach(c => {
        rin += c.rate_in || 0;
        rout += c.rate_out || 0;
        nout += c.dir === "out" ? 1 : 0;
        const row = [c.local + ">" + c.remote, c.dir === "out" ? "Giden" : "Gelen", c.service, names[c.rip] || "",
          c.remote, c.local, `${c.proc} (${c.pid})`, W.rate(c.rate_in), W.rate(c.rate_out), F.bytes(c.recv), F.bytes(c.sent)];
        if (text && !row.slice(1).join(" ").toLocaleLowerCase("tr").includes(text)) {
          return;
        }
        rows.push(row);
      });
      this.__cmodel.setData(rows);
      this.__traffic.setValue(`Anlık trafik: ↓ ${W.rate(rin)} · ↑ ${W.rate(rout)} ` +
        `<span style="font-weight:normal;opacity:.75">(${conns.length} açık bağlantı)</span>`);
      this.__ccount.setValue(`${rows.length} bağlantı gösteriliyor · ${nout} giden, ${conns.length - nout} gelen · ` +
        "2 sn'de bir ölçülür");
    },

    /** Komut (sözdizimi renkli) + çıktısı — ui.ssh.CommandView. */
    __showCommand(key) {
      const conn = ankamon.ui.ssh.ActivityStore.getInstance().getConnections().find(c => c.key === key);
      if (conn) {
        new ankamon.ui.ssh.CommandView(conn);
      }
    }
  }
});
