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
 * SSH etkinliği penceresi (kullanıcı isteği 2026-11-10; alt çubuk ▸ SSH panelinden açılır): Ankamon konteynerinin
 * dışarıya açtığı BÜTÜN SSH bağlantıları ve gönderdiği komutlar, canlı, grid'de — en yeni üstte. Kaynaklar: görev
 * çalıştırıcı (komut/hazır işlem), worker yoklamaları (oturum, durum, donanım …), ekran/ses/sohbet/görev yöneticisi
 * akışları, dosya işlemleri, dosya yöneticisi (sshfs), web terminal, ansible (bkz. backend SshActivityApi).
 *
 * Pencere küçültülebilir (alt çubukta düğme olur — ui.WindowDock), boyutlandırılabilir ve büyütülebilir (tam ekran;
 * başlığa çift tıklama da büyütür). Satıra çift tıklama: komutun tamamı (kopyalanabilir). Duraklat: liste donar,
 * kayıt arka planda sürer. Temizle: bitmiş bağlantılar listeden kalkar (sunucudaki kayıt silinmez).
 */
qx.Class.define("ankamon.ui.ssh.ActivityWindow", {
  extend: qx.core.Object,

  statics: {
    __instance: null,

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
    }
  },

  construct() {
    super();
    const store = ankamon.ui.ssh.ActivityStore.getInstance();
    const win = this.__win = ankamon.ui.Dialog.window("SSH etkinliği — Ankamon'un dışarıya açtığı bağlantılar", 1150,
      { maximizable: true });
    win.set({ height: 540, resizable: true, contentPadding: 8, layout: new qx.ui.layout.VBox(6) });

    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__filter = new qx.ui.form.TextField().set({ placeholder: "Süz (cihaz, IP, kaynak, komut …)", width: 300 });
    this.__filter.addListener("input", () => this.__render());
    bar.add(this.__filter);
    this.__openOnly = new qx.ui.form.CheckBox("Yalnız açık bağlantılar");
    this.__openOnly.addListener("changeValue", () => this.__render());
    bar.add(this.__openOnly);
    this.__pause = new qx.ui.form.ToggleButton("Duraklat").set({ toolTipText: "Liste donar; kayıt arka planda sürer" });
    this.__pause.addListener("changeValue", e => {
      this.__pause.setLabel(e.getData() ? "Sürdür" : "Duraklat");
      if (!e.getData()) {
        this.__render();
      }
    });
    bar.add(this.__pause);
    const clear = new qx.ui.form.Button("Temizle").set({ toolTipText: "Bitmiş bağlantıları listeden kaldırır (açık olanlar kalır)" });
    clear.addListener("execute", () => store.clearFinished());
    bar.add(clear);
    bar.add(new qx.ui.core.Spacer(), { flex: 1 });
    this.__count = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    bar.add(this.__count);
    win.add(bar);

    const columns = [
      ["start", "Başlangıç", 90], ["state", "Durum", 70], ["dur", "Süre", 70], ["name", "Cihaz", 170],
      ["target", "Hedef", 150], ["src", "Kaynak", 130], ["tool", "Araç", 50], ["extra", "Port / tünel", 110],
      ["cmd", "Komut", null]
    ];
    const model = this.__model = new qx.ui.table.model.Simple();
    ankamon.page.Base.keepSortOnReload(model);
    model.setColumns(["key"].concat(columns.map(c => c[1])), ["key"].concat(columns.map(c => c[0])));
    const table = this.__table = new qx.ui.table.Table(model, {
      tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj)
    }).set({ statusBarVisible: false, showCellFocusIndicator: false, columnVisibilityButtonVisible: false });
    const cm = table.getTableColumnModel();
    cm.setColumnVisible(0, false);
    const behavior = cm.getBehavior();
    columns.forEach((c, i) => behavior.setWidth(i + 1, c[2] || "1*"));
    ankamon.page.Base.filterTable(table, { offset: 1, choicesFor: ["state", "name", "src", "tool"] }); // sütun süzgeçleri + hazır değer listeleri (üstteki arama kutusuyla birlikte)
    table.addListener("cellDbltap", e => this.__showCommand(model.getValue(0, e.getRow())));
    table.setToolTipText("Satıra çift tıklayın: komutun tamamı");
    win.add(table, { flex: 1 });

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
    win.addListener("close", () => this.dispose());
    this.__render();
  },

  destruct() {
    const store = ankamon.ui.ssh.ActivityStore.getInstance();
    store.removeListener("changed", this.__onChanged);
    store.unsubscribe(this);
    this.__tick.stop();
    this.__tick.dispose();
  },

  members: {
    __win: null,
    __model: null,
    __table: null,
    __filter: null,
    __openOnly: null,
    __pause: null,
    __count: null,
    __tick: null,
    __onChanged: null,
    __hasOpen: false,

    show() {
      if (this.__win.isVisible()) {
        this.__win.setActive(true);
      } else {
        this.__win.open();
      }
      this.__win.setActive(true);
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
        const row = [c.key, when, state, dur, name, c.target, src, c.tool, extra, cmd];
        if (text && !row.slice(1).join(" ").toLocaleLowerCase("tr").includes(text)) {
          return;
        }
        rows.push(row);
      });
      this.__hasOpen = open > 0;
      this.__model.setData(rows);
      this.__count.setValue(`${rows.length} bağlantı gösteriliyor · <b>${open}</b> açık` +
        (store.hasFailed() ? " · <span style=\"color:#e74c3c\">sunucuya ulaşılamadı</span>" : ""));
    },

    /** Komutun tamamı (salt okunur, kopyalanabilir). */
    __showCommand(key) {
      const conn = ankamon.ui.ssh.ActivityStore.getInstance().getConnections().find(c => c.key === key);
      if (!conn) {
        return;
      }
      const store = ankamon.ui.ssh.ActivityStore.getInstance();
      const name = store.nameOf(conn.target);
      const win = ankamon.ui.Dialog.window(`SSH komutu — ${name || conn.target}`, 760, { maximizable: true });
      win.set({ height: 460, resizable: true });
      const area = new qx.ui.form.TextArea(conn.cmd || "(komut yok — etkileşimli/tünel bağlantısı)").set({
        readOnly: true, font: "app-mono", wrap: false
      });
      win.add(new qx.ui.basic.Label(
        `${qx.bom.String.escape(conn.target)}${conn.port ? ":" + conn.port : ""} · ` +
        `${qx.bom.String.escape(ankamon.ui.ssh.ActivityWindow.SOURCES[conn.src] || conn.src)} · ` +
        `${new Date(conn.start * 1000).toLocaleString("tr-TR")}` +
        (conn.tunnel ? ` · tünel → ${qx.bom.String.escape(conn.tunnel)}` : "")
      ).set({ rich: true, textColor: "app-muted" }));
      win.add(area, { flex: 1 });
      const copy = new qx.ui.form.Button("Kopyala");
      copy.addListener("execute", () => ankamon.util.Clipboard.copy(conn.cmd || ""));
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [copy, close]);
      win.open();
    }
  }
});
