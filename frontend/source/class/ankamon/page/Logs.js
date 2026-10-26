/**
 * Loglar: iki tür — "Sistem logları" (ham syslog, /api/logs) ve "Komut logları"
 * (tahtalarda çalıştırılan komutlar, /api/command-logs — ankamon'dan gidenler ve tahtadaki kullanıcıların
 * kendi sudo/pkexec/su komutları, kaynak "local"; "Kullanıcı" orada tahtadaki hesaptır). Tür sayfadaki sekmelerden
 * ya da sol ağaçtaki Loglar alt seçeneklerinden seçilir (ikisi eşzamanlı; bkz. KINDS, setMode).
 *
 * Sayfalı: altta sayfa boyutu + önceki/sonraki (sunucuda offset/limit; toplam yalnız ilk sayfada
 * sayılır — bkz. LogsApi COUNT_CAP). Satırlar çoklu seçilebilir; sağ menü/Ctrl+C seçili satırların
 * yalnız mesaj (komut loglarında komut) metnini panoya kopyalar — bkz. __copySelected.
 *
 * Önemsiz mesajlar sağ menüden "dışlanabilir" (sistem loglarında): uyan kayıtlar grid'de herkes için
 * gizlenir, silinmez — bkz. __exclude, __openExclusions ve backend LogExclusionsApi.
 */
qx.Class.define("ankamon.page.Logs", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, "Loglar");
    this.__title = this._toolbar.getChildren()[0];
    // "Disk kullanımı" düğmesi burada DEĞİL, __build()'in kurduğu süzgeç satırında (Ara'nın sağında,
    // en sağa yaslı) — bkz. __build().
    this.__body = new qx.ui.container.Composite(new qx.ui.layout.VBox(10));
    // Tür sekmeleri (kullanıcı isteği): Sistem logları / Komut logları. Sol ağaçta Loglar'ın alt seçenekleri
    // de bu sekmelerdir (bkz. ui.Shell PAGES tabs, Base.selectTab/_rememberTab); gövde seçili sekmenin içinde.
    this.__tabs = new qx.ui.tabview.TabView();
    ankamon.page.Logs.KINDS.forEach(([key, label]) => {
      const tab = new qx.ui.tabview.Page(label);
      tab.setLayout(new qx.ui.layout.VBox());
      tab.setUserData("key", key);
      this.__tabs.add(tab);
    });
    this.add(this.__tabs, { flex: 1 });
    this._rememberTab(this.__tabs, "logs"); // son seçili tür (dinleyiciden önce: geri yükleme onu tetiklemesin)
    this.__mode = this.currentTab() || "system";
    this.__placeBody();
    this.__tabs.addListener("changeSelection", () => {
      this.__placeBody();
      this.__applyMode(this.currentTab());
    });
    this.__pageSize = ankamon.page.Logs.PAGE_SIZES.includes(this.__loadPageSize()) ? this.__loadPageSize() : 500;
    this.__build();
  },

  statics: {
    PAGE_SIZES: [100, 200, 500, 1000],
    // Tür sekmeleri: [anahtar (= mod, sol ağaç yaprağının "tab"ı — bkz. ui.Shell LOG_KINDS), etiket]
    KINDS: [["system", "Sistem logları"], ["command", "Komut logları"]]
  },

  members: {
    __title: null,
    __body: null,
    __tabs: null,
    __mode: null,
    __board: null,
    __range: null,
    __query: null,
    __extra: null,
    __table: null,
    __status: null,
    __boardItems: null,
    __hostLabel: null,
    __pendingBoardId: null,
    __boardFilled: false,
    __seq: 0,
    __records: null,
    __page: 0,
    __pageSize: 500,
    __total: null,
    __totalCapped: false,
    __more: false,
    __firstButton: null,
    __prevButton: null,
    __nextButton: null,
    __pageLabel: null,
    __frequent: null,
    __raw: null,
    __exclusionsButton: null,
    __exclusions: 0,

    /** Log türünü uygular (sol ağaç, durum çubuğu); ilgili tür sekmesi de seçilir. */
    setMode(mode) {
      this.__applyMode(mode);
      this.selectTab(mode); // sekme dinleyicisinin __applyMode'u aynı tür olduğundan yeniden yüklemez
    },

    __applyMode(mode) {
      if (mode && mode !== this.__mode) {
        this.__mode = mode;
        this.__build();
        this.refresh();
      }
    },

    /** Gövdeyi (süzgeç satırı + tablo) seçili tür sekmesinin içine taşır. */
    __placeBody() {
      const tab = this.__tabs.getSelection()[0];
      const parent = this.__body.getLayoutParent();
      if (tab && parent !== tab) {
        if (parent) {
          parent.remove(this.__body);
        }
        tab.add(this.__body, { flex: 1 });
      }
    },

    /**
     * Boards grid'inin satır menüsündeki "Logları göster" ve Genel bakış'taki hata/görev satırlarının
     * sağ menüsü buradan çağrılır (bkz. ui.Shell OPEN_LOGS): Sistem logları moduna geçer ve tahta
     * süzgecini bu tahtaya ayarlar. Süzgeç kutusu tahta listesini _refresh()'in başındaki
     * __loadBoardFilter() ile (yeniden) doldurduğundan, seçim de oradan hemen sonra (API
     * isteklerinden ÖNCE) uygulanır — bkz. __pendingBoardId.
     * @param severity {String?} verilirse önem süzgeci de ("3" = Hata ve üstü) ayarlanır
     */
    setBoardFilter(boardId, severity) {
      this.__mode = "system";
      this.__build();
      this.selectTab("system"); // tür sekmesi de (aynı tür: dinleyici yeniden yüklemez)
      this.__pendingBoardId = boardId;
      if (severity !== undefined && severity !== null) {
        const item = this.__extra.getSelectables().find(it => it.getModel() === String(severity));
        if (item) {
          this.__extra.setSelection([item]);
        }
      }
      this.refresh();
    },

    /** Ara / Enter: süzgeç değişmiş olabilir — ilk sayfadan, toplamı yeniden sayarak başlar. */
    __search() {
      this.__page = 0;
      this.__total = null;
      this.refresh();
    },

    __loadPageSize() {
      try {
        return parseInt(localStorage.getItem("ankamon.logs.pageSize"), 10) || 500;
      } catch (e) {
        return 500;
      }
    },

    __select(options, width) {
      const box = new qx.ui.form.SelectBox().set({ width: width || 170 });
      options.forEach(([value, label]) => box.add(new qx.ui.form.ListItem(label, null, value)));
      return box;
    },

    __value(box) {
      const item = box.getSelection()[0];
      return item ? item.getModel() : "";
    },

    /**
     * Ardışık, anahtarı birebir aynı kayıtları tek satıra indirger (ör. bir tahtanın aralıksız
     * ürettiği onlarca özdeş log satırı) — grid'de yer tasarrufu için. Sıra bozulmaz; yalnız
     * BİRBİRİNİ İZLEYEN aynı kayıtlar birleşir, araya farklı bir kayıt girerse yeni grup başlar.
     * @return {Array} [{record, count}] — count birden fazlaysa görüntüde "Nx " ön eki eklenir.
     */
    __collapseConsecutive(records, keyFn) {
      const out = [];
      for (const record of records) {
        const key = keyFn(record);
        const last = out[out.length - 1];
        if (last && last.key === key) {
          last.count++;
        } else {
          out.push({ key, count: 1, record });
        }
      }
      return out;
    },

    /** Seçili türe göre araç çubuğu + tabloyu kurar. */
    __build() {
      const command = this.__mode === "command";
      this.__title.setValue(command ? "Loglar — Komut logları" : "Loglar — Sistem logları");
      this.__body.removeAll().forEach(w => w.dispose());
      this.__boardItems = null;
      this.__boardFilled = false;
      this.__page = 0;
      this.__total = null;
      this.__raw = null; // önceki türün sayfası yeni sütunlarla çizilmesin

      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      this.__board = this.__select([["", "Tüm tahtalar"]]);
      this.__range = this.__select([["-1 hour", "Son 1 saat"], ["-24 hours", "Son 24 saat"], ["-7 days", "Son 7 gün"], ["-30 days", "Son 30 gün"]]);
      this.__range.setSelection([this.__range.getSelectables()[command ? 2 : 1]]);
      this.__query = new qx.ui.form.TextField().set({ placeholder: command ? "Komutta ara…" : "Mesajda ara…", width: 220 });
      this.__query.addListener("keypress", e => { if (e.getKeyIdentifier() === "Enter") { this.__search(); } });
      bar.add(this.__board);

      let columns;
      if (command) {
        this.__extra = this.__select([["", "Tüm kaynaklar"], ["action", "Hazır işlem"], ["command", "Serbest komut"], ["webshell", "Web terminal"], ["screen", "Ekran izleme / yönetim"],
          // Tahtadaki kullanıcının kendi çalıştırdığı sudo/pkexec/su (syslog'dan kopyalanır — bkz. db/migrations/028).
          ["local", "Tahtada yerel (sudo/pkexec/su)"]]);
        bar.add(this.__extra);
        columns = [
          { id: "time", label: "Zaman", width: 160 },
          { id: "board", label: "Takma ad", width: 150 },
          { id: "user", label: "Kullanıcı", width: 120 },
          { id: "source", label: "Kaynak", width: 110 },
          { id: "cmd", label: "Komut" },
          { id: "result", label: "Sonuç", width: 110 }
        ];
      } else {
        this.__extra = this.__select(
          [["", "Tüm önem dereceleri"]].concat(ankamon.util.Format.SEVERITIES.map((n, i) => [String(i), n + " ve üstü"]))
        );
        // Varsayılan: Hata (3) ve üstü — gürültüyü azaltmak için.
        const def = this.__extra.getSelectables().find(it => it.getModel() === "3");
        if (def) {
          this.__extra.setSelection([def]);
        }
        bar.add(this.__extra);
        columns = [
          { id: "time", label: "Zaman", width: 160 },
          { id: "label", label: "Takma ad", width: 150 },
          { id: "host", label: "Bilgisayar adı", width: 150 },
          { id: "severity", label: "Önem", width: 90 },
          { id: "program", label: "Program", width: 140 },
          { id: "message", label: "Mesaj" }
        ];
      }
      bar.add(this.__range);
      bar.add(this.__query);
      const search = new qx.ui.form.Button("Ara");
      search.addListener("execute", this.__search, this);
      bar.add(search);
      // İşaretliyse grid'de O AN gösterilen kayıtlar aynı mesaja göre gruplanır ve tekrar sayısına göre
      // büyükten küçüğe sıralanır (yeniden sorgu yok — bkz. __render). Varsayılan kapalı.
      this.__frequent = new qx.ui.form.CheckBox("En sık tekrarlananlar").set({
        value: false,
        toolTipText: "Ekrandaki kayıtları aynı mesaja göre gruplayıp en çok tekrarlanandan en aza sıralar"
      });
      this.__frequent.addListener("changeValue", this.__render, this);
      bar.add(this.__frequent);
      // Ara'nın sağında, satırın en sağına yaslı (kullanıcı isteği) — aradaki esnek boşluk iter.
      bar.add(new qx.ui.core.Spacer(), { flex: 1 });
      this.__exclusionsButton = null;
      if (!command) {
        // Sayı her yenilemede API'den güncellenir (bkz. __render) — grid'de gizli kayıt olduğu görünsün.
        this.__exclusionsButton = new qx.ui.form.Button("Dışlanan mesajlar").set({
          toolTipText: "Grid'de gizlenen (önemsiz sayılan) mesajları görüntüle ve dışlamayı kaldır"
        });
        this.__exclusionsButton.addListener("execute", () => this.__openExclusions());
        bar.add(this.__exclusionsButton);
      }
      if (this._can("logs.manage")) {
        const diskUsage = new qx.ui.form.Button("Disk kullanımı");
        diskUsage.addListener("execute", () => this.__openDiskUsage());
        bar.add(diskUsage);
      }
      this.__body.add(bar);

      this.__table = this._createTable(columns, { prefsKey: "logs.columns" });
      this.__setupCopy(this.__table);
      this.__body.add(this.__table, { flex: 1 });
      this.__body.add(this.__createPager());
    },

    /** Alt satır: durum metni (solda) + sayfa boyutu ve önceki/sonraki (sağda). */
    __createPager() {
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      this.__status = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
      row.add(this.__status);
      row.add(new qx.ui.core.Spacer(), { flex: 1 });
      row.add(new qx.ui.basic.Label("Sayfa başına:").set({ textColor: "app-muted" }));
      const size = this.__select(ankamon.page.Logs.PAGE_SIZES.map(n => [n, String(n)]), 80);
      size.setSelection([size.getSelectables().find(it => it.getModel() === this.__pageSize)]);
      size.addListener("changeSelection", () => {
        // Görünen ilk kaydın yeri korunur: yeni boyutta onu içeren sayfaya geçilir.
        const first = this.__page * this.__pageSize;
        this.__pageSize = this.__value(size);
        this.__page = Math.floor(first / this.__pageSize);
        try {
          localStorage.setItem("ankamon.logs.pageSize", String(this.__pageSize));
        } catch (e) {
          // kalıcılık kaybı önemsiz
        }
        this.refresh();
      });
      row.add(size);
      const first = new qx.ui.form.Button("«").set({ toolTipText: "İlk sayfa" });
      first.addListener("execute", () => { this.__page = 0; this.refresh(); });
      this.__prevButton = new qx.ui.form.Button("‹ Önceki");
      this.__prevButton.addListener("execute", () => { this.__page = Math.max(0, this.__page - 1); this.refresh(); });
      this.__pageLabel = new qx.ui.basic.Label("").set({ minWidth: 90, textAlign: "center" });
      this.__nextButton = new qx.ui.form.Button("Sonraki ›");
      this.__nextButton.addListener("execute", () => { this.__page++; this.refresh(); });
      this.__firstButton = first;
      [first, this.__prevButton, this.__pageLabel, this.__nextButton].forEach(w => row.add(w));
      return row;
    },

    __updatePager(count) {
      const from = this.__page * this.__pageSize;
      const pages = this.__total !== null ? Math.max(1, Math.ceil(this.__total / this.__pageSize)) : null;
      this.__pageLabel.setValue(`Sayfa ${this.__page + 1}` + (pages && !this.__totalCapped ? ` / ${pages}` : ""));
      this.__prevButton.setEnabled(this.__page > 0);
      this.__firstButton.setEnabled(this.__page > 0);
      this.__nextButton.setEnabled(this.__more);
      const n = v => Number(v).toLocaleString("tr-TR");
      const total = this.__total === null ? "" : ` / ${n(this.__total)}${this.__totalCapped ? "+" : ""}`;
      return count ? `${n(from + 1)}–${n(from + count)}${total} kayıt` : "";
    },

    /**
     * Çoklu satır seçimi + sağ menü "Kopyala" ve Ctrl+C: seçili satırların YALNIZ mesaj (komut
     * loglarında komut) metni, satır başına bir mesaj olarak panoya kopyalanır. Birleştirilmiş
     * ("N× ") satırlarda önek kopyalanmaz — kaynak kayıt __records'tan okunur.
     */
    __setupCopy(table) {
      table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
      table.addListener("cellContextmenu", e => {
        const row = e.getRow();
        if (row === null || row === undefined) {
          table.setContextMenu(null);
          return;
        }
        // Seçim dışındaki satıra sağ tıklanırsa seçim ona daralır; seçimin parçasıysa korunur.
        if (!table.getSelectionModel().isSelectedIndex(row)) {
          table.getSelectionModel().setSelectionInterval(row, row);
        }
        const count = this._selectedIds(table).length;
        const menu = new qx.ui.menu.Menu();
        const what = this.__mode === "command" ? "Komutu" : "Mesajı";
        const copy = new qx.ui.menu.Button(count > 1 ? `${what} kopyala (${count} satır)` : `${what} kopyala`);
        copy.addListener("execute", () => this.__copySelected());
        menu.add(copy);
        // Dışlama yalnız sağ tıklanan satırın mesajına uygulanır (çoklu seçimde de) — metin pencerede düzenlenir.
        const record = this.__records && this.__records[table.getTableModel().getValue(0, row)];
        if (this.__mode !== "command" && record && this._can("logs.exclude")) {
          menu.add(new qx.ui.menu.Separator());
          const exclude = new qx.ui.menu.Button("🚫 Bu mesajı bundan sonra dışla…");
          exclude.addListener("execute", () => this.__exclude(record));
          menu.add(exclude);
        }
        const old = table.getContextMenu();
        if (old) {
          qx.event.Timer.once(() => old.destroy(), null, 0);
        }
        table.setContextMenu(menu);
      });
      table.addListener("keydown", e => {
        if ((e.isCtrlPressed() || e.isMetaPressed()) && e.getKeyIdentifier() === "C") {
          e.preventDefault();
          this.__copySelected();
        }
      });
    },

    __copySelected() {
      const table = this.__table;
      const rows = [];
      table.getSelectionModel().iterateSelection(row => rows.push(row));
      const tm = table.getTableModel();
      const field = this.__mode === "command" ? "command" : "message";
      const text = rows
        .map(row => this.__records[tm.getValue(0, row)])
        .filter(Boolean)
        .map(r => r[field] ?? "")
        .join("\n");
      if (!rows.length) {
        return;
      }
      ankamon.util.Clipboard.copy(text).then(ok => {
        if (!ok) {
          ankamon.ui.Dialog.alert("Tarayıcı panoya yazmaya izin vermedi.", "Kopyalanamadı");
        }
      });
    },

    async __loadBoardFilter() {
      // Kutu __build başına bir kez doldurulur (sayfalama her yenilemede buradan geçer; eskiden
      // her yenileme listeyi yeniden ekleyip kopyalar biriktiriyordu).
      if (this.__boardFilled) {
        return;
      }
      this.__boardFilled = true;
      if (this.__boardItems) {
        this.__boardItems.forEach(b => this.__board.add(new qx.ui.form.ListItem(b.label || b.hostname || b.ip, null, String(b.id))));
        return;
      }
      if (!this._can("boards")) {
        this.__boardItems = [];
        return;
      }
      const select = this.__board;
      const data = await ankamon.io.Api.get("/boards");
      if (select !== this.__board) {
        return; // bu arada __build yeni kutu kurdu; onu kendi yenilemesi doldurur
      }
      this.__boardItems = data.boards;
      // host/IP → takma ad eşlemesi (sistem loglarında takma ad sütunu için). Takma ad yoksa Boards
      // grid'iyle aynı şekilde bilgisayar adına/IP'ye düşer; eşleme boş kalmaz.
      this.__hostLabel = {};
      data.boards.forEach(b => {
        const name = b.label || b.hostname || b.ip || "";
        if (name) {
          if (b.hostname) { this.__hostLabel[b.hostname.toLowerCase()] = name; }
          if (b.ip) { this.__hostLabel[b.ip] = name; }
        }
        this.__board.add(new qx.ui.form.ListItem(name, null, String(b.id)));
      });
    },

    async _refresh() {
      // Yalnız EN SON başlatılan yenileme tabloya yazar: Shell sayfayı açarken activate() bir
      // yenileme başlatır, hemen ardından setBoardFilter() __build + ikinci yenilemeyi; önceki
      // (süzgeçsiz) yanıt sonra gelirse yeni tabloyu ezmesin.
      const seq = ++this.__seq;
      await this.__loadBoardFilter();
      if (seq !== this.__seq) {
        return;
      }
      if (this.__pendingBoardId !== null) {
        const item = this.__board.getSelectables().find(it => it.getModel() === String(this.__pendingBoardId));
        if (item) {
          this.__board.setSelection([item]);
        }
        this.__pendingBoardId = null;
      }
      if (this.__mode === "command") {
        const data = await ankamon.io.Api.get("/command-logs", {
          board_id: this.__value(this.__board), source: this.__value(this.__extra),
          from: this.__value(this.__range), q: this.__query.getValue(), ...this.__pageParams()
        });
        if (seq !== this.__seq) {
          return;
        }
        this.__takePage(data);
        this.__raw = data.logs;
        this.__render();
      } else {
        const data = await ankamon.io.Api.get("/logs", {
          board_id: this.__value(this.__board), severity: this.__value(this.__extra),
          from: this.__value(this.__range), q: this.__query.getValue(), ...this.__pageParams()
        });
        if (seq !== this.__seq) {
          return;
        }
        this.__takePage(data);
        this.__raw = data.logs;
        this.__render();
      }
    },

    /**
     * Son çekilen sayfayı (__raw) tabloya yazar. Normalde ardışık aynı kayıtlar "N× " ile tek satıra
     * iner (__collapseConsecutive). "En sık tekrarlananlar" işaretliyse sayfadaki TÜM kayıtlar aynı
     * mesaja (sistem logu: program + mesaj; komut logu: komut) göre gruplanır — hangi tahtadan geldiğine
     * bakılmaz — ve tekrar sayısına göre büyükten küçüğe sıralanır (eşitlikte en son görülen önde).
     * Grup satırı: son görülme zamanı, tek tahtaysa onun adı yoksa "N tahta", en ağır önem derecesi.
     */
    __render() {
      const logs = this.__raw;
      if (!logs) {
        return;
      }
      const F = ankamon.util.Format;
      const command = this.__mode === "command";
      const frequent = this.__frequent.getValue();
      let groups;
      if (frequent) {
        const byKey = new Map();
        logs.forEach(r => {
          const key = command ? r.command : [r.program || "", r.message].join("\u0000");
          let g = byKey.get(key);
          if (!g) {
            g = { count: 0, record: r, boards: new Set(), hosts: new Set(), worst: r.severity };
            byKey.set(key, g);
          }
          g.count++;
          if (r.ts > g.record.ts) {
            g.record = r; // grubun temsilcisi: en son görülen kayıt
          }
          g.boards.add(command ? r.board_name : r.host);
          g.hosts.add(r.host);
          if (!command && r.severity !== null && r.severity < g.worst) {
            g.worst = r.severity;
          }
        });
        groups = [...byKey.values()].sort((a, b) => b.count - a.count || b.record.ts - a.record.ts);
      } else {
        groups = this.__collapseConsecutive(logs, command
          ? r => [r.board_name, r.username, r.source, r.command, r.status, r.exit_code].join("\u0000")
          : r => [r.host, r.severity, r.program, r.message].join("\u0000"));
      }
      this.__records = groups.map(g => g.record);
      const prefix = g => (g.count > 1 ? `${g.count}× ` : "");
      const several = g => frequent && g.boards.size > 1;
      if (command) {
        this.__table.getTableModel().setData(groups.map((g, i) => {
          const r = g.record;
          return [
            i, F.dateTime(r.ts), several(g) ? `${g.boards.size} tahta` : r.board_name, r.username, r.source,
            prefix(g) + r.command,
            r.status + (r.exit_code === null || r.exit_code === undefined ? "" : " (" + r.exit_code + ")")
          ];
        }));
      } else {
        const map = this.__hostLabel || {};
        this.__table.getTableModel().setData(groups.map((g, i) => {
          const r = g.record;
          return [
            i, F.dateTime(r.ts),
            several(g) ? `${g.boards.size} tahta` : (map[(r.host || "").toLowerCase()] || map[r.from_ip] || ""),
            several(g) ? [...g.hosts].join(", ") : r.host,
            F.severity(frequent ? g.worst : r.severity), r.program, prefix(g) + r.message
          ];
        }));
      }
      const range = this.__updatePager(logs.length);
      const what = command ? " komut kaydı" : " kayıt";
      let status = logs.length ? range.replace(" kayıt", what) : (command ? "Bu süzgece uyan komut kaydı yok." : "Bu süzgece uyan kayıt yok.");
      if (frequent && logs.length) {
        status += ` · bu sayfadaki ${groups.length} farklı ${command ? "komut" : "mesaj"}, en sık tekrarlanandan en aza`;
      }
      if (!command && this.__exclusions) {
        status += ` · ${this.__exclusions} dışlanan mesaj gizli`;
      }
      if (this.__exclusionsButton) {
        this.__exclusionsButton.setLabel(this.__exclusions ? `Dışlanan mesajlar (${this.__exclusions})` : "Dışlanan mesajlar");
      }
      this.__status.setValue(status);
    },

    /**
     * "Bu mesajı bundan sonra dışla…": metni (varsayılan: mesajın tamamı) ve isteğe bağlı program
     * kısıtını düzenletip, son 24 saatte kaç kaydı gizleyeceğini göstererek onay ister. Değişen kısımları
     * (PID, IP, port, saat…) silmek gerekir; aksi halde yalnız birebir aynı mesaj gizlenir. Uyan kayıtlar
     * grid'de HERKES için gizlenir, silinmez — "Dışlanan mesajlar" penceresinden geri alınabilir.
     */
    __exclude(record) {
      const esc = v => qx.bom.String.escape(String(v));
      const program = record.program || "";
      const win = ankamon.ui.Dialog.window("Mesajı dışla", 600);
      win.add(new qx.ui.basic.Label(
        "Bu metni <b>içeren</b> mesajlar Loglar grid'inde bundan sonra <b>tüm kullanıcılar için gizlenecek</b> " +
        "(önceki kayıtlar da dahil). Kayıtlar silinmez, disk kullanımı değişmez; dışlamayı " +
        "<b>Dışlanan mesajlar</b> penceresinden kaldırınca yeniden görünürler.<br><br>" +
        "⚠ Önemli bir hatayı gizlememek için metni mesajın <b>değişmeyen</b> kısmıyla sınırlayın " +
        "(süreç numarası, IP, port, saat gibi değişen kısımları silin); çok genel bir metin başka hataları da gizler."
      ).set({ rich: true, wrap: true }));
      const pattern = new qx.ui.form.TextArea(record.message || "").set({ height: 80, wrap: true });
      win.add(new qx.ui.basic.Label("Dışlanacak metin (büyük/küçük harf duyarlı):"));
      win.add(pattern);
      const onlyProgram = new qx.ui.form.CheckBox(`Yalnız "${program}" programından gelenler`).set({ value: true });
      if (program) {
        win.add(onlyProgram);
      }
      const preview = new qx.ui.basic.Label("").set({ rich: true, wrap: true });
      win.add(preview);
      const params = () => ({ pattern: (pattern.getValue() || "").trim(), program: program && onlyProgram.getValue() ? program : "" });
      let seq = 0;
      const update = async () => {
        const mine = ++seq;
        preview.set({ value: "Son 24 saatte kaç kaydı gizleyeceği hesaplanıyor…", textColor: "app-muted" });
        try {
          const data = await ankamon.io.Api.get("/log-exclusions/preview", params());
          if (mine !== seq) {
            return;
          }
          const n = v => Number(v).toLocaleString("tr-TR");
          const many = data.distinct_messages > 3;
          preview.set({
            value: `Son 24 saatte <b>${n(data.hits_24h)}</b> kayıt (${n(data.distinct_messages)} farklı mesaj) gizlenecek.` +
              (many ? " ⚠ Birden çok farklı mesaj etkileniyor — metnin fazla genel olmadığından emin olun." : ""),
            textColor: many ? "error" : "app-muted"
          });
        } catch (e) {
          if (mine === seq) {
            preview.set({ value: esc(e.message || e), textColor: "error" });
          }
        }
      };
      const timer = new qx.event.Timer(400);
      timer.addListener("interval", () => { timer.stop(); update(); });
      pattern.addListener("input", () => timer.restart());
      onlyProgram.addListener("changeValue", update);
      win.addListener("close", () => timer.dispose());
      const cancel = new qx.ui.form.Button("Vazgeç");
      cancel.addListener("execute", () => win.close());
      const ok = new qx.ui.form.Button("Dışla");
      ok.addListener("execute", async () => {
        try {
          await ankamon.io.Api.post("/log-exclusions", params());
          win.close();
          this.__search();
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
      });
      ankamon.ui.Dialog.buttons(win, [cancel, ok]);
      win.open();
      update();
    },

    /**
     * "Dışlanan mesajlar" penceresi: tüm dışlamalar, ekleyen, tarih ve son 24 saatte gizlediği kayıt
     * sayısı. 'logs.exclude' yetkisiyle seçilenler kaldırılabilir (uyan kayıtlar grid'de yeniden görünür).
     */
    __openExclusions() {
      const F = ankamon.util.Format;
      const canEdit = this._can("logs.exclude");
      const win = ankamon.ui.Dialog.window("Dışlanan mesajlar", 900, { maximizable: true });
      win.add(new qx.ui.basic.Label(
        "Bu metinleri içeren mesajlar Loglar grid'inde tüm kullanıcılar için gizleniyor; kayıtlar silinmiyor. " +
        "Bir dışlamayı kaldırınca ona uyan kayıtlar (geçmiştekiler dahil) yeniden görünür." +
        (canEdit ? "" : " Dışlama eklemek ya da kaldırmak için yöneticinin size bu yetkiyi vermesi gerekir.")
      ).set({ rich: true, wrap: true, textColor: "app-muted" }));
      const table = this._createTable([
        { id: "pattern", label: "Dışlanan metin" },
        { id: "program", label: "Program", width: 140 },
        { id: "hits", label: "Son 24 saat", width: 100 },
        { id: "by", label: "Ekleyen", width: 110 },
        { id: "at", label: "Eklenme", width: 150 }
      ], { prefsKey: "log-exclusions.columns" }).set({ height: 320 });
      table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
      win.add(table, { flex: 1 });
      const status = new qx.ui.basic.Label("Yükleniyor…").set({ textColor: "app-muted" });
      win.add(status);
      let changed = false;
      const load = async () => {
        try {
          const data = await ankamon.io.Api.get("/log-exclusions");
          table.getTableModel().setData(data.exclusions.map(x => [
            x.id, x.pattern, x.program === null ? "(tümü)" : (x.program || "(boş)"),
            Number(x.hits_24h).toLocaleString("tr-TR"), x.created_by, F.dateTime(x.created_ts)
          ]));
          status.setValue(data.exclusions.length ? `${data.exclusions.length} dışlama` : "Dışlanan mesaj yok.");
        } catch (e) {
          status.setValue(qx.bom.String.escape(e.message || String(e)));
        }
      };
      const buttons = [];
      if (canEdit) {
        const remove = new qx.ui.form.Button("Seçilenleri kaldır");
        remove.addListener("execute", async () => {
          const ids = this._selectedIds(table);
          if (!ids.length) {
            ankamon.ui.Dialog.alert("Önce kaldırılacak dışlamaları seçin.");
            return;
          }
          const sure = await ankamon.ui.Dialog.confirm(
            `Seçili <b>${ids.length}</b> dışlama kaldırılsın mı? Bunlara uyan kayıtlar Loglar grid'inde yeniden görünecek.`, "Kaldır");
          if (!sure) {
            return;
          }
          try {
            await ankamon.io.Api.del("/log-exclusions", { ids });
            changed = true;
            load();
          } catch (e) {
            ankamon.ui.Dialog.error(e);
          }
        });
        buttons.push(remove);
      }
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      buttons.push(close);
      ankamon.ui.Dialog.buttons(win, buttons);
      win.addListener("close", () => {
        if (changed) {
          this.__search();
        }
      });
      win.open();
      load();
    },

    /** O anki sayfanın API parametreleri; toplam yalnız henüz bilinmiyorsa sayılır (pahalı). */
    __pageParams() {
      const params = { limit: this.__pageSize, offset: this.__page * this.__pageSize };
      if (this.__total === null) {
        params.count = 1;
      }
      return params;
    },

    __takePage(data) {
      this.__more = !!data.more;
      this.__exclusions = data.exclusions || 0;
      if (data.total !== undefined) {
        this.__total = data.total;
        this.__totalCapped = !!data.total_capped;
      }
    },

    /**
     * Sistem ▸ Disk kullanımı sayfasını bu log türünün sekmesinde açar (bkz. page.DiskUsage). Yalnız
     * 'logs.manage' yetkisiyle görünen düğmeden (bkz. __build()).
     */
    __openDiskUsage() {
      qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_PAGE, { diskUsage: this.__mode });
    }
  }
});
