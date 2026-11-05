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
 * Anomaliler ▸ Tarama: seçilen tahtalarda seçilen anomaliler o an yoklanır ("anomaly_scan" görevi — bkz.
 * worker/ankamon/anomaly/scan.py). Sürekli izlemeden (Anlık/Geçmiş) bağımsız bir anlık görüntüdür;
 * kayıt tutulmaz, son taramanın sonucu sekme yeniden açılınca gösterilir.
 *
 * Sol: tahta listesi (onay kutulu; arama, Tümü / Çevrim içi / Hiçbiri). Sağ üst: taranabilir anomali türleri.
 * Sağ alt: sonuç tablosu (tahta × anomali; Var / Yok / Taranamadı), "Yalnız bulunanlar" süzgeci (varsayılan
 * işaretli); çift tık → o tahtanın Geçmiş'i. Bölümler arasında iki ayırıcı (1 | 2, 2 / 3). Son seçimler (tahtalar,
 * türler) ve ayırıcı konumları kullanıcı başına sunucuda hatırlanır.
 */
qx.Class.define("ankamon.ui.anomaly.Scan", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Anomalies} */
  construct(page) {
    super("Tarama");
    this.__page = page;
    this.setLayout(new qx.ui.layout.Grow());
    this.setPadding(8);
    const prefs = page._user.ui_prefs || {};
    this.__checked = new Set(prefs["anomalies.scan.boards"] || []);
    this.__hasBoardPref = Array.isArray(prefs["anomalies.scan.boards"]);
    this.__kindPref = prefs["anomalies.scan.kinds"] || null;

    // İki ayırıcı: 1 | (2 / 3). Konumları kullanıcı başına sunucuda (ui_prefs["anomalies.scan.split"] = {left, top}).
    // Ayırıcı bırakılınca SplitPane sabit boyutlu ilk bölmeye setWidth/setHeight çağırır → change olayı kaydeder
    // (pencere daralınca yalnız yerleşim küçülür, özellik değişmez: kaydedilmez — bkz. ui.Shell nav.width).
    const saved = prefs["anomalies.scan.split"] || {};
    const split = new qx.ui.splitpane.Pane("horizontal");
    this.__mainSplit = split;
    this.add(split);
    const boards = this.__createBoardsPane().set({ width: saved.left || null });
    if (!saved.left) {
      // İlk açılış: eskisi gibi 2/5 genişlik (kullanıcı sürüklemediği için kaydedilmez).
      this.__splitDefaulting = true;
      split.addListenerOnce("resize", e => {
        boards.setWidth(Math.round(e.getData().width * 0.4));
        this.__splitDefaulting = false;
      });
    }
    split.add(boards, 0);
    split.add(this.__createRightPane(saved.top || null), 1);
    boards.addListener("changeWidth", e => this.__saveSplit("left", e.getData()));

    // Sekme ilk kez açılınca tahtalar yüklenir (sayfa 30 sn'de bir yenilense de liste yalnız açıkken tazelenir).
    this.addListener("appear", () => this.__loadBoards());
  },

  statics: {
    POLL_MS: 1000
  },

  members: {
    __page: null,
    __mainSplit: null,
    __checked: null,
    __hasBoardPref: false,
    __kindPref: null,
    __boards: null,
    __boardTable: null,
    __search: null,
    __selCount: null,
    __kindBox: null,
    __kindChecks: null,
    __kinds: null,
    __scanButton: null,
    __progress: null,
    __status: null,
    __onlyFound: null,
    __resultTable: null,
    __job: null,
    __jobId: null,
    __lastJobShown: null,

    // Adımlar "Dosyaları dağıt"taki numaralı kutularla aynı görünümde (bkz. ui.StepBox).
    __createBoardsPane() {
      const box = ankamon.ui.StepBox.create(1, "Tahtaları seç").set({ marginRight: 5 });
      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(4).set({ alignY: "middle" }));
      this.__search = new qx.ui.form.TextField().set({ placeholder: "Ara: ad, konum, IP…", liveUpdate: true });
      this.__search.addListener("changeValue", () => this.__renderBoards());
      bar.add(this.__search, { flex: 1 });
      [["Tümü", "Listede görünen tüm tahtaları seç", b => true],
        ["Çevrim içi", "Listede görünen çevrim içi tahtaları seç (diğerlerinin seçimi kalkar)", b => b.online],
        ["Hiçbiri", "Listede görünen tahtaların seçimini kaldır", b => false]].forEach(([label, tip, pick]) => {
        const button = new qx.ui.form.Button(label).set({ toolTipText: tip });
        button.addListener("execute", () => this.__pickVisible(pick));
        bar.add(button);
      });
      box.add(bar);

      const columns = [
        { id: "name", label: "Tahta", width: 180 },
        { id: "location", label: "Konum", width: 120 },
        { id: "status", label: "Durum", width: 100 },
        { id: "ip", label: "IP" }
      ];
      this.__boardTable = this.__page._createTable(columns, { checkable: true, prefsKey: "anomalies.scan.boards.columns" });
      this.__boardTable.getTableColumnModel().setDataCellRenderer(4, new ankamon.ui.table.StatusRenderer());
      // İşaret değişince seçim kümesi güncellenir (arama süzgeci gizlenen satırların seçimini korur).
      this.__boardTable.getTableModel().addListener("dataChanged", () => this.__syncChecked());
      box.add(this.__boardTable, { flex: 1 });
      this.__selCount = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
      box.add(this.__selCount);
      return box;
    },

    /** Ayırıcı konumunu kaydeder; sürükleme sırasında art arda gelen değişiklikler tek istekte toplanır. */
    __saveSplit(key, value) {
      if (!value || this.__splitDefaulting) {
        return;
      }
      const user = this.__page._user;
      const current = Object.assign({}, (user.ui_prefs || {})["anomalies.scan.split"] || {}, { [key]: value });
      clearTimeout(this.__splitTimer);
      this.__splitTimer = setTimeout(() => ankamon.page.Base.savePref(user, "anomalies.scan.split", current), 300);
    },

    __splitTimer: null,
    __splitDefaulting: false,

    /**
     * Kaydırma çubuğu 1/2 ayırıcısıyla aynı görünür (kalınlık ve zemin rengi o ayırıcıdan okunur — her temada eşleşir).
     * @param scroll {qx.ui.container.Scroll}
     */
    __matchScrollbar(scroll) {
      const splitter = this.__mainSplit.getChildControl("splitter");
      const width = (splitter.getBounds() || {}).width || splitter.getSizeHint().width;
      const bar = scroll.getChildControl("scrollbar-y");
      bar.set({ width, minWidth: width, maxWidth: width });
      const color = splitter.getBackgroundColor();
      if (color) {
        bar.setBackgroundColor(color);
      }
    },

    /** @param top {Integer?} 2. bölmenin kayıtlı yüksekliği (yoksa içeriğin doğal yüksekliği) */
    __createRightPane(top) {
      // 2 ile 3 arasında yatay ayırıcı (1 ile 2/3 arasındaki gibi).
      const pane = new qx.ui.splitpane.Pane("vertical").set({ marginLeft: 5 });
      const box = ankamon.ui.StepBox.create(2, "Anomalileri seç ve tara", "seçili tahtalarda şu an yoklanır").set({
        height: top, marginBottom: 5
      });
      pane.add(box, 0);
      box.addListener("changeHeight", e => this.__saveSplit("top", e.getData()));
      this.__kindBox = new qx.ui.container.Composite(new qx.ui.layout.VBox(2));
      // Tür listesi kaydırmalı: 2. bölgenin en küçük yüksekliği artık listeye bağlı değil, 2/3 ayırıcısı serbestçe
      // yukarı çekilebilir (eskiden ~670 px'in altına inmiyordu); liste sığmazsa dikey kaydırma çubuğu çıkar.
      const kindScroll = new qx.ui.container.Scroll(this.__kindBox).set({ minHeight: 40 });
      kindScroll.addListenerOnce("appear", () => this.__matchScrollbar(kindScroll));
      box.add(kindScroll, { flex: 1 });

      const run = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" })).set({ marginTop: 4 });
      this.__scanButton = new qx.ui.form.Button("Tara").set({ minWidth: 90 });
      this.__scanButton.addListener("execute", () => this.__start());
      run.add(this.__scanButton);
      this.__progress = new qx.ui.indicator.ProgressBar(0, 1).set({ width: 180, height: 14, visibility: "excluded" });
      run.add(this.__progress);
      this.__status = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true });
      run.add(this.__status, { flex: 1 });
      box.add(run);

      const results = ankamon.ui.StepBox.create(3, "Sonuçlar").set({ marginTop: 5 });
      pane.add(results, 1);
      const head = results.getChildren()[0]; // başlık satırı: sağına süzgeç onay kutusu
      head.add(new qx.ui.core.Spacer(), { flex: 1 });
      // Varsayılan işaretli (kullanıcı isteği): önce bulunanlar görünür.
      this.__onlyFound = new qx.ui.form.CheckBox("Yalnız anomali bulunanlar").set({ value: true });
      this.__onlyFound.addListener("changeValue", () => this.__renderResults());
      head.add(this.__onlyFound);

      const columns = [
        { id: "board", label: "Tahta", width: 180 },
        { id: "kind", label: "Anomali", width: 140 },
        { id: "result", label: "Sonuç", width: 110 },
        { id: "detail", label: "Ayrıntı" }
      ];
      this.__resultTable = this.__page._createTable(columns, { prefsKey: "anomalies.scan.results.columns" });
      this.__resultTable.getTableColumnModel().setDataCellRenderer(3, new qx.ui.table.cellrenderer.Html());
      this.__resultTable.addListener("cellDbltap", e => {
        const board = this.__resultTable.getTableModel().getValue(1, e.getRow());
        if (board) {
          this.__page.showBoard(board);
        }
      });
      this.__resultTable.setToolTipText("Çift tıklayın: o tahtanın anomali kayıtları (Geçmiş)");
      results.add(this.__resultTable, { flex: 1 });
      return pane;
    },

    /**
     * Sayfanın verisiyle (30 sn'de bir) çağrılır: tür listesi ilk seferde kurulur; kullanıcının son taraması
     * varsa ve henüz gösterilmediyse sonuçları yüklenir.
     */
    setKinds(kinds, lastJobId) {
      const scannable = Object.keys(kinds).filter(k => kinds[k].scan);
      if (!this.__kinds || this.__kinds.join() !== scannable.join()) {
        this.__kinds = scannable;
        this.__kindBox.removeAll();
        this.__kindChecks = {};
        const esc = qx.bom.String.escape;
        scannable.forEach(kind => {
          const check = new qx.ui.form.CheckBox(kinds[kind].label).set({
            value: this.__kindPref ? this.__kindPref.includes(kind) : true
          });
          check.addListener("changeValue", () => this.__updateButton());
          this.__kindChecks[kind] = check;
          this.__kindBox.add(check);
          this.__kindBox.add(new qx.ui.basic.Label(esc(kinds[kind].description)).set({
            rich: true, wrap: true, allowGrowX: true, textColor: "app-muted", marginLeft: 22, marginBottom: 4
          }));
        });
        this.__kindLabels = Object.fromEntries(scannable.map(k => [k, kinds[k].label]));
        this.__updateButton();
      }
      if (lastJobId && !this.__jobId && this.__lastJobShown !== lastJobId) {
        this.__lastJobShown = lastJobId;
        this.__follow(lastJobId);
      }
    },

    __kindLabels: null,

    async __loadBoards() {
      let data;
      try {
        data = await ankamon.io.Api.get("/boards");
      } catch (e) {
        this.__selCount.setValue("Tahtalar alınamadı: " + (e.message || e));
        return;
      }
      if (this.isDisposed()) {
        return;
      }
      this.__boards = data.boards.map(b => ({
        id: b.id,
        name: b.label || b.hostname || b.ip || ("#" + b.id),
        location: b.location || "",
        ip: b.ip || "",
        online: !!b.online
      }));
      // İlk kullanımda (kayıtlı seçim yok) çevrim içi tahtalar seçili gelir.
      if (!this.__hasBoardPref && !this.__checked.size) {
        this.__boards.filter(b => b.online).forEach(b => this.__checked.add(b.id));
      }
      const ids = new Set(this.__boards.map(b => b.id));
      [...this.__checked].filter(id => !ids.has(id)).forEach(id => this.__checked.delete(id)); // silinmiş tahtalar
      this.__renderBoards();
    },

    __visibleBoards() {
      const q = (this.__search.getValue() || "").trim().toLocaleLowerCase("tr");
      return (this.__boards || []).filter(b => !q ||
        [b.name, b.location, b.ip].some(v => v.toLocaleLowerCase("tr").includes(q)));
    },

    __renderBoards() {
      this.__rendering = true;
      this.__boardTable.getTableModel().setData(this.__visibleBoards().map(b =>
        [b.id, this.__checked.has(b.id), b.name, b.location, b.online ? "Çevrim içi" : "Çevrim dışı", b.ip]));
      this.__rendering = false;
      this.__updateButton();
    },

    __rendering: false,

    /** Tablodaki işaretler → seçim kümesi (yalnız görünen satırlar; süzgeçle gizlenenler korunur). */
    __syncChecked() {
      if (this.__rendering) {
        return;
      }
      const tm = this.__boardTable.getTableModel();
      for (let row = 0; row < tm.getRowCount(); row++) {
        const id = tm.getValue(0, row);
        if (tm.getValue(1, row)) {
          this.__checked.add(id);
        } else {
          this.__checked.delete(id);
        }
      }
      this.__updateButton();
    },

    __pickVisible(pick) {
      this.__visibleBoards().forEach(b => (pick(b) ? this.__checked.add(b.id) : this.__checked.delete(b.id)));
      this.__renderBoards();
    },

    __selectedKinds() {
      return (this.__kinds || []).filter(k => this.__kindChecks[k].getValue());
    },

    __updateButton() {
      const boards = (this.__boards || []).filter(b => this.__checked.has(b.id));
      const offline = boards.filter(b => !b.online).length;
      this.__selCount.setValue(`${boards.length} tahta seçili` +
        (offline ? ` (${offline} tanesi çevrim dışı — taranamaz)` : ""));
      const kinds = this.__selectedKinds().length;
      const running = this.__job && ["queued", "running"].includes(this.__job.status);
      this.__scanButton.set({
        enabled: !running && boards.length > 0 && kinds > 0,
        label: running ? "Taranıyor…" : (boards.length && kinds ? `Tara (${boards.length} tahta, ${kinds} anomali)` : "Tara")
      });
    },

    async __start() {
      const ids = [...this.__checked];
      const kinds = this.__selectedKinds();
      const S = ankamon.page.Base;
      S.savePref(this.__page._user, "anomalies.scan.boards", ids);
      S.savePref(this.__page._user, "anomalies.scan.kinds", kinds);
      this.__hasBoardPref = true;
      let res;
      try {
        res = await ankamon.io.Api.post("/jobs", { type: "anomaly_scan", board_ids: ids, kinds });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      this.__lastJobShown = res.id;
      this.__follow(res.id);
    },

    async __follow(jobId) {
      this.__jobId = jobId;
      let res;
      try {
        res = await ankamon.io.Api.get(`/jobs/${jobId}`);
      } catch (e) {
        this.__jobId = null;
        this.__status.setValue("Tarama sonucu alınamadı: " + qx.bom.String.escape(e.message || String(e)));
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
      this.__renderResults();
      this.__updateButton();
      if (running) {
        qx.event.Timer.once(() => this.__follow(jobId), this, ankamon.ui.anomaly.Scan.POLL_MS);
      } else {
        this.__jobId = null;
      }
    },

    /** Görevin tahta sonuçları → satırlar [{board, kind, state: found|clear|unknown, text}]. */
    __resultRows() {
      const job = this.__job;
      if (!job) {
        return [];
      }
      const kinds = (job.params && job.params.kinds) || [];
      const rows = [];
      job.targets.forEach(t => {
        let parsed = null;
        if (t.status === "ok") {
          try {
            parsed = JSON.parse(t.output).results;
          } catch (e) {
            parsed = null;
          }
        }
        kinds.forEach(kind => {
          const r = parsed && parsed[kind];
          let state = "unknown";
          let text;
          if (["queued", "running"].includes(t.status)) {
            state = "pending";
            text = t.status === "queued" ? "Sırada" : "Taranıyor…";
          } else if (r) {
            state = r.anomaly === true ? "found" : (r.anomaly === false ? "clear" : "unknown");
            text = r.summary;
          } else {
            text = t.status === "unreachable" ? "Tahtaya ulaşılamadı (kapalı olabilir): " + (t.output || "") : (t.output || "Taranamadı");
          }
          rows.push({ id: t.board_id + ":" + kind, board: t.board, kind, state, text, running: t.status === "running" });
        });
      });
      return rows;
    },

    __renderResults() {
      const all = this.__resultRows();
      const job = this.__job;
      const S = ankamon.ui.table.StatusRenderer;
      const red = S.colorOf("Çevrim dışı");
      const green = S.colorOf("Çevrim içi");
      const label = { found: ["Var", red], clear: ["Yok", green], unknown: ["Taranamadı", null], pending: ["…", null] };
      const order = { found: 0, unknown: 1, pending: 2, clear: 3 };
      const rows = all.filter(r => !this.__onlyFound.getValue() || r.state === "found")
        .sort((a, b) => order[a.state] - order[b.state] || a.board.localeCompare(b.board, "tr"));
      const esc = qx.bom.String.escape;
      this.__resultTable.getTableModel().setData(rows.map(r => {
        const [text, color] = label[r.state];
        return [r.id, r.board, (this.__kindLabels || {})[r.kind] || r.kind,
          r.running ? ankamon.ui.JobSpinner.label("Taranıyor") : (color ? S.html(text, color) : text), r.text || ""];
      }));
      if (!job) {
        this.__status.setValue("Tahtaları ve anomalileri seçip Tara'ya basın.");
        return;
      }
      const boards = job.targets.length;
      const pending = job.targets.filter(t => ["queued", "running"].includes(t.status)).length;
      const foundBoards = new Set(all.filter(r => r.state === "found").map(r => r.board)).size;
      const found = all.filter(r => r.state === "found").length;
      const unreachable = job.targets.filter(t => !["queued", "running", "ok"].includes(t.status)).length;
      const when = ankamon.util.Format.dateTime((job.finished_at || job.created_at) * 1000);
      let html = pending ? ankamon.ui.JobSpinner.label(`Taranıyor: ${boards - pending} / ${boards} tahta tamamlandı…`)
        : `<span style="font-weight:bold;color:${found ? red : green}">` +
          (found ? `${foundBoards} tahtada ${found} anomali bulundu` : "Anomali bulunmadı") + "</span>";
      html += ` <span style="opacity:.75">· ${boards} tahta` + (unreachable ? `, ${unreachable} tanesine ulaşılamadı` : "") +
        (pending ? "" : ` · ${esc(String(when))}`) + "</span>";
      this.__status.setValue(html);
    }
  }
});
