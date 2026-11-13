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
 * Sağlık ▸ Denetle (kullanıcı isteği 2026-11-12: eski "Denetle" ve "Tara" sekmeleri birleşti; kimlik "reports", eski "Tarama"
 * kimliği buraya yönlenir — bkz. page.Anomalies OLD_TABS). İki yol da buradan başlatılır ve sonuçları buradadır:
 *   - Sürekli izleme denetimlerinin anlık yoklaması ("anomaly_scan" görevi — bkz. worker/ankamon/anomaly/scan.py): kuralın
 *     cihazda çalışan küçük betiği SSH ile o an çalışır; kayıt tutulmaz.
 *   - Tam denetim ("diagnose" görevi — bkz. worker/ankamon/executor/diagnose.py; yalnız "diagnose" yetkisiyle): haftalık
 *     otomatik denetimin aynısı; seçili cihazlarda ② ile ya da açık tüm cihazlarda "Şimdi tara" ile. Durum'a yansır.
 * ②'de iki yolun ayrımı vurgulanmaz (kullanıcı isteği 2026-11-12) — her sonucun kaynağı ③'ün Kaynak sütununda.
 *
 * Yerleşim: üstte ① cihazlar (onay kutulu; arama, Tümü / Çevrim içi / Hiçbiri) | ② denetim türleri ve Tara; altta tam
 * genişlikte ③ Sonuçlar — TEK grid: tam denetim raporunun kontrolleri (gömülü page.Diagnose'un yalnız üst satırı: Yenile,
 * Şimdi tara, Rapor seçici), son anlık yoklama ve süren sürekli izleme bulguları; Kaynak sütunu (uzak bağlantı / cihazın
 * gönderdiği loglar), "Yalnız sorunlular" (varsayılan), çift tık → satırın tamamı (ui.anomaly.RowDetail). Son seçimler
 * ve ayırıcı konumları kullanıcı başına sunucuda hatırlanır. Son anlık yoklamanın sonucu sekme yeniden açılınca gösterilir.
 */
qx.Class.define("ankamon.ui.anomaly.Scan", {
  extend: qx.ui.tabview.Page,

  /**
   * @param page {ankamon.page.Anomalies}
   * @param reports {ankamon.page.Diagnose?} SSH denetim raporları ("diagnose" yetkisi yoksa null)
   */
  construct(page, reports) {
    super("Denetle");
    this.setUserData("key", "reports");
    // Sağlık sayfası sekme seçilince/yenilenince gömülü rapor sayfasını activate()/refresh() eder (bkz. page.Anomalies).
    this.setUserData("page", reports || null);
    this.__page = page;
    this.__reports = reports || null;
    this.__sshAllowed = page._can("diagnose");
    this.__sshPref = (page._user.ui_prefs || {})["anomalies.scan.ssh"] === true;
    this.setLayout(new qx.ui.layout.Grow());
    this.setPadding(8);
    const prefs = page._user.ui_prefs || {};
    this.__checked = new Set(prefs["anomalies.scan.devices"] || []);
    this.__hasDevicePref = Array.isArray(prefs["anomalies.scan.devices"]);
    this.__kindPref = prefs["anomalies.scan.kinds"] || null;

    // İki ayırıcı: (1 | 2) / 3. Konumları kullanıcı başına sunucuda (ui_prefs["anomalies.denetle.split"] = {left, top};
    // birleşmeden önceki "anomalies.scan.split" farklı yerleşimindi, kullanılmaz). Ayırıcı bırakılınca SplitPane sabit
    // boyutlu ilk bölmeye setWidth/setHeight çağırır → change olayı kaydeder (pencere daralınca yalnız yerleşim küçülür,
    // özellik değişmez: kaydedilmez — bkz. ui.Shell nav.width).
    const saved = prefs[ankamon.ui.anomaly.Scan.SPLIT_PREF] || {};
    const outer = new qx.ui.splitpane.Pane("vertical");
    this.__outerSplit = outer;
    this.add(outer);
    const split = new qx.ui.splitpane.Pane("horizontal").set({ height: saved.top || ankamon.ui.anomaly.Scan.TOP_HEIGHT });
    this.__mainSplit = split;
    outer.add(split, 0);
    split.addListener("changeHeight", e => this.__saveSplit("top", e.getData()));
    const devices = this.__createDevicesPane().set({ width: saved.left || null });
    if (!saved.left) {
      // İlk açılış: eskisi gibi 2/5 genişlik (kullanıcı sürüklemediği için kaydedilmez).
      this.__splitDefaulting = true;
      split.addListenerOnce("resize", e => {
        devices.setWidth(Math.round(e.getData().width * 0.4));
        this.__splitDefaulting = false;
      });
    }
    split.add(devices, 0);
    split.add(this.__createKindPane(), 1);
    devices.addListener("changeWidth", e => this.__saveSplit("left", e.getData()));
    outer.add(this.__createResultsPane(), 1);

    // Sekme ilk kez açılınca cihazlar yüklenir (sayfa 30 sn'de bir yenilense de liste yalnız açıkken tazelenir).
    this.addListener("appear", () => this.__loadDevices());
  },

  statics: {
    POLL_MS: 1000,
    /** Üst bölümün (① | ②) ilk yüksekliği; kullanıcı sürükleyince kayıtlı değer kullanılır. */
    TOP_HEIGHT: 290,
    /** Ayırıcı konumlarının ui_prefs anahtarı. */
    SPLIT_PREF: "anomalies.denetle.split",
    /** Seçili iç sonuç sekmesinin ui_prefs anahtarı ("ssh" | "quick"). */
    RESULT_TAB_PREF: "anomalies.denetle.results",
    /** Kaynak sütunu metinleri (sonucun nereden elde edildiği). */
    SOURCE: {
      ssh: "Uzak bağlantı (SSH ile cihazdan okundu)",
      quick: "Uzak bağlantı (SSH, anlık yoklama)",
      metric: "Uzak bağlantı (Ankamon'un topladığı sensör ölçümleri)",
      facts: "Uzak bağlantı (SSH ile toplanan donanım bilgisi)",
      log: "Cihazın gönderdiği loglar"
    }
  },

  members: {
    __page: null,
    __mainSplit: null,
    __outerSplit: null,
    __reports: null,
    __checked: null,
    __hasDevicePref: false,
    __kindPref: null,
    __devices: null,
    __deviceTable: null,
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
    __createDevicesPane() {
      const box = ankamon.ui.StepBox.create(1, "Cihazları seç").set({ marginRight: 5 });
      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(4).set({ alignY: "middle" }));
      this.__search = new qx.ui.form.TextField().set({ placeholder: "Ara: ad, konum, IP…", liveUpdate: true });
      this.__search.addListener("changeValue", () => this.__renderDevices());
      bar.add(this.__search, { flex: 1 });
      [["Tümü", "Listede görünen tüm cihazları seç", b => true],
        ["Çevrim içi", "Listede görünen çevrim içi cihazları seç (diğerlerinin seçimi kalkar)", b => b.online],
        ["Hiçbiri", "Listede görünen cihazların seçimini kaldır", b => false]].forEach(([label, tip, pick]) => {
        const button = new qx.ui.form.Button(label).set({ toolTipText: tip });
        button.addListener("execute", () => this.__pickVisible(pick));
        bar.add(button);
      });
      box.add(bar);

      const columns = [
        { id: "name", label: "Cihaz", width: 180 },
        { id: "location", label: ankamon.ui.network.PhysicalLocation.LABEL, hint: ankamon.ui.network.PhysicalLocation.HINT, width: 140 },
        { id: "status", label: "Durum", width: 100 },
        { id: "ip", label: "IP" }
      ];
      this.__deviceTable = this.__page._createTable(columns, { checkable: true, prefsKey: "anomalies.scan.devices.columns", persistSort: true, filterable: true });
      this.__deviceTable.getTableColumnModel().setDataCellRenderer(4, new ankamon.ui.table.StatusRenderer());
      // Liste her zaman Durum sütununa göre (çevrim içi önce, sonra ada göre) sıralı (kullanıcı isteği): öteki sütunlar
      // sıralanmaz, Durum başlığına tıklamak da sırayı bozmaz (iki yön aynı). keepSortOnReload her setData'da yeniden dizer.
      const model = this.__deviceTable.getTableModel();
      const onlineFirst = (a, b) => (a[4] === b[4] ? 0 : a[4] === "Çevrim içi" ? -1 : 1) ||
        String(a[2]).localeCompare(String(b[2]), "tr", { numeric: true });
      [1, 2, 3, 5].forEach(col => model.setColumnSortable(col, false));
      model.setSortMethods(4, { ascending: onlineFirst, descending: onlineFirst });
      model.sortByColumn(4, true);
      // İşaret değişince seçim kümesi güncellenir (arama süzgeci gizlenen satırların seçimini korur).
      this.__deviceTable.getTableModel().addListener("dataChanged", () => this.__syncChecked());
      box.add(this.__deviceTable, { flex: 1 });
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
      const pref = ankamon.ui.anomaly.Scan.SPLIT_PREF;
      const current = Object.assign({}, (user.ui_prefs || {})[pref] || {}, { [key]: value });
      clearTimeout(this.__splitTimer);
      this.__splitTimer = setTimeout(() => ankamon.page.Base.savePref(user, pref, current), 300);
    },

    __splitTimer: null,
    __splitDefaulting: false,

    /**
     * Tür listesinin dikey kaydırma çubuğu ve üst bölümle 3 arasındaki YATAY ayırıcı 1/2 ayırıcısıyla aynı kalınlıkta ve
     * renkte görünür (kalınlık ve zemin rengi o ayırıcıdan okunur — her temada eşleşir). Yatay ayırıcının
     * kalınlığı yüksekliğidir (kullanıcı isteği: dikey kaydırma çubuğunun kalınlığıyla aynı).
     * @param scroll {qx.ui.container.Scroll}
     */
    __matchScrollbar(scroll) {
      const splitter = this.__mainSplit.getChildControl("splitter");
      const width = (splitter.getBounds() || {}).width || splitter.getSizeHint().width;
      const bar = scroll.getChildControl("scrollbar-y");
      bar.set({ width, minWidth: width, maxWidth: width });
      const across = this.__outerSplit.getChildControl("splitter");
      across.set({ height: width, minHeight: width, maxHeight: width });
      const color = splitter.getBackgroundColor();
      if (color) {
        bar.setBackgroundColor(color);
        across.setBackgroundColor(color);
      }
    },

    /** ② Denetimleri seç ve tara: denetim türleri (kaydırmalı), Tara düğmesi, ilerleme, SSH denetimi notu. */
    __createKindPane() {
      const box = ankamon.ui.StepBox.create(2, "Denetimleri seç ve tara", "seçili cihazlara şu an bakılır").set({ marginLeft: 5 });
      this.__kindBox = new qx.ui.container.Composite(new qx.ui.layout.VBox(2));
      // Tür listesi kaydırmalı: üst bölümün en küçük yüksekliği listeye bağlı değil, ayırıcı serbestçe çekilebilir; liste
      // sığmazsa dikey kaydırma çubuğu çıkar. Başlıkla ilk tür arasında boşluk (kullanıcı isteği).
      const kindScroll = new qx.ui.container.Scroll(this.__kindBox).set({ minHeight: 40, marginTop: 8 });
      kindScroll.addListenerOnce("appear", () => this.__matchScrollbar(kindScroll));
      box.add(kindScroll, { flex: 1 });

      const run = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" })).set({ marginTop: 12 });
      this.__scanButton = new qx.ui.form.Button("Tara").set({ minWidth: 90 });
      this.__scanButton.addListener("execute", () => this.__start());
      run.add(this.__scanButton);
      this.__progress = new qx.ui.indicator.ProgressBar(0, 1).set({ width: 180, height: 14, visibility: "excluded" });
      run.add(this.__progress);
      this.__status = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true });
      run.add(this.__status, { flex: 1 });
      box.add(run);
      // Tam denetim başlatılınca kısa not (sonuçlar ③'te).
      this.__sshRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" })).set({ visibility: "excluded", marginTop: 4 });
      this.__sshNote = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true });
      this.__sshRow.add(this.__sshNote, { flex: 1 });
      box.add(this.__sshRow);
      return box;
    },

    /**
     * ③ Sonuçlar (tam genişlik) — TEK grid (kullanıcı isteği 2026-11-12: eski "SSH denetim raporları" ve "Anlık yoklama"
     * iç sekmeleri birleşti). Satırlar: tam denetim raporunun kontrolleri (üstteki rapor seçicide seçili rapor — gömülü
     * page.Diagnose'un yalnız üst satırı görünür), son anlık yoklamanın sonuçları ve sürmekte olan sürekli izleme
     * bulguları. Kaynak sütunu sonucun nereden elde edildiğini yazar: uzak bağlantıyla (Ankamon cihaza SSH ile girip
     * okudu / Ankamon'un cihazdan topladığı sensör ölçümleri) mı, cihazın gönderdiği loglardan mı. Çift tıklama: satırın
     * tamamı (ui.anomaly.RowDetail).
     */
    __createResultsPane() {
      const results = ankamon.ui.StepBox.create(3, "Sonuçlar").set({ marginTop: 5 });
      if (this.__reports) {
        this.__reports.setEmbedded(true);
        this.__reports.addListener("reportLoaded", () => this.__renderResults());
        results.add(this.__reports);
      }
      const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" })).set({ marginTop: 2 });
      this.__resultNote = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
      head.add(this.__resultNote);
      head.add(new qx.ui.core.Spacer(), { flex: 1 });
      // Varsayılan işaretli: önce sorunlar görünür.
      this.__onlyFound = new qx.ui.form.CheckBox("Yalnız sorunlular").set({ value: true,
        toolTipText: "Sorunsuz (Sorun yok / Yok) satırları gizler" });
      this.__onlyFound.addListener("changeValue", () => this.__renderResults());
      head.add(this.__onlyFound);
      results.add(head);

      this.__resultColumns = [
        { id: "device", label: "Cihaz", width: 170 },
        { id: "check", label: "Denetim", width: 210 },
        { id: "result", label: "Sonuç", width: 100, choices: true },
        { id: "detail", label: "Ayrıntı", width: 420 },
        { id: "source", label: "Kaynak", width: 210, choices: true,
          hint: "Sonucun nereden elde edildiği: uzak bağlantıyla (Ankamon cihaza bağlanıp okudu) mı, cihazın gönderdiği loglardan mı" },
        { id: "at", label: "Zaman", width: 140 }
      ];
      this.__resultTable = this.__page._createTable(this.__resultColumns, { prefsKey: "anomalies.denetle.merged.columns" });
      this.__resultFields = this.__page._addColumnFilters(this.__resultTable, this.__resultColumns, () => this.__applyResults(),
        { rows: () => (this.__mergedRows || []).map(r => r.cells), persist: true });
      this.__resultTable.getTableColumnModel().setDataCellRenderer(3, new qx.ui.table.cellrenderer.Html());
      this.__resultTable.addListener("cellDbltap", e => {
        const id = this.__resultTable.getTableModel().getValue(0, e.getRow());
        const row = (this.__mergedRows || []).find(r => r.cells[0] === id);
        if (row) {
          ankamon.ui.anomaly.RowDetail.open(`${row.plain.check} — ${row.plain.device}`, [
            ["Cihaz", row.plain.device], ["Denetim", row.plain.check], ["Sonuç", row.plain.result], ["Ayrıntı", row.plain.detail],
            ["Öneri", row.plain.advice], ["Kaynak", row.plain.source], ["Zaman", row.plain.at]
          ]);
        }
      });
      this.__resultTable.setToolTipText("Satıra çift tıklayın: satırın tamamı");
      results.add(this.__resultTable, { flex: 1 });
      // Gömülü rapor sayfası Denetle açılınca tazelenir (eskiden iç sekmesi seçilince).
      this.addListener("appear", () => this.__reports && this.__reports.activate());
      return results;
    },

    /** ③'te raporu gösterir; device verilirse grid o cihaza süzülür (Durum'dan bulguya çift tık — page.Anomalies.openFinding). */
    showReport(device) {
      if (this.__reports) {
        this.__reports.refresh();
      }
      if (device && this.__resultFields) {
        this.__resultFields.device.setValue(`"${device}"`);
      }
    },

    /** Sürmekte olan sürekli izleme bulguları (page.Anomalies — Geçmiş verisinden, ended_at boş olanlar). */
    setActive(anomalies) {
      this.__active = (anomalies || []).filter(a => !a.ended_at);
      this.__renderResults();
    },

    __showQuick() {},

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
        // SSH denetimi / sürekli izleme ayrımı burada vurgulanmaz (kullanıcı isteği 2026-11-12): yalnız seçenekler;
        // her sonucun nereden geldiği ③ Sonuçlar'ın Kaynak sütununda.
        if (this.__sshAllowed) {
          this.__sshCheck = new qx.ui.form.CheckBox("Tam denetim (disk sağlığı, sıcaklık, boş alan, güncellemeler, servisler…)").set({
            value: this.__sshPref
          });
          this.__sshCheck.addListener("changeValue", () => this.__updateButton());
          this.__kindBox.add(this.__sshCheck);
          this.__kindBox.add(new qx.ui.basic.Label("Haftada bir kendiliğinden de yapılır; cihazda yalnız okuma yapılır, " +
            "cihaz başına 1-2 sn sürer.").set({ rich: true, wrap: true, allowGrowX: true, textColor: "app-muted", marginLeft: 22, marginBottom: 6 }));
        }
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

    async __loadDevices() {
      let data;
      try {
        data = await ankamon.io.Api.get("/devices");
      } catch (e) {
        this.__selCount.setValue("Cihazlar alınamadı: " + (e.message || e));
        return;
      }
      if (this.isDisposed()) {
        return;
      }
      this.__devices = data.devices.map(b => ({
        id: b.id,
        name: b.label || b.hostname || b.ip || ("#" + b.id),
        location: b.location || "",
        ip: b.ip || "",
        online: !!b.online
      }));
      // İlk kullanımda (kayıtlı seçim yok) çevrim içi cihazlar seçili gelir.
      if (!this.__hasDevicePref && !this.__checked.size) {
        this.__devices.filter(b => b.online).forEach(b => this.__checked.add(b.id));
      }
      const ids = new Set(this.__devices.map(b => b.id));
      [...this.__checked].filter(id => !ids.has(id)).forEach(id => this.__checked.delete(id)); // silinmiş cihazlar
      this.__renderDevices();
    },

    __visibleDevices() {
      const q = (this.__search.getValue() || "").trim().toLocaleLowerCase("tr");
      return (this.__devices || []).filter(b => !q ||
        [b.name, b.location, b.ip].some(v => v.toLocaleLowerCase("tr").includes(q)));
    },

    __renderDevices() {
      this.__rendering = true;
      this.__deviceTable.getTableModel().setData(this.__visibleDevices().map(b =>
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
      const tm = this.__deviceTable.getTableModel();
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
      this.__visibleDevices().forEach(b => (pick(b) ? this.__checked.add(b.id) : this.__checked.delete(b.id)));
      this.__renderDevices();
    },

    __selectedKinds() {
      return (this.__kinds || []).filter(k => this.__kindChecks[k].getValue());
    },

    __sshSelected() {
      return !!(this.__sshCheck && this.__sshCheck.getValue());
    },

    __sshAllowed: false,
    __sshPref: false,
    __sshCheck: null,
    __sshRow: null,
    __sshNote: null,

    __updateButton() {
      const devices = (this.__devices || []).filter(b => this.__checked.has(b.id));
      const offline = devices.filter(b => !b.online).length;
      this.__selCount.setValue(`${devices.length} cihaz seçili` +
        (offline ? ` (${offline} tanesi çevrim dışı — taranamaz)` : ""));
      const kinds = this.__selectedKinds().length + (this.__sshSelected() ? 1 : 0);
      const running = this.__job && ["queued", "running"].includes(this.__job.status);
      this.__scanButton.set({
        enabled: !running && devices.length > 0 && kinds > 0,
        label: running ? "Taranıyor…" : (devices.length && kinds ? `Tara (${devices.length} cihaz, ${kinds} denetim)` : "Tara")
      });
    },

    async __start() {
      const ids = [...this.__checked];
      const kinds = this.__selectedKinds();
      const S = ankamon.page.Base;
      S.savePref(this.__page._user, "anomalies.scan.devices", ids);
      S.savePref(this.__page._user, "anomalies.scan.kinds", kinds);
      this.__hasDevicePref = true;
      if (this.__sshAllowed) {
        S.savePref(this.__page._user, "anomalies.scan.ssh", this.__sshSelected());
      }
      if (this.__sshSelected()) {
        // Kapalı cihaz SSH ile denetlenemez: yalnız çevrim içi olanlar.
        const online = (this.__devices || []).filter(b => this.__checked.has(b.id) && b.online).map(b => b.id);
        this.__sshRow.setVisibility("visible");
        if (!online.length) {
          this.__sshNote.setValue("Tam denetim: seçili cihazların hiçbiri açık değil; kapalı cihaz denetlenemez.");
        } else {
          try {
            const job = await ankamon.io.Api.post("/jobs", { type: "diagnose", device_ids: online });
            this.__sshNote.setValue(`Tam denetim başlatıldı (${online.length} açık cihaz, görev #${job.id}); ` +
              "sonuçlar aşağıda ve Durum'da görünür.");
            this.showReport(); // süren denetim raporu ③'e gelsin
          } catch (e) {
            this.__sshNote.setValue("Tam denetim başlatılamadı: " + qx.bom.String.escape(e.message || String(e)));
          }
        }
      } else {
        this.__sshRow.setVisibility("excluded");
      }
      if (!kinds.length) {
        return;
      }
      let res;
      try {
        res = await ankamon.io.Api.post("/jobs", { type: "anomaly_scan", device_ids: ids, kinds });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      this.__lastJobShown = res.id;
      this.__showQuick();
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

    /** Görevin cihaz sonuçları → satırlar [{device, kind, state: found|clear|unknown, text}]. */
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
            text = t.status === "unreachable" ? "Cihaza ulaşılamadı (kapalı olabilir): " + (t.output || "") : (t.output || "Taranamadı");
          }
          rows.push({ id: t.device_id + ":" + kind, device: t.device, kind, state, text, running: t.status === "running" });
        });
      });
      return rows;
    },

    __renderResults() {
      if (!this.__resultTable) {
        return;
      }
      const F = ankamon.util.Format;
      const S = ankamon.ui.table.StatusRenderer;
      const L = ankamon.page.Diagnose.LEVEL;
      const red = S.colorOf("Çevrim dışı");
      const green = S.colorOf("Çevrim içi");
      const esc = qx.bom.String.escape;
      const SRC = ankamon.ui.anomaly.Scan.SOURCE;
      const rows = [];
      const add = (id, rank, plain, resultHtml, detailHtml) => {
        rows.push({ rank, plain, problem: rank < 4,
          cells: [id, plain.device, plain.check, plain.result, detailHtml, plain.source, plain.at],
          html: resultHtml });
      };
      // 1) Tam denetim raporu (seçili rapor).
      const report = this.__reports ? this.__reports.getReport() : null;
      (report ? report.targets : []).forEach(t => {
        let r = null;
        if (t.status === "ok") {
          try {
            r = JSON.parse(t.output || "{}");
          } catch (e) {
            r = null;
          }
        }
        const at = r && r.collected_at ? F.dateTime(r.collected_at * 1000) : (t.finished_at ? F.dateTime(t.finished_at * 1000) : "");
        if (["queued", "running"].includes(t.status)) {
          add(`ssh:${t.device_id}:pending`, 5, { device: t.device, check: "Tam denetim", result: t.status === "running" ? "Denetleniyor" : "Sırada",
            detail: "", source: SRC.ssh, at: "" }, null, "");
          return;
        }
        if (!r) {
          const why = String(t.output || "").replace(/\s+/g, " ").trim();
          add(`ssh:${t.device_id}:err`, 1, { device: t.device, check: "Tam denetim", result: "Ulaşılamadı", detail: why, source: SRC.ssh, at },
            null, esc(why));
          return;
        }
        (r.checks || []).forEach((c, i) => {
          const level = L[c.level] || { text: c.level };
          const rank = { bad: 0, warn: 2, info: 3, ok: 6 }[c.level] ?? 5;
          // Son 24 saatin sıcaklığı cihaza bağlanılarak değil, Ankamon'un sürekli topladığı ölçümlerden hesaplanır.
          const source = c.group === "İşlemci sıcaklığı" ? SRC.metric : SRC.ssh;
          add(`ssh:${t.device_id}:${i}`, rank, { device: t.device, check: `${c.group} › ${c.title}`, result: level.text,
            detail: c.detail || "", advice: c.advice || "", source, at },
          level.color ? S.html(level.text, level.color) : null,
          esc(c.detail || "") + (c.advice ? ` <span style="opacity:.65">— ${esc(c.advice)}</span>` : ""));
        });
      });
      // 2) Son anlık yoklama.
      const label = { found: ["Var", red, 1], clear: ["Yok", green, 7], unknown: ["Taranamadı", null, 4], pending: ["Taranıyor", null, 5] };
      const when = this.__job ? F.dateTime((this.__job.finished_at || this.__job.created_at) * 1000) : "";
      this.__resultRows().forEach(r => {
        const [text, color, rank] = label[r.state];
        add(`quick:${r.id}`, rank, { device: r.device, check: (this.__kindLabels || {})[r.kind] || r.kind, result: text,
          detail: r.text || "", source: SRC.quick, at: r.state === "pending" ? "" : when },
        r.running ? ankamon.ui.JobSpinner.label("Taranıyor") : (color ? S.html(text, color) : null), esc(r.text || ""));
      });
      // 3) Süren sürekli izleme bulguları.
      (this.__active || []).forEach(a => {
        // Kural verisinin kaynağı (AnomaliesApi KINDS source): Log / Ölçüm / SSH verisi (daha önce SSH ile toplanan donanım bilgisi).
        const source = { "Log": SRC.log, "Ölçüm": SRC.metric, "SSH verisi": SRC.facts }[a.source] || a.source || "";
        add(`watch:${a.id}`, 1, { device: a.device, check: a.kindLabel || a.kind, result: "Sürüyor",
          detail: a.text || "", advice: a.kindDesc || "", source, at: F.dateTime(a.started_at * 1000) },
        S.html("Sürüyor", red), esc(a.text || ""));
      });
      rows.sort((x, y) => x.rank - y.rank || String(x.plain.device).localeCompare(String(y.plain.device), "tr", { numeric: true }));
      this.__mergedRows = rows;
      this.__applyResults();
      if (this.__job) {
        this.__updateQuickStatus();
      } else {
        this.__status.setValue("Cihazları ve denetimleri seçip Tara'ya basın.");
      }
    },

    /** Süzgeçler + "Yalnız sorunlular" → grid. */
    __applyResults() {
      const all = this.__mergedRows || [];
      const only = this.__onlyFound.getValue();
      const filters = this.__resultColumns
        .map((c, i) => ({ i: i + 1, text: ((this.__resultFields[c.id] || { getValue: () => "" }).getValue() || "").trim() }))
        .filter(f => f.text);
      const shown = all.filter(r => (!only || r.problem) && filters.every(f => ankamon.page.Base.filterMatch(r.cells[f.i], f.text)));
      this.__resultTable.getTableModel().setData(shown.map(r => {
        const cells = r.cells.slice();
        if (r.html) {
          cells[3] = r.html;
        }
        return cells;
      }));
      const problems = all.filter(r => r.problem).length;
      this.__resultNote.setValue(`${shown.length} satır gösteriliyor · ${problems} sorun · ${all.length} toplam`);
    },

    /** ② altındaki durum satırı: son anlık yoklamanın özeti. */
    __updateQuickStatus() {
      const all = this.__resultRows();
      const job = this.__job;
      const S = ankamon.ui.table.StatusRenderer;
      const red = S.colorOf("Çevrim dışı");
      const green = S.colorOf("Çevrim içi");
      const esc = qx.bom.String.escape;
      const devices = job.targets.length;
      const pending = job.targets.filter(t => ["queued", "running"].includes(t.status)).length;
      const foundDevices = new Set(all.filter(r => r.state === "found").map(r => r.device)).size;
      const found = all.filter(r => r.state === "found").length;
      const unreachable = job.targets.filter(t => !["queued", "running", "ok"].includes(t.status)).length;
      const when = ankamon.util.Format.dateTime((job.finished_at || job.created_at) * 1000);
      let html = pending ? ankamon.ui.JobSpinner.label(`Taranıyor: ${devices - pending} / ${devices} cihaz tamamlandı…`)
        : `<span style="font-weight:bold;color:${found ? red : green}">` +
          (found ? `${foundDevices} cihazda ${found} anomali bulundu` : "Anomali bulunmadı") + "</span>";
      html += ` <span style="opacity:.75">· ${devices} cihaz` + (unreachable ? `, ${unreachable} tanesine ulaşılamadı` : "") +
        (pending ? "" : ` · ${esc(String(when))}`) + "</span>";
      this.__status.setValue(html);
    },

    __resultColumns: null,
    __resultFields: null,
    __resultNote: null,
    __mergedRows: null,
    __active: null
  }
});
