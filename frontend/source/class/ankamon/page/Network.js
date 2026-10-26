/**
 * Ağ envanteri (sol menü "Ağ" ve altındaki her ağ): ağdaki bütün cihazlar — o an çevrim dışı
 * olanlar dahil. Cihazların kimliği MAC adresidir. Tahtalar grid'iyle aynı kalıp (satır başı onay
 * kutuları, sütun süzgeçleri, sütun genişliği/görünürlüğü kullanıcıya göre saklanır, sağ menü).
 *
 * Her cihaz satırının altında açık portları/servisleri alt satırlar olarak durur (varsayılan kapalı;
 * baştaki ▸ ile açılır). Sıralama cihaz satırları üzerinden yapılır, alt satırlar kendi cihazının
 * altında kalır (bkz. ui.table.GroupModel).
 *
 * Canlı güncelleme: STATE_MS'de bir /network/state okunur (tarayıcının durumu + liste sürümü);
 * sürüm değiştiyse — tarayıcı yeni cihaz/durum değişikliği yazdıysa — liste hemen yeniden çekilir.
 * Ayrıca "Son görülme" gibi süreler bayatlamasın diye LIST_MS'de bir koşulsuz tazelenir.
 * Tarayıcı: worker/ankamon/netscan (yüke göre kendi sıklığını ayarlar), API: backend NetworkApi.
 */
qx.Class.define("ankamon.page.Network", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, "Ağ");
    this._compact = true;
    this.__expanded = new Set();
    this.__networkId = 0;
    const Ops = ankamon.ui.network.Ops;

    this._addButton("Yenile", this.refresh);
    this.__checkAllButton = this._addButton("Tümünü işaretle", () => this._checkAll(this.__table, true));
    this.__uncheckButton = this._addButton("İşaretleri kaldır", () => this._checkAll(this.__table, false));
    this._addButton("Servisleri aç/kapat", () => this.__toggleAll())
      .set({ toolTipText: "Bütün cihazların port/servis alt satırlarını açar ya da kapatır" });
    if (this._can("network.manage")) {
      this._addButton("Ekle", () => this.__edit(null));
      this.__editButton = this._addButton("Düzenle", () => this.__single(d => this.__edit(d)));
      this.__deleteButton = this._addButton("Sil", () => this.__withSome(ds => this.__remove(ds)));
      this.__servicesButton = this._addButton("Servisleri tara", () => this.__withSome(ds => this.__scanServices(ds)))
        .set({ toolTipText: "İşaretli cihazların açık port ve servislerini sıranın başında tarar" });
      this._addButton("Şimdi tara", async () => {
        await Ops.scanNow();
        this.__pollState();
      }).set({ toolTipText: "Bağlı bütün ağlarda varlık taramasını hemen başlatır (makine çok yoğunsa yine ertelenir)" });
    }

    // Tarayıcı durumu: metin + tarama sürerken ilerleme çubukları (varlık taraması, servis kuyruğu).
    const statusRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    const bar = () => new qx.ui.indicator.ProgressBar(0, 100).set({ width: 160, height: 12, allowGrowY: false, visibility: "excluded" });
    this.__status = new qx.ui.basic.Label("").set({ rich: true, textColor: "app-muted" });
    this.__sweepBar = bar();
    this.__serviceStatus = new qx.ui.basic.Label("").set({ rich: true, textColor: "app-muted" });
    this.__serviceBar = bar();
    statusRow.add(this.__status);
    statusRow.add(this.__sweepBar);
    this.__statusSep = new qx.ui.basic.Label("·").set({ textColor: "app-muted" });
    statusRow.add(this.__statusSep);
    statusRow.add(this.__serviceStatus);
    statusRow.add(this.__serviceBar);
    this.add(statusRow);

    this.__columns = [
      { id: "exp", label: "", width: 30 },
      { id: "status", label: "Durum", width: 90 },
      { id: "name", label: "Takma ad / Ad", width: 200 },
      { id: "ip", label: "IP", width: 120 },
      { id: "mac", label: "MAC", width: 140 },
      { id: "vendor", label: "Marka (üretici)", width: 180 },
      { id: "type", label: "Cihaz türü", width: 140 },
      { id: "model", label: "Model", width: 180 },
      { id: "hostname", label: "Bilgisayar adı", width: 150 },
      { id: "os", label: "İşletim sistemi", width: 160 },
      { id: "ports", label: "Açık port", width: 80 },
      { id: "network", label: "Ağ", width: 130 },
      { id: "first", label: "İlk görülme", width: 110 },
      { id: "seen", label: "Son görülme", width: 110 },
      { id: "notes", label: "Not", width: 150 },
      // FATİH fazı (bkz. util.Format.etap). Sona eklendi: servis alt satırları sabit sütun sırası kullanır.
      { id: "faz", label: "Faz", width: 130 },
      // Ağ etkinliği: IP ID örneklemesinden yaklaşık pkt/sn (yalnız Windows; bkz. worker netscan/activity.py,
      // bellek network-usage-study). Boş = ölçülmedi/güvenilmez (Linux/kamera/yanıt yok). Sona eklendi:
      // servis/paylaşım alt satırları sabit (düşük) sütun sırası kullanır, boş kalır.
      { id: "activity", label: "Ağ etkinliği", hint: "Göreli ağ yoğunluğu 0–100 (anlık en yüksek görülen akış = 100; pasif gözlem). Ham değer: 'Ağ akışı' sütunu.", width: 120 },
      { id: "activity_detail", label: "Ağ akışı", hint: "Görülen akış ayrıntısı: kbit/sn + baskın protokol; görünür akış yoksa Windows IP-ID gönderim hızı (sakin/boş).", width: 170 }
      // Ayrı "Takma ad" (MAC kaydı) sütunu yok (kullanıcı isteği, 2026-10-19: "Takma ad / Ad" ile yineleniyordu);
      // MAC ↔ takma ad kaydı "Takma ad / Ad"ın kendisini besler — bkz. ui.network.Ops.deviceName (known_alias).
    ];
    this.__model = new ankamon.ui.table.GroupModel(() => this.__apply());
    this.__table = this._createTable(this.__columns, { checkable: true, storageKey: "network.columns", model: this.__model });
    // Servis/paylaşım (alt) satırları temaya uyumlu farklı zeminle (bkz. ui.table.GroupRowRenderer).
    this.__table.setDataRowRenderer(new ankamon.ui.table.GroupRowRenderer(row => typeof row[0] !== "number"));
    // "Durum" sütunu: çevrim içi cihazın soluna küçük yeşil yuvarlak (bkz. ui.table.StatusRenderer).
    // Sütun indeksi: id + onay kutusu (2) + "exp" (0) + "status" (1) = 3.
    this.__table.getTableColumnModel().setDataCellRenderer(3, new ankamon.ui.table.StatusRenderer());
    // "Cihaz türü" hücresine türe özgü minik ikon (bkz. ui.table.DeviceTypeRenderer).
    this.__table.getTableColumnModel().setDataCellRenderer(2 + this.__columns.findIndex(c => c.id === "type"),
      new ankamon.ui.table.DeviceTypeRenderer());
    this.__filterFields = this._addColumnFilters(this.__table, this.__columns, this.__apply);
    this.__model.addListener("dataChanged", this.__onDataChanged, this);

    // ▸ sütunu alt satırları açar/kapar; alt (servis) satırları işaretlenemez (Base'in işaretlemesinden sonra geri alınır).
    this.__table.addListener("cellTap", e => {
      const row = e.getRow();
      if (row === null || row === undefined) {
        return;
      }
      const id = this.__model.getValue(0, row);
      if (typeof id !== "number") {
        return;
      }
      if (e.getColumn() === 2) {
        this.__toggle(id);
      }
    });
    // Çift tıklama = Bilgisayar ayrıntıları (kullanıcı isteği; düzenleme sağ menüde ve ayrıntılar penceresinde).
    this.__table.addListener("cellDbltap", e => {
      const id = this.__model.getValue(0, e.getRow());
      if (typeof id === "number" && e.getColumn() !== 2) {
        this.__showDetails(this.__devices.get(id));
      }
    });
    this.__table.addListener("cellContextmenu", e => {
      const row = e.getRow();
      const rawId = row === null ? null : this.__model.getValue(0, row);
      const id = typeof rawId === "number" ? rawId : (rawId ? Number(String(rawId).split(":")[1]) : null);
      const device = id ? this.__devices.get(id) : null;
      if (!device) {
        this.__table.setContextMenu(null);
        return;
      }
      const checked = this.__checkedDevices();
      const devices = checked.includes(device) && checked.length > 1 ? checked : [device];
      this.__table.setContextMenu(this.__rowMenu(device, devices));
    });
    this.add(this.__table, { flex: 1 });
    this.__note = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true, wrap: true });
    this.add(this.__note);

    this.__timer = new qx.event.Timer(ankamon.page.Network.STATE_MS);
    this.__timer.addListener("interval", this.__pollState, this);
    this.__timer.start();
    this.__updateActionState();
  },

  statics: {
    STATE_MS: 3000,
    // Tarama sürerken ilerleme çubuğu akıcı ilerlesin diye daha sık okunur.
    STATE_FAST_MS: 700,
    LIST_MS: 60000,

    /** IPv4 → sıralanabilir sayı (boş en sona). */
    ipKey(ip) {
      if (!ip) {
        return Number.MAX_SAFE_INTEGER;
      }
      return ip.split(".").reduce((acc, part) => acc * 256 + (parseInt(part, 10) || 0), 0);
    },

    /** "Ağ etkinliği" sütununun sayısal sıralama anahtarı (büyüklük; göreli). Hücre metni "N kbit/sn · PROTO"
     * olduğundan sözlüksel sıralanırdı; bunun yerine cihaz verisinden sayı üretilir (bkz. flowText):
     * gözlenen akış (kbit/sn) en üst bant, Windows IP-ID gönderim hızı (pkt/sn) orta bant, ölçülmemiş en altta. */
    activityKey(d) {
      const fresh = d.flow_at && (Date.now() / 1000 - d.flow_at) < 600;
      return fresh && d.flow_kbps != null ? d.flow_kbps : -1;
    }
  },

  destruct() {
    if (this.__timer) {
      this.__timer.stop();
      this.__timer.dispose();
    }
  },

  members: {
    __model: null,
    __table: null,
    __columns: null,
    __filterFields: null,
    __devices: null,
    __rows: null,
    __expanded: null,
    __networkId: null,
    __networks: null,
    __version: null,
    __loadedAt: 0,
    __status: null,
    __serviceStatus: null,
    __statusSep: null,
    __sweepBar: null,
    __serviceBar: null,
    __note: null,
    __timer: null,
    __polling: false,
    __checkAllButton: null,
    __uncheckButton: null,
    __editButton: null,
    __deleteButton: null,
    __servicesButton: null,
    __fixingChecks: false,

    /**
     * Sol ağaçtan ağ seçimi (0: bütün ağlar). Shell sayfayı göstermeden ÖNCE çağırır; liste
     * activate()'in yenilemesiyle gelir.
     */
    setNetwork(id) {
      if (this.__networkId !== id) {
        this.__networkId = id;
        this.__rows = null;
        this.__model.setData([], false);
      }
    },

    async _refresh() {
      const F = ankamon.util.Format;
      const Ops = ankamon.ui.network.Ops;
      const [nets, data] = await Promise.all([
        ankamon.io.Api.get("/network"),
        ankamon.io.Api.get("/network/devices", { network: this.__networkId || 0 })
      ]);
      this.__networks = nets.networks;
      qx.event.message.Bus.dispatchByName(Ops.NETWORKS_CHANGED, { networks: nets.networks });
      this.__version = data.version;
      this.__loadedAt = Date.now();
      this.__showState(data);

      const wasChecked = new Set(this.__checkedDevices().map(d => d.id));
      const netName = new Map(nets.networks.map(n => [n.id, Ops.networkLabel(n)]));
      // "Ağ etkinliği" hücresi: öncelik PASİF görülen akış yoğunluğu (tüm cihazlar; flow_kbps/pps + baskın
      // protokol — bkz. worker netscan/flows.py). Görünürde akış yoksa Windows gönderim hızı (IP ID,
      // activity_pps) yedek gösterilir. flow_at 10 dk'dan eskiyse görülen akış yok sayılır.
      // "Ağ etkinliği" STANDART sayısal metrik: görülen akış yoğunluğu, kbit/sn (pasif gözlem, flows.py).
      // Hücre tek bir SAYI (birim sütun başlığında); ölçüm yoksa (flow_at 10 dk'dan eski) null = boş.
      // Baskın protokol ve Windows IP-ID gönderim hızı artık grid'de değil, Bilgisayar ayrıntıları penceresinde.
      // İki sütun aynı pasif gözlem verisinden (flows.py):
      //  - "Ağ etkinliği": 0–100 GÖRELİ yoğunluk — referans o anki tüm cihazların görülen akışı (en yüksek = 100).
      //  - "Ağ akışı": insan-okur ayrıntı (kbit/sn + baskın protokol; görünür akış yoksa Windows IP-ID gönderim hızı).
      const freshKbps = d => {
        const fresh = d.flow_at && (Date.now() / 1000 - d.flow_at) < 600;
        return fresh && d.flow_kbps != null ? d.flow_kbps : null;
      };
      const maxFlow = Math.max(0, ...data.devices.map(d => freshKbps(d) || 0));
      const normNum = d => {
        const v = freshKbps(d);
        return v == null ? null : (maxFlow > 0 ? Math.round(100 * v / maxFlow) : 0);
      };
      const flowText = d => {
        const v = freshKbps(d);
        if (v != null && (d.flow_kbps >= 1 || d.flow_pps >= 1)) {
          const rate = d.flow_kbps >= 1 ? Math.round(d.flow_kbps) + " kbit/sn" : d.flow_pps.toFixed(1) + " pkt/sn";
          return d.flow_proto ? rate + " · " + d.flow_proto : rate;
        }
        if (d.activity_pps != null && d.activity_pps >= 1) {
          return "gönderim ~" + Math.round(d.activity_pps) + " pkt/sn";
        }
        return (v != null || d.activity_pps != null) ? "sakin" : "";
      };
      this.__devices = new Map(data.devices.map(d => [d.id, d]));
      // cells: [kimlik, işaret, ▸, …sütunlar] — alt satırlar __apply'da eklenir.
      this.__rows = data.devices.map(d => ({
        device: d,
        cells: [
          d.id, wasChecked.has(d.id), (d.services.length + (d.shares ? d.shares.length : 0)) ? "▸" : "",
          d.online ? "Çevrim içi" : "Çevrim dışı",
          Ops.deviceName(d), d.ip || "", d.mac, d.vendor || (d.mac && /^.[26ae]/i.test(d.mac) ? "(rastgele MAC)" : ""),
          d.device_type || "", d.model || "", d.hostname || "", d.os_guess || "",
          d.services_scanned_at ? String(d.services.length) : "",
          netName.get(d.network_id) || d.network,
          F.ago(d.first_seen_at), d.online ? "şimdi" : F.ago(d.last_seen_at), d.notes || "",
          F.etap(d.etap),
          normNum(d), flowText(d)
        ]
      }));
      this.__apply();

      const net = this.__networkId ? nets.networks.find(n => n.id === this.__networkId) : null;
      let note = "";
      if (!nets.networks.length) {
        note = "Henüz ağ bulunmadı. Tarayıcı açıldıktan sonra sunucunun bağlı olduğu fiziksel ağlar burada listelenir.";
      } else if (net && !net.attached) {
        note = "Sunucu artık bu ağa bağlı değil — kayıtlar son bilinen durumlarıyla gösteriliyor.";
      } else if (net && !net.scan_enabled) {
        note = "Bu ağın taraması kapalı (sol menüde ağın sağ tık menüsünden açılabilir).";
      }
      const online = data.devices.filter(d => d.online).length;
      this.__note.setValue(`${data.devices.length} cihaz, ${online} çevrim içi, ${data.devices.length - online} çevrim dışı.` +
        (note ? " " + note : ""));
    },

    /** Süzgeçleri ve sıralamayı uygular, açık cihazların servis satırlarını altlarına ekler. */
    __apply() {
      if (!this.__rows) {
        return;
      }
      const colFilters = this.__columns
        .map((column, index) => ({ index: index + 2, text: (this.__filterFields[column.id].getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
      let shown = this.__rows.filter(({ cells }) =>
        colFilters.every(f => String(cells[f.index] ?? "").toLowerCase().includes(f.text)));

      const col = this.__model.getSortColumnIndex();
      const asc = this.__model.isSortAscending();
      const ipCol = 2 + this.__columns.findIndex(c => c.id === "ip");
      const activityCol = 2 + this.__columns.findIndex(c => c.id === "activity");
      const detailCol = 2 + this.__columns.findIndex(c => c.id === "activity_detail");
      if (col >= 2) {
        const key = col === ipCol ? (r => ankamon.page.Network.ipKey(r.cells[col]))
          : (col === activityCol || col === detailCol) ? (r => ankamon.page.Network.activityKey(r.device))
          : (r => String(r.cells[col] ?? "").toLocaleLowerCase("tr"));
        shown = shown.slice().sort((a, b) => {
          const ka = key(a);
          const kb = key(b);
          const c = ka < kb ? -1 : ka > kb ? 1 : 0;
          return asc ? c : -c;
        });
      } else {
        // Varsayılan: önce çevrim içi, sonra IP sırası.
        shown = shown.slice().sort((a, b) => (b.device.online - a.device.online) ||
          (ankamon.page.Network.ipKey(a.device.ip) - ankamon.page.Network.ipKey(b.device.ip)));
      }

      const out = [];
      const blank = this.__columns.map(() => "");
      shown.forEach(row => {
        const d = row.device;
        const subCount = d.services.length + (d.shares ? d.shares.length : 0);
        const open = this.__expanded.has(d.id) && subCount;
        row.cells[2] = subCount ? (open ? "▾" : "▸") : "";
        out.push(row.cells);
        if (open) {
          // Önce ağ paylaşımları (klasör/yazıcı simgesiyle), sonra açık portlar/servisler.
          (d.shares || []).forEach(sh => {
            const cells = [`h:${d.id}:${sh.name}`, false].concat(blank);
            cells[3] = "paylaşım";
            cells[4] = `└ ${sh.stype === "printer" ? "🖨" : "📁"} ${sh.path || sh.name}`;
            cells[9] = sh.comment || "";
            out.push(cells);
          });
          d.services.forEach(s => {
            const cells = [`s:${d.id}:${s.proto}/${s.port}`, false].concat(blank);
            cells[3] = "açık";
            cells[4] = `└ ${s.port}/${s.proto}  ${s.service || ""}`;
            cells[9] = [s.product, s.version].filter(Boolean).join(" ");
            cells[11] = s.extra || "";
            out.push(cells);
          });
        }
      });
      this.__model.setData(out, false);
      if (this.__checkAllButton) {
        this.__checkAllButton.setLabel(shown.length ? `Tümünü işaretle (${shown.length})` : "Tümünü işaretle");
      }
    },

    __toggle(id) {
      if (this.__expanded.has(id)) {
        this.__expanded.delete(id);
      } else {
        this.__expanded.add(id);
      }
      this.__keepChecks(() => this.__apply());
    },

    __toggleAll() {
      const withSub = [...(this.__devices || new Map()).values()]
        .filter(d => d.services.length || (d.shares && d.shares.length));
      const allOpen = withSub.length && withSub.every(d => this.__expanded.has(d.id));
      this.__expanded = allOpen ? new Set() : new Set(withSub.map(d => d.id));
      this.__keepChecks(() => this.__apply());
    },

    /** __apply satırları cells dizilerinden yeniden kurar; o anki işaretler kaybolmasın. */
    __keepChecks(fn) {
      const checked = new Set(this.__checkedDevices().map(d => d.id));
      (this.__rows || []).forEach(r => { r.cells[1] = checked.has(r.device.id); });
      fn();
    },

    /** Alt satırlar işaretlenemez; işaret sayısına göre düğmeler güncellenir. */
    __onDataChanged() {
      if (this.__fixingChecks) {
        return;
      }
      this.__fixingChecks = true;
      try {
        for (let row = 0; row < this.__model.getRowCount(); row++) {
          if (typeof this.__model.getValue(0, row) !== "number" && this.__model.getValue(1, row)) {
            this.__model.setValue(1, row, false);
          }
        }
      } finally {
        this.__fixingChecks = false;
      }
      this.__updateActionState();
    },

    __checkedDevices() {
      if (!this.__table || !this.__devices) {
        return [];
      }
      return this._checkedIds(this.__table).filter(id => typeof id === "number")
        .map(id => this.__devices.get(id)).filter(Boolean);
    },

    __updateActionState() {
      const count = this.__checkedDevices().length;
      if (this.__editButton) {
        this.__editButton.setEnabled(count === 1);
      }
      [this.__deleteButton, this.__servicesButton, this.__uncheckButton].filter(Boolean).forEach(button => {
        if (button.getUserData("baseLabel") === null) {
          button.setUserData("baseLabel", button.getLabel());
        }
        button.setLabel(count ? `${button.getUserData("baseLabel")} (${count})` : button.getUserData("baseLabel"));
        if (button !== this.__uncheckButton) {
          button.setEnabled(count >= 1);
        }
      });
    },

    /** Tarayıcı durumu + sürüm; sürüm değiştiyse listeyi hemen tazeler. Sayfa görünmüyorsa çalışmaz. */
    async __pollState() {
      if (this.__polling || !this.isSeeable()) {
        return;
      }
      this.__polling = true;
      try {
        const st = await ankamon.io.Api.get("/network/state");
        this.__showState(st);
        if (st.version !== this.__version || Date.now() - this.__loadedAt > ankamon.page.Network.LIST_MS) {
          await this._refresh();
        }
      } catch (e) {
        // geçici ağ/oturum hatası: bir sonraki yoklamada yeniden denenir
      } finally {
        this.__polling = false;
      }
    },

    __showState(st) {
      const s = ankamon.ui.network.Ops.status(st.state, st.now || Date.now() / 1000);
      this.__status.setValue(s.sweep);
      this.__serviceStatus.setValue(s.service);
      this.__statusSep.setVisibility(s.service ? "visible" : "excluded");
      this.__sweepBar.setVisibility(s.sweepPct === null ? "excluded" : "visible");
      this.__sweepBar.setValue(s.sweepPct || 0);
      this.__serviceBar.setVisibility(s.servicePct === null ? "excluded" : "visible");
      this.__serviceBar.setValue(s.servicePct || 0);
      const ms = s.sweepPct === null ? ankamon.page.Network.STATE_MS : ankamon.page.Network.STATE_FAST_MS;
      if (this.__timer && this.__timer.getInterval() !== ms) {
        this.__timer.setInterval(ms);
      }
    },

    __single(handler) {
      const devices = this.__checkedDevices();
      if (devices.length !== 1) {
        ankamon.ui.Dialog.alert("Önce listeden tek bir cihazı işaretleyin.");
        return;
      }
      handler(devices[0]);
    },

    __withSome(handler) {
      const devices = this.__checkedDevices();
      if (!devices.length) {
        ankamon.ui.Dialog.alert("Önce bir ya da daha fazla cihaz işaretleyin.");
        return;
      }
      handler(devices);
    },

    async __edit(device) {
      const networks = (this.__networks || []).filter(n => n.attached || (device && n.id === device.network_id));
      if (!device && !networks.length) {
        ankamon.ui.Dialog.alert("Henüz bağlı bir ağ yok; cihaz eklenecek ağ bulunamadı.");
        return;
      }
      if (await ankamon.ui.network.Ops.edit(device, networks, this.__networkId)) {
        this.refresh();
      }
    },

    async __remove(devices) {
      if (await ankamon.ui.network.Ops.remove(devices)) {
        this._checkAll(this.__table, false);
        this.refresh();
      }
    },

    async __scanServices(devices) {
      await ankamon.ui.network.Ops.scanServices(devices);
      devices.forEach(d => this.__expanded.add(d.id));
      this.__pollState();
    },

    async __scanShares(devices) {
      await ankamon.ui.network.Ops.scanShares(devices);
      devices.forEach(d => this.__expanded.add(d.id));
      this.__pollState();
    },

    /**
     * Bilgisayar ayrıntıları (modal; çift tıklama ve sağ menü — kullanıcı isteği): grid'in TÜM sütunlarının
     * (gizlenmiş olanlar dahil) değerleri iki sütunlu tabloda; ardından varsa açık portlar/servisler ve ağ
     * paylaşımları. Metin fareyle seçilip kopyalanabilir; "Tümünü kopyala" hepsini düz metin verir. "Düzenle"
     * yalnız network.manage yetkisiyle.
     */
    __showDetails(device) {
      if (!device) {
        return;
      }
      const F = ankamon.util.Format;
      const row = (this.__rows || []).find(r => r.device.id === device.id);
      const cells = row ? row.cells : [];
      const strip = v => String(v ?? "").replace(/<[^>]+>/g, "").trim();
      const when = (secs, rel) => (secs ? `${rel} (${F.dateTime(secs * 1000)})` : rel || "");
      const fields = this.__columns.filter(c => c.id !== "exp").map(c => {
        const i = this.__columns.indexOf(c) + 2;
        let value = strip(cells[i]);
        if (c.id === "first") {
          value = when(device.first_seen_at, value);
        } else if (c.id === "seen") {
          value = device.online ? "şimdi (çevrim içi)" : when(device.last_seen_at, value);
        } else if (c.id === "ports" && !value) {
          value = device.services_scanned_at ? "0" : "taranmadı";
        }
        return [c.label, value || "—"];
      });
      const name = ankamon.ui.network.Ops.deviceName(device) || device.ip || device.mac;
      const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
      const win = ankamon.ui.Dialog.window("Bilgisayar ayrıntıları — " + name, Math.min(720, root.width - 40), { maximizable: true });
      win.set({ height: Math.min(720, root.height - 40) });

      // Tablolar seçilebilir HTML (kullanıcı isteği: değerler fareyle seçilip panoya kopyalanabilsin) — qx
      // tablo hücreleri seçilemiyordu. Hepsi kaydırılabilir tek sütunda; "Tümünü kopyala" düz metin verir.
      const esc = qx.bom.String.escape;
      const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
      const plain = [];
      const table = (title, columns, rows, widths) => {
        const cell = "padding:4px 8px;border-bottom:1px solid rgba(128,128,128,.25);vertical-align:top;" +
          "overflow-wrap:anywhere;text-align:left";
        const html = '<table style="border-collapse:collapse;width:100%;font:inherit;table-layout:fixed">' +
          "<colgroup>" + widths.map(w => (typeof w === "number" ? `<col style="width:${w}px">` : "<col>")).join("") + "</colgroup>" +
          (title ? "<tr>" + columns.map(c => `<th style="${cell};font-weight:bold">${esc(c)}</th>`).join("") + "</tr>" : "") +
          rows.map(r => "<tr>" + r.map((v, i) =>
            `<td style="${cell}${!title && i === 0 ? ";opacity:.75" : ""}">${esc(String(v ?? ""))}</td>`).join("") + "</tr>").join("") +
          "</table>";
        if (title) {
          body.add(new qx.ui.basic.Label(title).set({ font: "bold", marginTop: 8, selectable: true }));
          plain.push("", title, columns.join("\t"));
        }
        body.add(new qx.ui.basic.Label(html).set({ rich: true, wrap: true, selectable: true, allowGrowX: true }));
        rows.forEach(r => plain.push(title ? r.join("\t") : `${r[0]}: ${r[1]}`));
      };
      table(null, ["Alan", "Değer"], fields, [180, "1*"]);
      if (device.services.length) {
        table(`Açık portlar / servisler (${device.services.length})`, ["Port", "Servis", "Ürün / sürüm", "Ek bilgi"],
          device.services.map(s => [`${s.port}/${s.proto}`, s.service || "", [s.product, s.version].filter(Boolean).join(" "), s.extra || ""]),
          [90, 130, 200, "1*"]);
      }
      if (device.shares && device.shares.length) {
        table(`Ağ paylaşımları (${device.shares.length})`, ["Tür", "Paylaşım", "Açıklama"],
          device.shares.map(sh => [sh.stype === "printer" ? "🖨 yazıcı" : "📁 klasör", sh.path || sh.name, sh.comment || ""]),
          [100, 240, "1*"]);
      }
      win.add(new qx.ui.container.Scroll(body), { flex: 1 });
      const buttons = [];
      const copyAll = new qx.ui.form.Button("Tümünü kopyala").set({ toolTipText: "Tüm ayrıntıları düz metin olarak panoya kopyalar" });
      copyAll.addListener("execute", () => ankamon.util.Clipboard.copy(`Bilgisayar ayrıntıları — ${name}\n` + plain.join("\n")));
      buttons.push(copyAll);
      if (this._can("network.manage")) {
        const edit = new qx.ui.form.Button("Düzenle");
        edit.addListener("execute", () => {
          win.close();
          this.__edit(device);
        });
        buttons.push(edit);
      }
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      buttons.push(close);
      ankamon.ui.Dialog.buttons(win, buttons);
      win.open();
    },

    __rowMenu(device, devices) {
      const menu = new qx.ui.menu.Menu();
      const ICON = ankamon.ui.Shell.ICON;
      const add = (icon, label, handler) => menu.add(ankamon.ui.BoardOps.menuButton(icon, label, handler));
      const count = devices.length > 1 ? ` (${devices.length} cihaz)` : "";
      add(ICON.info, "Bilgisayar ayrıntıları", () => this.__showDetails(device));
      menu.add(new qx.ui.menu.Separator());
      if (device.services.length || (device.shares && device.shares.length)) {
        add("▾", this.__expanded.has(device.id) ? "Ayrıntıları gizle" : "Ayrıntıları göster", () => this.__toggle(device.id));
      }
      // NetBIOS/SMB portu açıksa ağ paylaşımlarını tara (ayrı kanal).
      const smb = device.services.some(s => [139, 445].includes(s.port));
      if (smb && this._can("network.manage")) {
        add("📁", "Ağ paylaşımlarını tara" + count, () => this.__scanShares(devices));
      }
      const web = device.services.find(s => s.proto === "tcp" && [80, 443, 8080, 8443].includes(s.port));
      if (web && device.ip) {
        const scheme = [443, 8443].includes(web.port) ? "https" : "http";
        add("⇗", `Web arayüzünü aç (${web.port})`, () => window.open(`${scheme}://${device.ip}:${web.port}/`, "_blank", "noopener"));
      }
      if (device.ip) {
        add(ICON.copy, "IP adresini kopyala", () => ankamon.util.Clipboard.copy(device.ip));
      }
      add(ICON.copy, "MAC adresini kopyala", () => ankamon.util.Clipboard.copy(device.mac));
      if (this._can("network.manage")) {
        menu.add(new qx.ui.menu.Separator());
        add("⟳", "Servisleri tara" + count, () => this.__scanServices(devices));
        add(ICON.edit, "Düzenle", () => this.__edit(device));
        add(ICON.delete, "Sil" + count, () => this.__remove(devices));
      }
      return menu;
    }
  }
});
