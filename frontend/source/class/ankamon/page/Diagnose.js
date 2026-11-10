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
 * Sağlık ▸ Denetle (kimlik "reports"; eski "Denetim raporları", "Bakım ▸ Bakım", "Sorun tespiti"; bkz. page.Anomalies): SSH denetimi
 * raporları. YALNIZ tespit raporu (kullanıcı isteği — Tahtalar grid'i, Ekranlar vb. yok).
 *
 * Taramalar "diagnose" görevleridir (bkz. worker/ankamon/executor/diagnose.py): "Şimdi tara" o an
 * çevrimiçi TÜM tahtaları paralel denetler (aynı anda kaç tahta: konteynerin CPU/RAM boşluğuna göre); ayrıca worker kaynaklar müsaitken her tahtayı haftada en az
 * bir kez kendiliğinden tarar (bkz. worker/ankamon/tasks/diagnose_schedule.py). Raporlar /api/diagnose'dan
 * gelir (bkz. backend DiagnoseApi); "Rapor" seçicisinden önceki taramalar da açılabilir.
 *
 * Açılışta "Son durum" görünür: her tahtanın EN SON denetimi tek tabloda (GET /api/diagnose/latest). Otomatik
 * zamanlayıcı yalnız vadesi gelen tahtaları taradığından tek bir otomatik tarama çoğu kez 1-2 tahtalıktır; açılışta
 * en son taramayı göstermek "yalnız bu tahta mı taranıyor?" karışıklığı yaratıyordu (kullanıcı geri bildirimi).
 * Tek tek taramalar seçicide kalır. Sayfanın ne yaptığı ve otomatik tarama takvimi "Bakım" sekme kulakçığının
 * ipucunda (bindTabButton), ayrıntısı Sağlık ▸ Yardım sekmesinde (bkz. page.MaintenanceHelp).
 *
 * Rapor bir grid'dir: her tahta bir satır (Tahta, IP, Genel durum, Acil, Dikkat, Bilgi, Başlıca bulgu, Denetim zamanı,
 * Başlatan). Sütunlar sıralanabilir ve başlıktaki kutuyla süzülür (serbest yazım + hazır değer listesi; Tahta, Genel durum,
 * Acil, Dikkat, Bilgi'de liste her zaman — kullanıcı isteği, eski "Tahta" seçicisinin yerine). Altta seçili tahtanın
 * bulguları ve önerileri (tahta seçilmeden boş, başlık satırı yok); ayırıcı Durum'daki gibi kalın. Düzeye göre süzme
 * grid'in Genel durum / Acil / Dikkat / Bilgi sütunlarında (üstteki eski "Göster" kutuları kalktı — kullanıcı isteği). Hepsi sunucuya gitmeden son rapor verisinden yeniden çizilir (bkz. __render / __apply).
 * Durum'daki SSH bulgusuna çift tık → showBoard(): "Son durum" + grid o tahtaya süzülür.
 */
qx.Class.define("ankamon.page.Diagnose", {
  extend: ankamon.page.Base,

  construct(user) {
    // Başlık yok; düğmeler, rapor seçici, başlatılma bilgisi ve ilerleme tek satırda (kullanıcı isteği).
    super(user, null);
    this._actions.exclude();
    const top = new qx.ui.container.Composite(new qx.ui.layout.HBox(10).set({ alignY: "middle" }));
    const button = (label, handler) => {
      const b = new qx.ui.form.Button(label);
      b.addListener("execute", handler);
      top.add(b);
      return b;
    };
    button("Yenile", () => this.refresh());
    if (this._can("diagnose")) {
      button("Şimdi tara", () => this.__start())
        .set({ toolTipText: "O an çevrimiçi olan tüm tahtaları denetler (sistem kaynaklarına göre birden çok tahta aynı anda)" });
    }
    top.add(new qx.ui.basic.Label("Rapor:").set({ marginLeft: 8 }));
    this.__runBox = new qx.ui.form.SelectBox().set({ width: 480 });
    // Seçili raporun yazısı (süren taramada dönen halka HTML'i) kutunun kendisinde de HTML çizilsin;
    // kip, etikete yazı konmadan verilmeli.
    this.__runBox.getChildControl("atom").setRich(true);
    this.__runBox.addListener("changeSelection", () => {
      const it = this.__runBox.getSelection()[0];
      if (it && !this.__silent) {
        this.__follow(it.getModel());
      }
    });
    top.add(this.__runBox);
    this.__started = new qx.ui.basic.Label("").set({ rich: true });
    top.add(this.__started);
    this.__progress = new qx.ui.indicator.ProgressBar(0, 1).set({ width: 220, height: 14, visibility: "excluded" });
    top.add(this.__progress);
    this.__status = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    top.add(this.__status, { flex: 1 });
    this.add(top);


    const split = new qx.ui.splitpane.Pane("vertical");
    const thick = ankamon.ui.health.Status.SPLITTER;
    split.getChildControl("splitter").set({ height: thick, minHeight: thick, maxHeight: thick });
    this.add(split, { flex: 1 });

    // Sayı sütunları (Acil/Dikkat/Bilgi) da hazır listeli: "kaç acil bulgusu olan tahtalar" seçilebilsin.
    this.__columns = [
      { id: "board", label: "Tahta", width: 180, choices: true },
      { id: "ip", label: "IP", width: 120, choices: false },
      { id: "state", label: "Genel durum", width: 130, choices: true },
      { id: "bad", label: "Acil", width: 75, choices: true },
      { id: "warn", label: "Dikkat", width: 75, choices: true },
      { id: "info", label: "Bilgi", width: 75, choices: true },
      { id: "top", label: "Başlıca bulgu", width: 420, choices: false },
      { id: "at", label: "Denetim zamanı", width: 150, choices: false },
      { id: "by", label: "Başlatan", width: 140 }
    ];
    this.__table = this._createTable(this.__columns, { prefsKey: "diagnose.report.columns", persistSort: true });
    this.__filters = this._addColumnFilters(this.__table, this.__columns, () => this.__apply(), { rows: () => this.__allRows || [], persist: true });
    const C = ankamon.page.Diagnose.COL;
    this.__table.getTableColumnModel().setDataCellRenderer(C.state, new ankamon.ui.table.DiagnoseStateRenderer());
    // Sıralama: Genel durum en kötüden, sayılar sayı olarak, zaman ham zamanla (satır sonundaki gizli değerler).
    const model = this.__table.getTableModel();
    const num = v => (typeof v === "number" ? v : -1);
    model.setSortMethods(C.state, (x, y) => x[C.rank] - y[C.rank]);
    [C.bad, C.warn, C.info].forEach(col => model.setSortMethods(col, (x, y) => num(x[col]) - num(y[col])));
    model.setSortMethods(C.at, (x, y) => (x[C.ts] || 0) - (y[C.ts] || 0));
    this.__table.getSelectionModel().addListener("changeSelection", () => {
      if (!this.__restoring) {
        this.__selKey = this.__selectedKey();
      }
      this.__renderDetail();
    });
    // Sütuna göre sıralanınca qx seçimi satır NUMARASIYLA tutar (vurgu başka tahtaya kayardı): seçili tahta yeniden bulunur.
    model.addListener("metaDataChanged", () => this.__reselect());
    this.__table.setToolTipText("Bir tahtayı seçin: aşağıda yalnız onun bulguları ve önerileri görünür");
    const top2 = new qx.ui.container.Composite(new qx.ui.layout.VBox(4)).set({ paddingBottom: ankamon.ui.health.Status.PANE_GAP });
    top2.add(this.__table, { flex: 1 });
    split.add(top2, 1);

    const bottom = new qx.ui.container.Composite(new qx.ui.layout.VBox(4)).set({ paddingTop: ankamon.ui.health.Status.PANE_GAP });
    this.__html = new qx.ui.embed.Html("").set({
      overflowX: "auto", overflowY: "auto", textColor: "text-primary-on-surface", backgroundColor: "surface",
      // "text" Tangible/Modern renk temalarında tanımlı değil (yazı siyah kalıyordu); bu ad tüm temalarda var.
      decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 4 })
    });
    bottom.add(this.__html, { flex: 1 });
    split.add(bottom, 1);
  },

  statics: {
    LEVEL: {
      bad: { text: "Acil", color: "#c5221f" },
      warn: { text: "Dikkat", color: "#e37400" },
      info: { text: "Bilgi", color: "#1a73e8" },
      ok: { text: "Sorun yok", color: "#1e8e3e" }
    },
    ORDER: ["bad", "warn", "info", "ok"],
    /** Tablo modeli sütunları (0 = tahta anahtarı); ts ve rank görünmeyen sıralama değerleri. */
    COL: { board: 1, ip: 2, state: 3, bad: 4, warn: 5, info: 6, top: 7, at: 8, by: 9, ts: 10, rank: 11 }
  },

  members: {
    __columns: null,
    __table: null,
    __filters: null,
    __allRows: null,
    __pendingBoard: null,
    __selKey: null,
    __restoring: false,
    __runBox: null,
    __progress: null,
    __status: null,
    __tabButton: null,
    __started: null,
    __html: null,
    __jobId: null,
    __job: null,
    __schedule: null,
    __silent: false,

    /** Sayfa her açıldığında: rapor listesi + en son rapor (ya da seçili olan). */
    async _refresh() {
      const data = await ankamon.io.Api.get("/diagnose");
      this.__schedule = data.schedule;
      this.__fillRuns(data.runs);
      const sel = this.__runBox.getSelection()[0];
      if (sel) {
        this.__follow(sel.getModel());
      } else {
        this.__job = null;
        this.__render();
      }
    },

    __fillRuns(runs) {
      const F = ankamon.util.Format;
      const esc = s => qx.bom.String.escape(String(s ?? ""));
      const keep = this.__jobId;
      this.__silent = true;
      this.__runBox.removeAll().forEach(it => it.dispose());
      // İlk seçenek ve varsayılan: her tahtanın en son denetimi (bkz. DiagnoseApi::latest).
      const latest = new qx.ui.form.ListItem("", null, "latest");
      latest.setRich(true);
      latest.setLabel("<b>Son durum — tüm tahtalar</b> (her tahtanın en son denetimi)");
      this.__runBox.add(latest);
      runs.forEach(r => {
        // Otomatik tarama yalnız vadesi gelen tahtaları kapsar; az tahtalıysa adları da yazılsın.
        const who = r.auto ? "otomatik" : "elle: " + esc(r.created_by || "—");
        const names = r.targets <= 3 && r.names ? ": " + esc(r.names) : "";
        const failed = r.failed ? ` · <span style="color:#c5221f">${r.failed} denetlenemedi</span>` : "";
        const state = ["queued", "running"].includes(r.status) ? " · " + ankamon.ui.JobSpinner.label("sürüyor") : "";
        // Aynı sonuçla art arda tekrarlanan başarısız otomatik taramalar tek seçenek (bkz. DiagnoseApi::collapseRepeats).
        const repeat = r.repeat > 1
          ? ` · <span style="opacity:.75">aynı sonuçla ${r.repeat} kez, ${F.dateTime(r.first_at * 1000)}'den beri</span>` : "";
        // rich, etiket oluşmadan verilmeli: qx yazısı konmuş etiketin kipini değiştirmez ("The label mode cannot be
        // modified after initial creation" — sayfa açılışını kırıyordu). Önce boş madde + rich, sonra yazı.
        const item = new qx.ui.form.ListItem("", null, r.id);
        item.setRich(true);
        item.setLabel(`${F.dateTime(r.created_at * 1000)} · ${who} · ${r.targets} tahta${names}${failed}${repeat}${state}`);
        this.__runBox.add(item);
      });
      const items = this.__runBox.getChildren();
      const pick = items.find(it => it.getModel() === keep) || items[0];
      if (pick) {
        this.__runBox.setSelection([pick]);
      }
      this.__silent = false;
    },

    async __start() {
      let res;
      try {
        res = await ankamon.io.Api.post("/jobs", { type: "diagnose", all_online: true });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      this.__jobId = res.id;
      this.refresh(); // listeye yeni taramayı al ve izle
    },

    async __follow(jobId) {
      this.__jobId = jobId;
      let res;
      try {
        res = await ankamon.io.Api.get(jobId === "latest" ? "/diagnose/latest" : `/diagnose/${jobId}`);
      } catch (e) {
        this.__status.setValue("Rapor alınamadı: " + qx.bom.String.escape(e.message || String(e)));
        return;
      }
      if (this.__jobId !== jobId || this.isDisposed()) {
        return;
      }
      this.__job = res.job;
      const targets = res.job.targets;
      const done = targets.filter(t => !["queued", "running"].includes(t.status)).length;
      const running = ["queued", "running"].includes(res.job.status);
      this.__progress.set({ maximum: Math.max(1, targets.length), value: done, visibility: running ? "visible" : "excluded" });
      this.__status.setValue(running ? ankamon.ui.JobSpinner.label(`Denetleniyor: ${done} / ${targets.length} tahta tamamlandı…`) : "");
      this.__render();
      if (running) {
        qx.event.Timer.once(() => this.__follow(jobId), this, 1000);
      } else if (this.__wasRunning === jobId) {
        this.__wasRunning = null;
        this.refresh(); // bitti: listedeki "sürüyor" etiketi ve takvim güncellensin
      }
      if (running) {
        this.__wasRunning = jobId;
      }
    },

    __wasRunning: null,

    /**
     * Rapor seçicinin sağı: denetimin nasıl başlatıldığı (tarih zaten seçicide yazıyor — kullanıcı
     * isteği: zaman/aralık tekrarlanmaz).
     */
    __startedHtml() {
      const j = this.__job;
      if (!j) {
        return "Henüz tarama yapılmadı.";
      }
      if (j.latest) {
        return `<span style="opacity:.8">${j.targets.length} / ${j.boards} tahtanın en son denetimi — ` +
          "tarihi her satırın sağında</span>";
      }
      return j.auto ? "Otomatik tarama (yalnız denetim zamanı gelen tahtalar)"
        : `Elle başlatan: <b>${qx.bom.String.escape(String(j.created_by || "—"))}</b>`;
    },

    /**
     * Denetim raporları sekme kulakçığı (bkz. page.Anomalies) bu sayfanın ne yaptığını ve otomatik tarama takvimini
     * ipucunda gösterir — sayfada yer kaplamasın (kullanıcı isteği). Takvim /api/diagnose'dan geldikçe tazelenir.
     */
    bindTabButton(button) {
      this.__tabButton = button;
      this.__updateTabHint();
    },

    __updateTabHint() {
      if (!this.__tabButton || this.__tabButton.isDisposed()) {
        return;
      }
      const F = ankamon.util.Format;
      const esc = s => qx.bom.String.escape(String(s ?? ""));
      const sc = this.__schedule;
      let s = "<b>SSH denetimi</b>: Ankamon tahtaya SSH ile girip donanım ve sistem sağlığını ölçer: disk (SMART) ve boş alan, " +
        "işlemci ve kasa sıcaklığı, fan, RAM, güncellemeler, başarısız servisler… Her tahta bir " +
        "satırdır (sütunlar süzülür ve sıralanır); tahtayı seçince bulguları ve önerileri altta görünür. <b>Şimdi tara</b> açık tüm tahtaları hemen denetler " +
        "(seçili tahtalar: <b>Tara</b> sekmesi). BIOS pili ve saat sürekli izlemededir.";
      s += `<br><br><b>Otomatik tarama:</b> her tahta en az ${esc(sc ? sc.interval_days : 7)} günde bir, sunucu yükü ve ` +
        "ağ trafiği düşükken; tahta yalnız açıkken taranabilir. Her tahtanın zamanı ayrı işlediğinden otomatik " +
        "taramalar çoğu kez yalnız birkaç tahtayı kapsar.";
      if (sc && sc.never_scanned) {
        s += ` Hiç taranmamış ${sc.never_scanned} tahta ilk uygun anda taranacak.`;
      } else if (sc && sc.next_from) {
        s += ` Sıradaki: ${esc(F.dateTime(sc.next_from * 1000))} sonrasında uygun ilk an, en geç ${esc(F.dateTime(sc.next_by * 1000))}.`;
      }
      s += "<br><br>Ayrıntılar: <b>Yardım</b> sekmesi.";
      this.__tabButton.setToolTipText(`<div style="max-width:520px;white-space:normal">${s}</div>`);
    },

    /**
     * Durum'daki SSH bulgusundan gelince: "Son durum" raporu (Durum her tahtanın en son denetimini gösterir) ve grid o
     * tahtaya süzülür; satır gelince seçilir (bulguları altta açılsın).
     */
    showBoard(name) {
      this.__pendingBoard = name;
      const latest = this.__runBox.getChildren().find(it => it.getModel() === "latest");
      if (latest && this.__jobId !== "latest") {
        this.__runBox.setSelection([latest]);
      } else {
        this.__jobId = "latest";
      }
      this.__filters.board.setValue(`"${name}"`);
      this.__apply();
    },

    __parse(t) {
      if (t.status !== "ok") {
        return null;
      }
      try {
        return JSON.parse(t.output || "{}");
      } catch (e) {
        return null;
      }
    },

    __jobRunning() {
      return !!this.__job && ["queued", "running"].includes(this.__job.status);
    },

    /** Tahtanın bütün bulguları (düzey süzgeci grid sütunlarında). */
    __visibleChecks(t) {
      const r = this.__parse(t);
      return r ? r.checks : [];
    },

    /** Rapor verisinden grid satırları → __apply. */
    __render() {
      this.__started.setValue(this.__startedHtml());
      this.__updateTabHint();
      const targets = this.__job ? this.__job.targets : [];
      const F = ankamon.util.Format;
      const L = ankamon.page.Diagnose.LEVEL;
      const ORDER = ankamon.page.Diagnose.ORDER;
      const S = ankamon.ui.table.DiagnoseStateRenderer;
      // Yalnız görev SÜRERKEN "Denetleniyor/Sırada": görev bittiyse (ör. yürütücü yeniden başladı) hâlâ
      // queued/running duran satır yarıda kalmıştır — sonsuza dek "Denetleniyor…" görünmesin.
      const jobRunning = this.__jobRunning();
      this.__targets = new Map();
      const rows = [];
      targets.forEach(t => {
        const key = String(t.board_id ?? t.board);
        const r = this.__parse(t);
        const pending = jobRunning && ["queued", "running"].includes(t.status);
        const halted = !jobRunning && ["queued", "running"].includes(t.status);
        let state, rank, counts = [null, null, null], top = "";
        if (pending) {
          state = t.status === "running" ? S.RUNNING : S.QUEUED;
          rank = 9;
        } else if (halted) {
          state = S.HALTED;
          rank = 1.5;
          top = "Görev bu tahtada tamamlanamadan kesildi (ör. Ankamon yeniden başlatıldı); denetimi yeniden çalıştırın.";
        } else if (!r) {
          state = S.UNREACHABLE;
          rank = -1; // bağlanılamayanlar en üstte
          top = String(t.output || "").replace(/\s+/g, " ").trim();
        } else {
          state = L[r.level] ? L[r.level].text : r.level;
          rank = ORDER.indexOf(r.level);
          counts = ["bad", "warn", "info"].map(l => r.checks.filter(c => c.level === l).length);
          const worst = r.checks.find(c => c.level === r.level && r.level !== "ok");
          top = worst ? `${worst.title}: ${worst.detail}` : "";
        }
        const ts = (r && r.collected_at) || t.finished_at || null;
        const by = this.__job && this.__job.latest ? (t.run_auto ? "otomatik" : "elle: " + (t.run_by || "—"))
          : (this.__job.auto ? "otomatik" : "elle: " + (this.__job.created_by || "—"));
        this.__targets.set(key, t);
        rows.push([key, t.board, t.ip || "", state, ...counts, top, ts ? F.dateTime(ts * 1000) : "", by, ts, rank]);
      });
      const C = ankamon.page.Diagnose.COL;
      rows.sort((x, y) => x[C.rank] - y[C.rank] || String(x[C.board]).localeCompare(String(y[C.board]), "tr", { numeric: true }));
      this.__allRows = rows;
      this.__apply();
    },

    __targets: null,

    /** Sütun süzgeçleri → tablo (seçim korunur). */
    __apply() {
      if (!this.__allRows) {
        return;
      }
      const B = ankamon.page.Base;
      const selected = this.__pendingBoard === null ? this.__selKey : null;
      const filters = this.__columns.map((c, i) => ({ i: i + 1, text: (this.__filters[c.id].getValue() || "").trim() }))
        .filter(f => f.text);
      const shown = this.__allRows.filter(cells => filters.every(f => B.filterMatch(cells[f.i], f.text)));
      const tm = this.__table.getTableModel();
      tm.setData(shown);
      let index = -1;
      for (let row = 0; row < tm.getRowCount(); row++) {
        const data = tm.getRowData(row);
        if (this.__pendingBoard !== null ? data[1] === this.__pendingBoard : data[0] === selected) {
          index = row;
          break;
        }
      }
      // Bekleyen tahta "Son durum" geldiğinde bulunduysa ya da o raporda hiç yoksa bırakılır.
      if (this.__pendingBoard !== null && (index >= 0 || (this.__job && this.__job.latest))) {
        this.__pendingBoard = null;
      }
      const sm = this.__table.getSelectionModel();
      if (index >= 0) {
        sm.setSelectionInterval(index, index);
      } else {
        sm.resetSelection();
      }
      this.__renderDetail();
    },

    /** Sıralamadan sonra seçili tahtanın (__selKey) satırını yeniden seçer. */
    __reselect() {
      const tm = this.__table.getTableModel();
      const sm = this.__table.getSelectionModel();
      this.__restoring = true;
      try {
        let index = -1;
        for (let row = 0; this.__selKey !== null && row < tm.getRowCount(); row++) {
          if (tm.getValue(0, row) === this.__selKey) {
            index = row;
            break;
          }
        }
        if (index >= 0) {
          sm.setSelectionInterval(index, index);
        } else {
          sm.resetSelection();
        }
      } finally {
        this.__restoring = false;
      }
    },

    __selectedKey() {
      const sm = this.__table.getSelectionModel();
      if (sm.isSelectionEmpty()) {
        return null;
      }
      const row = this.__table.getTableModel().getRowData(sm.getLeadSelectionIndex());
      return row ? row[0] : null;
    },

    /** Alt bölme: seçili tahtanın bulguları ve önerileri; tahta seçilmeden boş (başlık satırı yok — kullanıcı isteği). */
    __renderDetail() {
      const esc = s => qx.bom.String.escape(String(s ?? ""));
      const L = ankamon.page.Diagnose.LEVEL;
      const badge = level => `<span style="display:inline-block;min-width:68px;padding:1px 8px;border-radius:10px;` +
        `background:${L[level].color};color:#fff;font-weight:600;text-align:center">${L[level].text}</span>`;
      const css = "font:13px/1.45 sans-serif;padding:8px 10px 16px";
      const th = "text-align:left;padding:4px 8px;border-bottom:2px solid rgba(128,128,128,.4);white-space:nowrap";
      const td = "padding:4px 8px;border-bottom:1px solid rgba(128,128,128,.25);vertical-align:top";
      const selected = this.__selectedKey();
      if (selected === null || !this.__targets || !this.__targets.has(selected)) {
        this.__html.setHtml("");
        return;
      }
      const keys = [selected];
      const many = false;
      let h = `<div style="${css}"><table style="border-collapse:collapse;width:100%"><tr>` +
        (many ? `<th style="${th}">Tahta</th>` : "") +
        `<th style="${th}">Düzey</th><th style="${th}">Denetim</th><th style="${th}">Bulgu</th><th style="${th}">Öneri</th></tr>`;
      let any = false;
      keys.forEach(key => {
        const t = this.__targets.get(key);
        if (!t) {
          return;
        }
        const boardCell = many ? `<td style="${td};font-weight:600;white-space:nowrap">${esc(t.board)}</td>` : "";
        if (!this.__parse(t)) {
          if (!["queued", "running"].includes(t.status)) {
            any = true;
            h += `<tr>${boardCell}<td style="${td}">${badge("bad")}</td><td style="${td}">Bağlantı</td>` +
              `<td style="${td}" colspan="2">${esc(t.output || "Denetlenemedi")}</td></tr>`;
          }
          return;
        }
        let lastGroup = null;
        this.__visibleChecks(t).forEach(c => {
          any = true;
          const group = c.group !== lastGroup ? `<div style="opacity:.65;font-size:12px">${esc(c.group)}</div>` : "";
          lastGroup = c.group;
          h += `<tr>${boardCell}<td style="${td}">${badge(c.level)}</td><td style="${td}">${group}${esc(c.title)}</td>` +
            `<td style="${td}">${esc(c.detail)}</td><td style="${td}">${esc(c.advice || "")}</td></tr>`;
        });
      });
      if (!any) {
        h += `<tr><td colspan="5" style="${td};opacity:.7">Bulgu yok.</td></tr>`;
      }
      this.__html.setHtml(h + "</table></div>");
    }
  }
});
