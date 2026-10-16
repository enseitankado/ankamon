/**
 * Tahta envanteri: durum, anlık göstergeler, satır başı onay kutularıyla çoklu seçim, durum + sütun
 * bazlı süzme ve tahta işlemleri. Eski "Uzaktan işlemler" sayfasının işlevi buraya taşındı
 * ("Komut çalıştır" — hazır işlem ve serbest komutu aynı pencerede sunar).
 *
 * Yenilenme: sayfa her açıldığında (activate) + arka planda REFRESH_MS'de bir kendiliğinden.
 *
 * "online" gecikmesi iki ayrı yoldan beslenir (bkz. BoardsApi::FROM):
 *   - Log: rsyslog bir satırı logs tablosuna yazdığı anda (worker'ı beklemeden) tahta "çevrimiçi"
 *     sayılır — API, son 2 dakikadaki logu burada canlı sorgular. Gecikme ≈ REFRESH_MS (bu sayfa).
 *   - Yoklama (SSH/sensör portu): worker/tasks/board_status, log göndermeyen ama erişilebilen
 *     tahtaları STATUS_TICK_SECONDS'ta bir (varsayılan 10 sn) yoklar; çevrimdışıya dönüş,
 *     titremeyi önlemek için üst üste 2 başarısız yoklama ister (bkz. board_status.py).
 * Yeni bir tahtanın burada görünmesi (henüz kayıtlı değilse) ayrıca tasks/boards_from_logs'un
 * WORKER_TICK_SECONDS'ta (varsayılan 60 sn) bir çalışmasını gerektirir — bu yalnız ilk kayıt içindir,
 * var olan tahtanın çevrimiçi/çevrimdışı durumu yukarıdaki iki yoldan çok daha hızlı yansır.
 *
 * "Web terminal": üst araç çubuğunda düğmesi yok, yalnız satır sağ menüsünden açılır (bkz. __rowMenu).
 * O satır işaretli ÇOKLU seçimin bir parçasıysa hepsi için ortak, modal bir pencerede yan yana
 * panolar (toplu komut yazılabilen) çoklu terminal açılır (BoardOps.webshellMulti — bkz. /multishell/);
 * değilse yalnız o tahtanın tekli terminali (BoardOps.webshell) açılır — ikisi de aynı modal pencere
 * deseniyle (BoardOps.__terminalWindow), yeni sekme YOKTUR.
 */
qx.Class.define("tihamon.page.Boards", {
  extend: tihamon.page.Base,

  construct(user) {
    super(user, "Tahtalar");
    this._compact = true; // çok düğmeli araç çubuğu: küçük dolgu/yazı tipiyle daha az yer kaplar.
    this._addButton("Yenile", this.refresh);
    this.__checkAllButton = this._addButton("Tümünü işaretle", () => this._checkAll(this.__table, true));
    this.__uncheckButton = this._addButton("İşaretleri kaldır", () => this._checkAll(this.__table, false));
    if (this._can("boards.manage")) {
      this._addButton("Ekle", () => this.__edit(null));
      this.__editButton = this._addButton("Düzenle", () => this.__single(board => this.__edit(board)));
      this.__deleteButton = this._addButton("Sil", () => this.__withSome(boards => this.__delete(boards)));
    }
    // Çevrimiçiye özgü (SSH gerektiren) ve çevrimdışına özgü (WoL) düğmeler; görünürlükleri işaretli
    // tahtaların gerçek durumuna göre ayarlanır — bkz. __updateActionState.
    // "Web terminal" düğmesi kaldırıldı (kullanıcı isteği) — bkz. __rowMenu/satır sağ menüsü:
    // birden fazla tahta işaretliyken sağ menüden "Web terminal" seçilirse hepsi için ortak terminal
    // açılır (BoardOps.webshellMulti), tek tahta için tekli terminal (BoardOps.webshell).
    this.__onlineButtons = [];
    if (this._can("actions") || this._can("shell")) {
      this.__onlineButtons.push(
        this._addButton("Komut çalıştır", () => tihamon.ui.BoardOps.run(this.__selectedBoards(), this._user))
          .set({ toolTipText: "İşaretli tahtalarda hazır bir işlem ya da serbest komut çalıştırır" }));
    }
    if (this._can("cast")) {
      this.__onlineButtons.push(
        this._addButton("Yansıt", () => this.__withSome(boards => tihamon.ui.BoardOps.cast(boards)))
          .set({ toolTipText: "Bu bilgisayarın ekranını işaretli tahtalarda tam ekran gösterir" }));
    }
    if (this._can("power")) {
      this.__onlineButtons.push(
        this._addButton("Kapat", () => this.__withSome(boards => tihamon.ui.BoardOps.shutdown(boards))));
      this.__wolButton = this._addButton("Uyandır", () => this.__withSome(boards => tihamon.ui.BoardOps.wol(boards)));
    }

    // Sütun tanımları: hem tabloya hem de her sütunun altındaki süzgeç kutusuna aynı dizi verilir.
    // Başlıklar kısa (kullanıcı isteği; ör. üç ayrı "Disk" sütunu); "hint" tam adı verir — sütun
    // gizleme menüsünde ve süzgeç ipucunda o görünür (bkz. Base _createTable/_addColumnFilters).
    this.__columns = [
      { id: "status", label: "Durum", width: 100 },
      { id: "name", label: "Takma ad / Ad" },
      { id: "hostname", label: "Bilgisayar adı", width: 150 },
      { id: "ip", label: "IP", width: 120 },
      { id: "mac", label: "MAC", width: 140 },
      // FATİH fazı (bkz. util.Format.etap — anakart modelinden, yoksa maskelenmiş MAC önekinden).
      { id: "faz", label: "Faz", hint: "FATİH fazı ve tahta markası", width: 130 },
      // Anlık oturum (bkz. worker executor/session_probe.py — 30 sn'de bir SSH ile yoklanır; Oturum aç/
      // kapat/sorgula sonuçları da hemen yazar): kullanıcı adı, "(kilitli)" ya da "Oturum kapalı".
      { id: "session", label: "Oturum", width: 140 },
      // Wi-Fi kartı etkin mi (bkz. ui.FactsView.wifiStatus — Bilgi kartıyla aynı kural). Donanım
      // bilgisiyle birlikte toplanır; Wi-Fi aç/kapat işlemi sonrası runner hemen günceller.
      { id: "wifi", label: "Wi-Fi", width: 110 },
      // Donanım bilgisi (bkz. worker/tihamon/executor/hwfacts.py): tahta ilk kez tanınırken (MAC
      // öğrenilirken) bir kez SSH ile toplanır; satır sağ menüsündeki "Bilgi kartı" bunu canlı
      // tazeler (60dk önbellekli). Değer yoksa (henüz toplanmadıysa) hücre boş kalır.
      { id: "disk_total", label: "Disk", hint: "Disk kapasitesi", width: 110 },
      { id: "ram_total", label: "RAM", hint: "RAM miktarı", width: 90 },
      { id: "bios", label: "BIOS", hint: "BIOS sürümü", width: 130 },
      { id: "kernel", label: "Çekirdek", hint: "Çekirdek sürümü", width: 150 },
      { id: "board_model", label: "Anakart modeli", width: 170 },
      { id: "cpu_model", label: "İşlemci modeli", width: 180 },
      // cpu_phys_cores (FİZİKSEL çekirdek) — cpu_cores mantıksal/iş parçacığı sayısıdır (nproc,
      // Hyper-Threading'de fiziksel olandan büyük çıkar, ör. i3-4000M: 2 fiziksel/4 mantıksal).
      // "CPU core" etiketi kullanıcının beklediği anlamla (fiziksel) eşleşsin diye bu kullanılır.
      { id: "cpu_phys_cores", label: "CPU core", hint: "Fiziksel çekirdek sayısı", width: 110 },
      { id: "cpu", label: "İşlemci", width: 80 },
      { id: "mem", label: "Bellek", width: 80 },
      { id: "disk", label: "Disk", hint: "Disk doluluğu", width: 70 },
      // Sensörler (bkz. backend Core/BoardSensors.php). Fan/pil/anakart, tahtada Super I/O sürücüsü
      // yüklüyse gelir ("Fan/pil/anakart sensörlerini etkinleştir" işlemi); Kasa yoksa ACPI bölgesidir.
      { id: "temp", label: "CPU sıcaklığı", width: 100 },
      { id: "case_temp", label: "Kasa", hint: "Kasa sıcaklığı", width: 100 },
      { id: "disk_temp", label: "Disk", hint: "Disk sıcaklığı", width: 100 },
      { id: "fan_rpm", label: "Fan", hint: "Fan devri", width: 90 },
      { id: "battery_v", label: "CMOS pili", width: 80 },
      { id: "seen", label: "Son görülme", width: 120 },
      { id: "log", label: "Son log", width: 120 }
    ];
    // storageKey: sütun genişliği + görünürlüğü localStorage'da kalıcı olur, sütun görünürlüğü
    // menüsü açılır (bkz. Base.js _createTable).
    this.__table = this._createTable(this.__columns, { checkable: true, storageKey: "boards.columns" });
    // Hiç tahta işaretli değilken tekli/çoklu işlem düğmeleri (Düzenle, Sil, Web terminal, İşlem
    // çalıştır, Kapat, Uyandır) devre dışı kalır; Düzenle yalnız tam 1 işaretliyken etkinleşir;
    // diğerleri 1 ya da daha fazla işaretli olunca etkinleşir — bkz. __updateActionState.
    this.__table.getTableModel().addListener("dataChanged", this.__updateActionState, this);
    this.__table.addListener("cellDbltap", e => {
      if (this._can("boards.manage")) {
        const id = this.__table.getTableModel().getValue(0, e.getRow());
        this.__edit(this.__boards.get(id));
      }
    });
    // Satır sağ menüsü: ağaçtaki tahta düğümüyle aynı menü (Web terminal / Komut çalıştır / Kapat / WoL)
    // + bu sayfaya özgü kayıt işlemleri (Düzenle / Sil) — bkz. __rowMenu. Sağ tıklanan satır onay
    // kutusuyla işaretli ÇOKLU seçimin bir parçasıysa, "Web terminal" o seçimin TÜMÜ için açılır.
    this.__table.addListener("cellContextmenu", e => {
      if (e.getRow() === null) {
        return;
      }
      const id = this.__table.getTableModel().getValue(0, e.getRow());
      const board = this.__boards.get(id);
      if (!board) {
        this.__table.setContextMenu(null);
        return;
      }
      const checkedIds = this._checkedIds(this.__table);
      const boards = checkedIds.includes(id) && checkedIds.length > 1
        ? checkedIds.map(cid => this.__boards.get(cid)).filter(Boolean)
        : [board];
      this.__table.setContextMenu(this.__rowMenu(board, boards));
    });

    // Süzgeç kutuları artık her sütunun kendi başlık hücresinin içinde (bkz. Base.js
    // _addColumnFilters) — ayrı bir satır/widget olarak sayfaya eklenmesi gerekmez.
    this.__filterFields = this._addColumnFilters(this.__table, this.__columns, this.__apply);

    // İki sekme: "Liste" (grid) ve "Ekranlar" (grid'deki tahtaların canlı ekran önizlemeleri).
    // Araç çubuğu sekmelerin üstünde kalır; işaretli tahtalara her iki sekmeden de uygulanır.
    const tabs = new qx.ui.tabview.TabView().set({ contentPadding: 0 });
    const listPage = new qx.ui.tabview.Page("Liste");
    listPage.setLayout(new qx.ui.layout.VBox(8));
    listPage.setPadding([8, 8, 0, 8]);
    listPage.add(this.__table, { flex: 1 });
    this.__note = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true, wrap: true });
    listPage.add(this.__note);
    tabs.add(listPage);
    this.__tabView = tabs;
    this.__listPage = listPage;
    if (this._can("screen")) {
      tabs.add(this.__createScreensPage());
    }
    this.add(tabs, { flex: 1 });

    // Sayfa açık kalsa bile kendiliğinden tazelenir (bkz. sınıf başı not — worker zinciriyle birlikte).
    this.__timer = new qx.event.Timer(tihamon.page.Boards.REFRESH_MS);
    this.__timer.addListener("interval", this.refresh, this);
    this.__timer.start();

    this.__updateActionState(); // başlangıçta hiç satır işaretli değil: ilgili düğmeler devre dışı.
  },

  statics: {
    /**
     * "Oturum" sütununun metni: çevrimdışı ya da henüz yoklanmamış tahtada boş (bilinmiyor), oturum
     * yoksa "Oturum kapalı", varsa kullanıcı adı — ekran kilitliyse "(kilitli)" ekiyle.
     */
    sessionText(board) {
      if (!board.online || !board.session_checked_at) {
        return "";
      }
      if (!board.session_username) {
        return "Oturum kapalı";
      }
      return board.session_locked ? `${board.session_username} (kilitli)` : board.session_username;
    },

    // "Ekranlar" sekmesi görünmez olduktan (başka sekme/sayfa) bu kadar sonra önizleme akışları durur.
    SCREENS_STOP_MS: 10000,

    // "online" artık API'de canlı hesaplanıyor (bkz. sınıf başı not); bu süre doğrudan algılama
    // gecikmesine eklenir, o yüzden eskisinden (20000) küçültüldü.
    REFRESH_MS: 5000
  },

  destruct() {
    if (this.__timer) {
      this.__timer.stop();
      this.__timer.dispose();
    }
    if (this.__screensTimer) {
      this.__screensTimer.stop();
      this.__screensTimer.dispose();
    }
    if (this.__onMessage) {
      window.removeEventListener("message", this.__onMessage);
    }
  },

  members: {
    __timer: null,
    __table: null,
    __note: null,
    __columns: null,
    __filterFields: null,
    __tabView: null,
    __listPage: null,

    /**
     * Shell OPEN_PAGE (Genel bakış kartları): Liste sekmesine geçer ve Durum süzgecini verilen
     * metne ("Çevrimiçi" | "Kapalı" | "" = hepsi) ayarlar; diğer sütun süzgeçleri temizlenir.
     * Süzgeç kutuları başlık ilk çizildiğinde oluşur (bkz. Base._addColumnFilters) — henüz yoksa
     * kısa aralıklarla yeniden denenir.
     */
    openWith(opts, tries = 0) {
      if (!("status" in opts)) {
        return;
      }
      this.__tabView.setSelection([this.__listPage]);
      const fields = this.__filterFields || {};
      if (!fields.status) {
        if (tries < 20) {
          qx.event.Timer.once(() => this.openWith(opts, tries + 1), this, 100);
        }
        return;
      }
      Object.entries(fields).forEach(([id, field]) => field.setValue(id === "status" ? opts.status : ""));
    },
    __boards: null,
    __rows: null,
    __onlineButtons: null,
    __wolButton: null,
    __editButton: null,
    __deleteButton: null,
    __uncheckButton: null,
    __screensPage: null,
    __screenView: null,
    __frame: null,
    __screensTimer: null,
    __screensHiddenAt: null,
    __screensRunning: false,
    __previewKey: null,
    __previewMenu: null,
    __onMessage: null,
    __shownBoards: null,
    __checkAllButton: null,
    __whoamiState: null,
    __liveQueue: null,
    __applyingPreview: false,
    __metrics: null,

    async _refresh() {
      const F = tihamon.util.Format;
      // Kendiliğinden tazelemede kullanıcının o anki işaretlemeleri kaybolmasın.
      const wasChecked = this.__table ? new Set(this._checkedIds(this.__table)) : new Set();
      const [boards, metrics] = await Promise.all([
        tihamon.io.Api.get("/boards"),
        tihamon.io.Api.get("/metrics/latest")
      ]);
      this.__boards = new Map(boards.boards.map(b => [b.id, b]));
      this.__metrics = metrics.latest || {};
      const unit = (v, suffix) => v === null || v === undefined ? "" : v + suffix;
      // cells[0]=kimlik, cells[1]=onay kutusu, cells[2..]=sütunlar.
      this.__rows = boards.boards.map(board => {
        const m = metrics.latest[board.id] || {};
        return {
          board,
          cells: [
            board.id, wasChecked.has(board.id),
            board.online ? "Çevrimiçi" : "Kapalı",
            board.label || board.hostname || board.ip,
            board.hostname, board.ip, board.mac, F.etap(board.etap),
            tihamon.page.Boards.sessionText(board),
            (tihamon.ui.FactsView.wifiStatus(board.facts) || { text: "" }).text,
            board.facts.disk_total_bytes ? F.bytes(board.facts.disk_total_bytes) : "",
            board.facts.mem_total_bytes ? F.bytes(board.facts.mem_total_bytes) : "",
            board.facts.bios_version || "", board.facts.kernel_version || "", board.facts.motherboard_model || "",
            board.facts.cpu_model || "", board.facts.cpu_phys_cores || "",
            F.percent(m.cpu_percent), F.percent(m.mem_percent), F.percent(m.disk_percent),
            unit(m.cpu_temp, " °C"), unit(m.case_temp, " °C"), unit(m.disk_temp, " °C"),
            unit(m.fan_rpm, " RPM"), m.battery_v === null || m.battery_v === undefined ? "" : m.battery_v.toFixed(2) + " V",
            F.ago(board.last_seen_at), F.ago(board.last_log_at)
          ]
        };
      });
      this.__apply();
      this.__note.setValue(boards.boards.length ? "" :
        "Henüz kayıtlı tahta yok. Tahtalar log göndermeye başladığında kendiliğinden listelenir; elle de ekleyebilirsiniz.");
    },

    /** Her sütunun altındaki metin kutularını (Excel tarzı sütun filtresi) uygular. */
    __apply() {
      if (!this.__rows) {
        return;
      }
      // cells[0] kimlik, cells[1] onay kutusu; sütun i'nin değeri cells[i + 2]'dedir.
      const colFilters = this.__columns
        .map((column, index) => ({ index: index + 2, text: (this.__filterFields[column.id].getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);

      const shown = this.__rows.filter(({ cells }) =>
        colFilters.every(f => String(cells[f.index] ?? "").toLowerCase().includes(f.text)));
      this.__table.getTableModel().setData(shown.map(r => r.cells));
      this.__shownBoards = shown.map(r => r.board);
      this.__pushPreview();
      // "Tümünü işaretle" o anda GÖRÜNEN (süzülmüş) satır sayısını gösterir — _checkAll de yalnız
      // bunları işaretler, gizli/süzülmüş satırları değil.
      if (this.__checkAllButton) {
        this.__checkAllButton.setLabel(shown.length ? `Tümünü işaretle (${shown.length})` : "Tümünü işaretle");
      }
    },

    /**
     * "Ekranlar" sekmesi: grid'de o an listelenen (süzülmüş) tahtaların canlı ekran önizlemeleri.
     * Önizlemeler /screen/ sayfasının gömülü kipidir (spec.embed, q=thumb — küçük ve düşük kare hızlı;
     * komut loguna yazılmaz, bkz. ekran köprüsü nolog). Sekme görünmez olunca (Liste sekmesi ya da
     * başka bir sayfa) SCREENS_STOP_MS sonra iframe boşaltılır: bütün akışlar ve tahtalardaki
     * x11vnc'ler kapanır (yük tasarrufu); sekmeye dönülünce yeniden başlar.
     * Kutucuk sağ menüsü grid satırınınkiyle AYNI (__rowMenu); "Oturum… ▸ Oturumları sorgula" (bkz.
     * __openPreviewMenu, BoardOps.menu) — SSH ile anlık sorgu sonucu (bkz. __whoamiState, worker/tihamon/executor/
     * whoami.py) sol altta gösterilir (bkz. __previewList, docker/rootfs/screen'de Tile.setWhoami).
     * "Oturum aç"/"Oturumu kapat" da önizlemeden açılınca iş penceresi açmaz; ilerleme ve sonuç aynı
     * yerde görünür (bkz. __sessionJob). Eskiden board_sessions'ın (log tabanlı)
     * kaydı otomatik gösteriliyordu; bazen yanlış/bayat çıktığı bildirildiğinden kaldırıldı — artık
     * yalnız kullanıcı isteğiyle, anlık sorgulanır.
     *
     * Kutucuklar tıklanınca seçilir (Shift ile aralık, Ctrl ile tekli ekleme, boş alana basılı
     * tutup sürükleyerek dikdörtgenle çoklu seçim — hepsi iframe içinde, bkz. docker/rootfs/
     * screen/index.html). Çoklu seçimde sağ menünün toplu etki gösteren maddeleri (bkz. __rowMenu/
     * BoardOps.menu) seçili TÜM tahtalara uygulanır. Kutucuklar sürükle-bırakla yeniden sıralanabilir;
     * yeni sıra "tm-reorder" ile buraya iletilip kullanıcı başına kalıcı kaydedilir (bkz.
     * __saveScreenOrder, AuthApi::screenOrder) — __previewList bu sırayı uygular.
     */
    __createScreensPage() {
      const page = new qx.ui.tabview.Page("Ekranlar");
      page.setLayout(new qx.ui.layout.VBox());
      page.setPadding([8, 0, 0, 0]);
      // qx.ui.embed.Iframe yerine düz <iframe> (Html bileşeni): Iframe her pointerdown'da üstüne saydam
      // bir "blocker" koyuyor ve sekme düğmesine tıklandıktan sonra bu katman açık kalıp kutucuklara
      // tıklama/sağ tığı yutuyordu (ölçüldü). Html bileşeninde böyle bir katman yok.
      this.__frame = new qx.ui.embed.Html("").set({ overflowX: "hidden", overflowY: "hidden" });
      page.add(this.__createScreensToolbar());
      page.add(this.__frame, { flex: 1 });
      page.add(this.__createSizeRow());
      this.__screensPage = page;
      this.__screenOrder = (this._user && this._user.screen_order) || [];

      this.__onMessage = e => {
        const el = this.__iframeEl();
        if (!el || e.source !== el.contentWindow || e.origin !== window.location.origin || !e.data) {
          return;
        }
        if (e.data.type === "tm-ready") {
          this.__previewKey = null; // sayfa yeni yüklendi: güncel listeyi yeniden gönder
          this.__pushPreview();
          this.__pushSize();
          this.__pushView();
          this.__pushSelection();
        } else if (e.data.type === "tm-select") {
          this.__checkFromPreview(e.data.ids || []);
        } else if (e.data.type === "tm-click") {
          qx.ui.menu.Manager.getInstance().hideAll();
        } else if (e.data.type === "tm-menu") {
          this.__openPreviewMenu(e.data.id, e.data.x, e.data.y, e.data.ids);
        } else if (e.data.type === "tm-reorder") {
          this.__saveScreenOrder(e.data.order || []);
        } else if (e.data.type === "tm-live") {
          this.__queueLiveWhoami(e.data.id);
        }
      };
      window.addEventListener("message", this.__onMessage);

      // Görünürlük yoklaması: hem sekme değişimini hem Shell'deki sayfa değişimini yakalar.
      this.__screensTimer = new qx.event.Timer(1000);
      this.__screensTimer.addListener("interval", this.__checkScreens, this);
      this.__screensTimer.start();
      return page;
    },

    /**
     * "Ekranlar" sekmesinin üstündeki araç çubuğu — aç/kapa düğmeleri (Başarım seçimi tarayıcıda kalıcı):
     *  - Donanım (her açılışta basılı): kutucukların altındaki CPU/RAM/HDD/voltaj barı.
     *  - Başarım: kutucuğun ekran alanında htop'un üst panelleri, saniyelik (bkz. screen/index.html
     *    Tile.syncPerf, worker/tihamon/screen/perf.py — yalnız açıkken ve görünen tahtalar için SSH açılır).
     */
    __createScreensToolbar() {
      const bar = new qx.ui.toolbar.ToolBar();
      const part = new qx.ui.toolbar.Part();
      bar.add(part);
      const saved = this.__loadScreenView();
      const make = (label, tip, key) => {
        // Basılı olmayan düğme soluk: bazı temalarda toolbar CheckBox'ın "checked" görünümü belirgin değil.
        const btn = new qx.ui.toolbar.CheckBox(label).set({ value: saved[key], toolTipText: tip, opacity: saved[key] ? 1 : 0.5 });
        btn.addListener("changeValue", e => {
          btn.setOpacity(e.getData() ? 1 : 0.5);
          this.__screenView[key] = e.getData();
          this.__saveScreenView();
          this.__pushView();
        });
        part.add(btn);
      };
      this.__screenView = saved;
      make("🖥 Donanım", "Kutucukların altında işlemci, bellek, disk sıcaklığı ve pil voltajı barı", "stats");
      make("📈 Başarım", "Ekran alanında tahtanın anlık işlemci çekirdekleri, bellek, görevler ve yük (htop gibi, saniyelik)", "perf");
      return bar;
    },

    __loadScreenView() {
      const view = { stats: true, perf: false };
      try {
        Object.assign(view, JSON.parse(localStorage.getItem("tihamon.boards.screenView") || "{}"));
      } catch (e) {
        // localStorage erişilemiyor ya da bozuk — varsayılana düş.
      }
      // Donanım barı her açılışta basılı başlar (kullanıcı isteği: varsayılan etkin) — kapatılması
      // yalnız o oturum için geçerlidir; Başarım seçimi kalıcıdır.
      return { stats: true, perf: view.perf === true };
    },

    __saveScreenView() {
      try {
        localStorage.setItem("tihamon.boards.screenView", JSON.stringify(this.__screenView));
      } catch (e) {
        // sorun değil — yalnız kalıcılık kaybolur.
      }
    },

    __pushView() {
      const el = this.__iframeEl();
      if (el && el.contentWindow && this.__screenView) {
        el.contentWindow.postMessage(Object.assign({ type: "tm-view" }, this.__screenView), window.location.origin);
      }
    },

    /** "Ekranlar" sekmesinin altındaki, önizleme kutucuklarının boyutunu ayarlayan slider satırı. */
    __createSizeRow() {
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" })).set({
        padding: [4, 8]
      });
      row.add(new qx.ui.basic.Label("Boyut:"));
      const slider = new qx.ui.form.Slider().set({
        minimum: 140, maximum: 640, singleStep: 10, value: this.__loadTileSize(), width: 220
      });
      slider.addListener("changeValue", e => {
        const v = e.getData();
        this.__tileSize = v;
        this.__saveTileSize(v);
        this.__pushSize();
      });
      this.__tileSize = slider.getValue();
      row.add(slider);
      return row;
    },

    __loadTileSize() {
      try {
        const v = parseInt(localStorage.getItem("tihamon.boards.screenTileSize"), 10);
        if (v && v >= 140 && v <= 640) {
          return v;
        }
      } catch (e) {
        // localStorage erişilemiyor olabilir — varsayılana düş.
      }
      return 300;
    },

    __saveTileSize(v) {
      try {
        localStorage.setItem("tihamon.boards.screenTileSize", String(v));
      } catch (e) {
        // sorun değil — yalnız kalıcılık kaybolur.
      }
    },

    /**
     * Kutucuk seçimi ile grid onay kutuları TEK seçimdir (kullanıcı isteği): araç çubuğundaki
     * Tümünü işaretle / İşaretleri kaldır / Sil / Komut çalıştır / Kapat / Uyandır, Ekranlar
     * sekmesinde seçili kutucuklara da uygulansın. iframe'de seçim değişince ("tm-select") grid
     * işaretleri ona eşitlenir; grid işaretleri değişince (tablo modelinin dataChanged'i — bkz.
     * constructor) __pushSelection kutucuklara yansıtır. Döngü olmaz: iframe, üst sayfadan gelen
     * seçimi geri bildirmez (bkz. screen/index.html setSelected fromParent).
     */
    __checkFromPreview(ids) {
      const want = new Set(ids);
      const tm = this.__table.getTableModel();
      this.__applyingPreview = true;
      try {
        for (let row = 0; row < tm.getRowCount(); row++) {
          const on = want.has(tm.getValue(0, row));
          if (!!tm.getValue(1, row) !== on) {
            tm.setValue(1, row, on);
          }
        }
      } finally {
        this.__applyingPreview = false;
      }
      this.__updateActionState();
    },

    /** Grid'deki işaretli tahtaları önizleme kutucuklarına seçili olarak bildirir (bkz. __checkFromPreview). */
    __pushSelection() {
      if (this.__applyingPreview || !this.__screensRunning) {
        return;
      }
      const el = this.__iframeEl();
      if (el && el.contentWindow) {
        el.contentWindow.postMessage({ type: "tm-selection", ids: this._checkedIds(this.__table) },
          window.location.origin);
      }
    },

    /** Önizleme kutucuklarının boyutunu (CSS değişkeni --tile-min) iframe'e bildirir. */
    __pushSize() {
      const el = this.__iframeEl();
      if (el && el.contentWindow) {
        el.contentWindow.postMessage({ type: "tm-size", px: this.__tileSize }, window.location.origin);
      }
    },

    /**
     * Kutucukların sürükle-bırakla değiştirilen sırasını kullanıcı başına kalıcı kaydeder (bkz.
     * AuthApi::screenOrder, nav_order ile aynı desen). __previewList bu sırayı bir dahaki
     * __pushPreview'da uygular.
     */
    async __saveScreenOrder(shownOrder) {
      // iframe yalnız GÖSTERİLEN (süzülmüş) kutucukların sırasını bilir; süzgeçle gizli tahtaların
      // önceki kayıtlı sırası kaybolmasın diye onlar sona eklenir.
      const shown = new Set(shownOrder);
      const order = shownOrder.concat((this.__screenOrder || []).filter(id => !shown.has(id)));
      this.__screenOrder = order;
      try {
        await tihamon.io.Api.put("/auth/screen-order", { order });
      } catch (e) {
        // sessizce yok sayılır — sıradaki sürükleme yine gönderir, kalıcılık kaybı önemsiz.
      }
    },

    __iframeEl() {
      const dom = this.__frame && this.__frame.getContentElement().getDomElement();
      return dom ? dom.querySelector("iframe") : null;
    },

    __checkScreens() {
      // TabView seçili olmayan sayfayı "hidden" yapar ve isSeeable() bunu yakalamaz; Shell sayfa
      // değiştirince ise üst kapsayıcı "excluded" olur ve onu isSeeable() yakalar — ikisine de bakılır.
      const page = this.__screensPage;
      const seen = page.getVisibility() === "visible" && page.isSeeable() && !document.hidden;
      if (seen) {
        this.__screensHiddenAt = null;
        if (!this.__screensRunning) {
          this.__startPreview();
        }
      } else if (this.__screensRunning) {
        const now = Date.now();
        if (this.__screensHiddenAt === null) {
          this.__screensHiddenAt = now;
        } else if (now - this.__screensHiddenAt >= tihamon.page.Boards.SCREENS_STOP_MS) {
          this.__stopPreview();
        }
      }
    },

    /**
     * Grid'in süzgeç/sıralamadan gelen DOĞAL sırasına, kullanıcının sürükle-bırakla değiştirdiği
     * kalıcı sırayı (bkz. __screenOrder, AuthApi::screenOrder) uygular: __screenOrder'da olan
     * tahtalar önce o sırayla, OLMAYANLAR (yeni tahta, henüz hiç sıralanmamış) doğal sırayla sona
     * eklenir — nav_order/__orderedPages ile aynı mantık (bkz. ui/Shell.js).
     */
    __previewList() {
      const whoami = this.__whoamiState || new Map();
      const shown = this.__shownBoards || [];
      const byId = new Map(shown.map(b => [b.id, b]));
      const ordered = [];
      (this.__screenOrder || []).forEach(id => {
        const b = byId.get(id);
        if (b) {
          ordered.push(b);
          byId.delete(id);
        }
      });
      shown.forEach(b => {
        if (byId.has(b.id)) {
          ordered.push(b);
        }
      });
      const metrics = this.__metrics || {};
      return ordered.map(b => {
        // Kutucuğun alt barı (bkz. screen/index.html Tile.setStats): grid'in İşlemci/Bellek/sensör
        // sütunlarıyla aynı son ölçümler — yalnız çevrimiçi tahtada (eski ölçüm kapalı tahtada yanıltır).
        const m = b.online ? metrics[b.id] : null;
        return {
          id: b.id, name: b.label || b.hostname || b.ip || ("#" + b.id), online: !!b.online,
          whoami: whoami.get(b.id) || null,
          stats: m ? {
            cpu: m.cpu_percent ?? null, mem: m.mem_percent ?? null, temp: m.cpu_temp ?? m.temp_max ?? null,
            disk_temp: m.disk_temp ?? null, fan: m.fan_rpm ?? null, battery: m.battery_v ?? null
          } : null
        };
      });
    },

    __startPreview() {
      const control = this._user.is_admin || this._user.features.includes("screen.control");
      const spec = { boards: this.__previewList(), q: "thumb", control, embed: true };
      this.__screensRunning = true;
      this.__previewKey = JSON.stringify(spec.boards);
      const url = "/screen/#" + btoa(unescape(encodeURIComponent(JSON.stringify(spec))));
      // "allow=fullscreen": kutucuktaki tam ekran düğmesi iframe içinden ancak bu izinle çalışır.
      this.__frame.setHtml(`<iframe src="${url}" allow="fullscreen" allowfullscreen ` +
        `style="border:0;width:100%;height:100%;display:block"></iframe>`);
    },

    __stopPreview() {
      this.__screensRunning = false;
      this.__screensHiddenAt = null;
      // iframe kaldırılır: bütün WebSocket'ler ve tahtalardaki x11vnc'ler kapanır. qooxdoo gizli
      // bileşenin içerik değişikliğini görünür olana dek ertelediği için (setHtml tek başına sekme
      // gizliyken DOM'a yansımıyordu — ölçüldü) iframe DOM'dan doğrudan da kaldırılır.
      const el = this.__iframeEl();
      if (el) {
        el.src = "about:blank";
        el.remove();
      }
      this.__frame.setHtml("");
    },

    /** Grid'in tahta listesi (süzgeç/yenileme) değiştiyse önizleme sayfasına bildirir; yalnız fark varsa. */
    __pushPreview() {
      if (!this.__frame || !this.__screensRunning) {
        return;
      }
      const list = this.__previewList();
      const key = JSON.stringify(list);
      const el = this.__iframeEl();
      if (key === this.__previewKey || !el || !el.contentWindow) {
        return;
      }
      this.__previewKey = key;
      // Sayfa henüz yükleniyorsa mesaj kaybolabilir; sayfa hazır olunca "tm-ready" ile yeniden ister.
      el.contentWindow.postMessage({ type: "tm-boards", boards: list }, window.location.origin);
    },

    /**
     * Önizleme kutucuğunun sağ menüsü — grid satırınınkiyle AYNI (__rowMenu); yalnız "Oturum…" altındaki
     * Oturum aç / Oturumu kapat / Oturumları sorgula burada sessionOps ile iş penceresi yerine kutucuk
     * durumuna yönlendirilir (bkz. __sessionOps). Çoklu seçim: iframe'de Shift/Ctrl ile seçilenler (bkz.
     * docker/rootfs/screen/index.html "tm-menu").
     * @param ids {Array?} iframe'deki o anki çoklu seçim (sağ tıklanan dahil); verilmezse/tek
     *   elemanlıysa yalnız bu tek tahta — bkz. BoardOps.menu boards parametresiyle aynı desen.
     */
    __openPreviewMenu(id, x, y, ids) {
      const board = this.__boards && this.__boards.get(id);
      if (!board) {
        return;
      }
      const boards = ids && ids.length > 1 ? ids.map(i => this.__boards.get(i)).filter(Boolean) : [board];
      const menu = this.__rowMenu(board, boards, this.__sessionOps());
      if (!menu) {
        return; // hiç yetki yok: boş menü açılmaz
      }
      if (this.__previewMenu) {
        const old = this.__previewMenu;
        qx.event.Timer.once(() => old.destroy(), null, 0);
      }
      this.__previewMenu = menu;
      const el = this.__iframeEl();
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      menu.openAtPoint({ left: Math.round(rect.left + x), top: Math.round(rect.top + y) });
    },

    /** "Oturumları sorgula": seçili tahtalarda o an oturum açmış kullanıcıyı paralel sorgular;
     * eşzamanlılık worker'da yüke göre dinamik (bkz. whoami.dynamic_concurrency). */
    __startWhoamiQuery(boardIds, quiet = false) {
      this.__sessionJob(boardIds, { type: "whoami" }, () => "Oturum sorgulanıyor…",
        t => (t.status === "ok" ? { status: "ok", text: t.output } : { status: "error", text: "Sorgulanamadı" }), quiet);
    },

    /**
     * Ekranlar kutucuğu "Bağlanıyor…"dan canlıya geçti ("tm-live", bkz. screen/index.html connect): o tahtanın
     * oturumu kendiliğinden sorgulanır. Aynı anda bağlanan kutucuklar 1,5 sn içinde TEK işte toplanır; zaten
     * sorgulanan/işlem süren tahta atlanır; hata penceresi açılmaz (kutucukta "Başlatılamadı" görünür).
     */
    __queueLiveWhoami(id) {
      const board = this.__boards.get(id);
      const st = this.__whoamiState && this.__whoamiState.get(id);
      if (!board || !board.online || !this._can("screen") || (st && st.status === "querying")) {
        return;
      }
      if (!this.__liveQueue) {
        this.__liveQueue = new Set();
        qx.event.Timer.once(() => {
          const ids = [...this.__liveQueue];
          this.__liveQueue = null;
          this.__startWhoamiQuery(ids, true);
        }, this, 1500);
      }
      this.__liveQueue.add(id);
    },

    /**
     * BoardOps.menu'ye verilen önizleme işleyicileri: "Oturum aç"/"Oturumu kapat" onaydan sonra iş
     * penceresi açmadan çalışır; kutucuğun sol altında "x oturumu açılıyor/kapatılıyor…", bitince
     * kullanıcı adı (ya da "Oturum açık kullanıcı yok") görünür.
     */
    __sessionOps() {
      const known = id => {
        const st = this.__whoamiState && this.__whoamiState.get(id);
        return st && st.status === "ok" && st.text ? st.text : "";
      };
      return {
        query: boards => this.__startWhoamiQuery(boards.map(b => b.id)),
        login: (boards, acc) => this.__sessionJob(boards.map(b => b.id), { type: "login", username: acc.name },
          () => `${acc.name} oturumu açılıyor…`,
          t => (t.status === "ok" ? { status: "ok", text: acc.name } : { status: "error", text: "Oturum açılamadı" })),
        logout: boards => this.__sessionJob(boards.map(b => b.id), { type: "logout" },
          id => (known(id) ? `${known(id)} oturumu kapatılıyor…` : "Oturum kapatılıyor…"),
          t => (t.status === "ok" ? { status: "ok", text: "" } : { status: "error", text: "Oturum kapatılamadı" })),
        // Kilitte oturum açık kalır: kutucukta kullanıcı adı "(kilitli)" ile görünür (çıktının ilk satırı).
        lock: boards => this.__sessionJob(boards.map(b => b.id), { type: "lock" },
          id => (known(id) ? `${known(id)} oturumu kilitleniyor…` : "Oturum kilitleniyor…"),
          t => {
            const user = ((t.output || "").split("\n")[0] || "").trim();
            return t.status === "ok" ? { status: "ok", text: user ? `${user} (kilitli)` : "" } : { status: "error", text: "Kilitlenemedi" };
          })
      };
    },

    /**
     * Tahta başına tek satırlık sonuç üreten bir görevi (whoami/login/logout) kuyruğa alır; tahtalar
     * hemen `pendingText(id)` durumuna geçer, sonuçlar __pollSession ile bitirdikçe `resultOf(target)`
     * ile kutucuklara yansır (bkz. __whoamiState, __previewList).
     */
    async __sessionJob(boardIds, body, pendingText, resultOf, quiet = false) {
      if (!boardIds.length) {
        return;
      }
      if (!this.__whoamiState) {
        this.__whoamiState = new Map();
      }
      boardIds.forEach(id => this.__whoamiState.set(id, { status: "querying", text: pendingText(id) }));
      this.__pushPreview();
      let res;
      try {
        res = await tihamon.io.Api.post("/jobs", Object.assign({ board_ids: boardIds }, body));
      } catch (e) {
        boardIds.forEach(id => this.__whoamiState.set(id, { status: "error", text: "Başlatılamadı" }));
        this.__pushPreview();
        if (!quiet) {
          tihamon.ui.Dialog.error(e);
        }
        return;
      }
      this.__pollSession(res.id, new Set(boardIds), resultOf);
    },

    /** /api/jobs/{id}'yi kısa aralıkla okur; bitiren her tahtanın sonucunu ANINDA (en yavaşı
     * beklemeden) yansıtır — hepsi bitince kendiliğinden durur (bkz. ui.Jobs'taki aynı desen). */
    __pollSession(jobId, pending, resultOf) {
      tihamon.io.Api.get(`/jobs/${jobId}`).then(res => {
        let changed = false;
        ((res.job && res.job.targets) || []).forEach(t => {
          if (!pending.has(t.board_id) || ["queued", "running"].includes(t.status)) {
            return;
          }
          pending.delete(t.board_id);
          this.__whoamiState.set(t.board_id, resultOf(t));
          changed = true;
        });
        if (changed) {
          this.__pushPreview();
        }
        if (pending.size) {
          qx.event.Timer.once(() => this.__pollSession(jobId, pending, resultOf), this, 800);
        }
      }).catch(() => {
        // Ağ/istek hatası: kalanları hata say, kullanıcıyı sonsuza dek "sürüyor" durumunda bırakma.
        pending.forEach(id => this.__whoamiState.set(id, { status: "error", text: "Sonuç alınamadı" }));
        this.__pushPreview();
      });
    },

    /** İşaretli satırlara karşılık gelen tahta nesneleri. */
    __selectedBoards() {
      return this._checkedIds(this.__table).map(id => this.__boards.get(id)).filter(Boolean);
    },

    /**
     * İşaretli satır sayısına ve durumuna göre düğmeleri etkin/devre dışı + görünür/gizli yapar:
     * hiçbiri işaretli değilken Düzenle/Sil/Web terminal/Komut çalıştır/Kapat/Uyandır devre dışı;
     * Düzenle yalnız tam 1 işaretliyken, diğerleri 1 ya da daha fazla işaretliyken etkin. SSH
     * gerektiren düğmeler (Web terminal, Komut çalıştır, Kapat) yalnız işaretlilerden en az biri
     * çevrimiçiyse görünür; Uyandır yalnız en az biri çevrimdışıyken (eskiden ayrı bir Durum süzgecine
     * bakılıyordu — artık doğrudan işaretli tahtaların kendi durumuna bakılıyor, süzgeçten bağımsız).
     * Tablo modelinin "dataChanged" olayına bağlıdır (onay kutusu tıklaması, Tümünü işaretle/kaldır,
     * süzgeç/yenileme — hepsi bu olayı tetikler).
     */
    __updateActionState() {
      if (this.__applyingPreview) {
        return; // __checkFromPreview satır satır işaretlerken her satırda değil, sonunda bir kez
      }
      this.__pushSelection();
      const boards = this.__selectedBoards();
      const count = boards.length;
      if (this.__editButton) {
        this.__editButton.setEnabled(count === 1);
      }
      const showOnline = count === 0 || boards.some(b => b.online);
      const showWol = count === 0 || boards.some(b => !b.online);
      (this.__onlineButtons || []).forEach(b => b.setVisibility(showOnline ? "visible" : "excluded"));
      if (this.__wolButton) {
        this.__wolButton.setVisibility(showWol ? "visible" : "excluded");
      }
      // Seçime göre çalışan düğmeler etiketinde işaretli tahta sayısını gösterir: "Sil (3)".
      // Düzenle her zaman tek tahtaya çalıştığı için sayı almaz.
      const counted = [this.__deleteButton, this.__wolButton, this.__uncheckButton]
        .concat(this.__onlineButtons || []).filter(Boolean);
      counted.forEach(button => {
        if (button.getUserData("baseLabel") === null) {
          button.setUserData("baseLabel", button.getLabel());
        }
        const base = button.getUserData("baseLabel");
        button.setLabel(count ? `${base} (${count})` : base);
        if (button !== this.__uncheckButton) {
          button.setEnabled(count >= 1);
        }
      });
    },

    __single(handler) {
      const boards = this.__selectedBoards();
      if (boards.length !== 1) {
        tihamon.ui.Dialog.alert("Önce listeden tek bir tahtayı işaretleyin.");
        return;
      }
      handler(boards[0]);
    },

    __withSome(handler) {
      const boards = this.__selectedBoards();
      if (!boards.length) {
        tihamon.ui.Dialog.alert("Önce bir ya da daha fazla tahta işaretleyin.");
        return;
      }
      handler(boards);
    },

    __edit(board) {
      const win = tihamon.ui.Dialog.window(board ? "Tahtayı düzenle" : "Tahta ekle", 460);
      const form = new tihamon.ui.Form();
      board = board || { monitor_enabled: true, exporter_port: 9100 };
      form.text("label", "Takma ad", board.label, "ör. A Blok 2. Derslik");
      form.text("location", "Konum", board.location, "ör. B blok, 2. kat");
      form.text("hostname", "Bilgisayar adı", board.hostname, "ör. etap-1a2b3c");
      form.text("ip", "IP adresi", board.ip);
      form.text("mac", "MAC adresi", board.mac, "uzaktan uyandırma için gerekli");
      form.text("exporter_port", "Sensör portu", String(board.exporter_port));
      form.check("monitor_enabled", "Sensör verisi toplansın", board.monitor_enabled);
      form.text("notes", "Not", board.notes);
      win.add(form);

      const cancel = new qx.ui.form.Button("Vazgeç");
      const save = new qx.ui.form.Button("Kaydet");
      cancel.addListener("execute", () => win.close());
      save.addListener("execute", async () => {
        const values = form.values();
        values.exporter_port = parseInt(values.exporter_port, 10) || 0;
        try {
          if (board.id) {
            await tihamon.io.Api.patch("/boards/" + board.id, values);
          } else {
            await tihamon.io.Api.post("/boards", values);
          }
          win.close();
          this.refresh();
        } catch (e) {
          tihamon.ui.Dialog.error(e);
        }
      });
      tihamon.ui.Dialog.buttons(win, [cancel, save]);
      win.open();
    },

    /**
     * Satır sağ menüsü: BoardOps.menu() çevrimiçi/çevrimdışına göre Komut çalıştır / Ekran / … ve
     * yan yana Bilgisayarı aç (WoL) + Bilgisayarı kapat ekler (bkz. ui.BoardOps) — burada bu sayfaya
     * özgü kayıt işlemleri (Düzenle / Sil), Logları göster (Loglar sayfasını bu tahtaya süzülmüş
     * açar — bkz. ui.Shell.OPEN_LOGS) ve hemen altında Bilgi kartı eklenir.
     */
    __rowMenu(board, boards = [board], sessionOps = null) {
      const menu = tihamon.ui.BoardOps.menu(board, this._user, boards, sessionOps) || new qx.ui.menu.Menu();
      const ICON = tihamon.ui.Shell.ICON;
      const add = (icon, label, handler) => menu.add(tihamon.ui.BoardOps.menuButton(icon, label, handler.bind(this)));
      const extra = [];
      if (this._can("logs")) {
        extra.push(() => add(ICON.logs, "Logları göster", () =>
          qx.event.message.Bus.dispatchByName(tihamon.ui.Shell.OPEN_LOGS, board.id)));
      }
      // Bilgi kartı "Logları göster"in hemen altında (kullanıcı isteği); yalnız çevrimiçi tahtada.
      if (board.online && (this._can("boards") || this._can("screen"))) {
        const count = boards.length > 1 ? ` (${boards.length} tahta)` : "";
        extra.push(() => add(ICON.info, "Bilgi kartı" + count, () => tihamon.ui.BoardOps.infoCard(boards)));
      }
      // Bilgisayarı aç (WoL) artık BoardOps.menu'de "Bilgisayarı kapat"ın hemen yanında (kullanıcı
      // isteği: ikisi komşu); çevrimiçi tahtada orada devre dışı görünür.
      if (this._can("boards.manage")) {
        extra.push(() => add(ICON.edit, "Düzenle", () => this.__edit(board)));
        extra.push(() => add(ICON.delete, "Sil", () => this.__delete([board])));
      }
      if (extra.length) {
        if (menu.getChildren().length) {
          menu.add(new qx.ui.menu.Separator());
        }
        extra.forEach(fn => fn());
      }
      return menu.getChildren().length ? menu : null;
    },

    /**
     * Bir ya da daha fazla tahtayı; loglarını ve sensör geçmişini de dahil ederek TAMAMEN siler
     * (toolbar "Sil" düğmesi işaretli tüm tahtaları, satır sağ menüsü tek tahtayı [board] olarak
     * gönderir) — bkz. backend BoardsApi::delete (logs + metrics + board_blocklist). Hostname hâlâ
     * log gönderiyorsa worker artık kaydı kendiliğinden yeniden açmaz (blocklist); "Ekle" ile elle
     * yeniden kaydedilirse engel kalkar.
     *
     * İlerleme penceresi her tahta için ayrı bir satırla açılır ve kayıtlar SIRAYLA (paralel değil)
     * silinir; her DELETE sonucu geldikçe o satır anlık "⏳ siliniyor…" → "✓/✕ ..." olarak güncellenir
     * — sessizce yalnız listeyi yenileyip tek bir özet göstermek yerine.
     */
    async __delete(boards) {
      const esc = v => qx.bom.String.escape(String(v ?? "—"));
      const name = b => b.label || b.hostname || b.ip || ("#" + b.id);
      const question = boards.length === 1
        ? `<b>${esc(name(boards[0]))}</b> kaydı, logları ve sensör geçmişiyle birlikte TAMAMEN silinsin mi? Bu işlem geri alınamaz.`
        : `Seçili <b>${boards.length}</b> tahta kaydı, logları ve sensör geçmişiyle birlikte TAMAMEN silinsin mi?<br>` +
          `${boards.map(b => esc(name(b))).join(", ")}<br>Bu işlem geri alınamaz.`;
      const sure = await tihamon.ui.Dialog.confirm(question, "Sil");
      if (!sure) {
        return;
      }

      const win = tihamon.ui.Dialog.window("Siliniyor…", 480);
      const rowLabels = new Map();
      boards.forEach(board => {
        const label = new qx.ui.basic.Label(`⏳ <b>${esc(name(board))}</b> siliniyor…`).set({ rich: true, wrap: true });
        win.add(label);
        rowLabels.set(board.id, label);
      });
      win.open();

      let ok = 0;
      let failed = 0;
      for (const board of boards) {
        try {
          const r = await tihamon.io.Api.del("/boards/" + board.id);
          ok++;
          rowLabels.get(board.id).setValue(
            `✓ <b>${esc(name(board))}</b> silindi — ${r.logs_deleted ?? 0} log kaydı, ` +
            `${r.metrics_deleted ?? 0} sensör ölçümü temizlendi.`);
        } catch (e) {
          failed++;
          rowLabels.get(board.id).setValue(`✕ <b>${esc(name(board))}</b> silinemedi — Hata: ${esc(e.message || e)}`);
        }
        this.refresh();
      }

      win.add(new qx.ui.basic.Label(
        failed
          ? (ok ? `${ok} kayıt silindi, ${failed} kayıt silinemedi.` : `${failed} kayıt silinemedi.`)
          : `${ok} kayıt, logları ve sensör geçmişiyle birlikte tamamen silindi.`
      ).set({ rich: true, wrap: true, font: "bold" }));
      const close = new qx.ui.form.Button("Tamam");
      close.addListener("execute", () => win.close());
      tihamon.ui.Dialog.buttons(win, [close]);
    }
  }
});
