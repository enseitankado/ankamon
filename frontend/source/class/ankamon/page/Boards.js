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
 * O satır işaretli ÇOKLU seçimin bir parçasıysa hepsi için ortak bir pencerede yan yana
 * panolar (toplu komut yazılabilen) çoklu terminal açılır (BoardOps.webshellMulti — bkz. /multishell/);
 * değilse yalnız o tahtanın tekli terminali (BoardOps.webshell) açılır — ikisi de aynı pencere
 * deseniyle (BoardOps.__terminalWindow), yeni sekme YOKTUR.
 */
qx.Class.define("ankamon.page.Boards", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, "Akıllı Tahtalar");
    // Üstteki düğme satırı (Yenile, Tümünü işaretle, İşaretleri kaldır, Ekle, Düzenle, Sil, Komut çalıştır,
    // Yansıt, Kapat, Uyandır) kaldırıldı (kullanıcı isteği): hepsi satır/kutucuk sağ menüsünde (bkz.
    // __rowMenu — işaretleme ve "Tahta ekle…" de orada); sayfa REFRESH_MS'de bir kendiliğinden yenilenir.
    this._actions.exclude();

    // Sütun tanımları: hem tabloya hem de her sütunun altındaki süzgeç kutusuna aynı dizi verilir.
    // Başlıklar kısa (kullanıcı isteği; ör. üç ayrı "Disk" sütunu); "hint" tam adı verir — sütun
    // gizleme menüsünde ve süzgeç ipucunda o görünür (bkz. Base _createTable/_addColumnFilters).
    this.__columns = [
      // KALICI KURAL (kullanıcı 2026-11-10): Durum = ağda canlı mı (Varlıklar'la aynı); SSH erişimi ayrı "Yönetilebilir".
      { id: "status", label: "Durum", width: 100, hint: "Çevrimiçi: tahta ağda canlı (Varlıklar'daki durumla aynı — ağ taraması görüyor ya da SSH yanıt veriyor). Kapalı: ağda görülmüyor." },
      { id: "manageable", label: "Yönetilebilir", width: 120, hint: "Tek ölçüt: tahtaya SSH ile root girişi başarılı mı. Evet: Ankamon son 3 dakikada tahtaya SSH ile root olarak girebildi — komut, ekran, web terminali, oturum işlemleri yapılabilir. Hayır (parola): SSH portu açık ama giriş reddediliyor — tahtanın root parolası Ayarlar ▸ SSH erişimi'ndekinden farklı (Oturumlar ▸ Parola ayarla… ▸ Yönetici hesapları'ndan tahtanın parolası girilir). Hayır: SSH yanıt vermiyor." },
      { id: "name", label: "Takma ad / Ad" },
      { id: "hostname", label: "Bilgisayar adı", width: 150 },
      { id: "ip", label: "IP", width: 120 },
      // Kablolu MAC: kablolu ağ kartının MAC'i (boards.mac — tahtanın kimliği, uzaktan uyandırma, ağ taraması).
      // Kablosuz MAC: Wi-Fi kartının kalıcı (fabrika) MAC'i (boards.wifi_mac, göç 043 — worker oturum yoklaması
      // yazar; NetworkManager'ın taramadaki rastgele adresi değil).
      { id: "mac", label: "Kablolu MAC", hint: "Kablolu ağ kartının MAC adresi (uzaktan uyandırma bununla)", width: 140 },
      { id: "wifi_mac", label: "Kablosuz MAC", hint: "Wi-Fi kartının kalıcı (fabrika) MAC adresi", width: 140 },
      // FATİH fazı (bkz. util.Format.etap — anakart modelinden, yoksa maskelenmiş MAC önekinden).
      { id: "faz", label: "Faz", hint: "FATİH fazı ve tahta markası", width: 130 },
      // Anlık oturum (bkz. worker executor/session_probe.py — 30 sn'de bir SSH ile yoklanır; Oturum aç/
      // kapat/sorgula sonuçları da hemen yazar): kullanıcı adı, "(kilitli)" ya da "Oturum kapalı".
      { id: "session", label: "Oturum", width: 140 },
      // Wi-Fi kartı etkin mi (bkz. ui.FactsView.wifiStatus — Bilgi kartıyla aynı kural). Donanım
      // bilgisiyle birlikte toplanır; Wi-Fi aç/kapat işlemi sonrası runner hemen günceller.
      { id: "wifi", label: "Wi-Fi", width: 110 },
      // Tahta yerel ağa kablolu kartıyla bağlı mı (internet değil) — bkz. Boards.cableText.
      { id: "cable", label: "Kablo", hint: "Yerel ağa kablolu ağ kartıyla bağlı mı", width: 100 },
      // Donanım bilgisi (bkz. worker/ankamon/executor/hwfacts.py): tahta ilk kez tanınırken (MAC
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
      // Ağ trafiği, Mbit/sn (bkz. backend MetricsApi::latest — node_exporter sayaçlarının son tarama aralığı).
      // Başlıkta birim (kullanıcı isteği: "D:/U:Mbit/sn", hücrede yalnız sayı); ne olduğu ipucunda açıkça.
      { id: "net_rx", label: "D:Mbit/sn", hint: "D (download / indirme): tahtanın ağdan ALDIĞI trafik, Mbit/sn — son ölçüm aralığının ortalaması", width: 95 },
      { id: "net_tx", label: "U:Mbit/sn", hint: "U (upload / yükleme): tahtanın ağa GÖNDERDİĞİ trafik, Mbit/sn — son ölçüm aralığının ortalaması", width: 95 },
      // Sensörler (bkz. backend Core/BoardSensors.php). Fan/pil/anakart, tahtada Super I/O sürücüsü
      // yüklüyse gelir ("Metrik izlemeyi kur" işlemi); Kasa yoksa ACPI bölgesidir.
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
    // Sütun başlığıyla sıralama kullanıcı adına sunucuda saklanır, sayfa açılınca geri yüklenir (kullanıcı isteği).
    ankamon.page.Base.rememberSort(this.__table, this.__columns, this.__table.getUserData("offset"), "boards.columns", this._user);
    // "Durum" sütunu: Çevrimiçi yeşil, Kapalı kırmızı (bkz. ui.table.StatusRenderer).
    // İpucu: satırın "Son görülme" hücresi (kullanıcı isteği 2026-11-10).
    this.__table.getTableColumnModel().setDataCellRenderer(2 + this.__columns.findIndex(c => c.id === "status"),
      new ankamon.ui.table.StatusRenderer(2 + this.__columns.findIndex(c => c.id === "seen")));
    // "Oturum" sütunu: ekran kilitliyse "(kilitli)" ifadesi kırmızı+kalın (bkz. ui.table.SessionRenderer).
    this.__table.getTableColumnModel().setDataCellRenderer(2 + this.__columns.findIndex(c => c.id === "session"),
      new ankamon.ui.table.SessionRenderer());
    // İşaretler Ekranlar kutucuklarına yansır — bkz. __updateActionState.
    this.__table.getTableModel().addListener("dataChanged", this.__updateActionState, this);
    // Ekranlar kutucukları listenin O ANKİ satır sırasıyla dizilir (sütun başlığıyla sıralama dahil) — bkz. __syncShownOrder.
    // Başlıkla sıralama dataChanged değil metaDataChanged yayar (qx Simple.sortByColumn).
    this.__table.getTableModel().addListener("dataChanged", this.__syncShownOrder, this);
    this.__table.getTableModel().addListener("metaDataChanged", this.__syncShownOrder, this);
    // Satır menüsünün simgeli karşılığı; liste ve ekran görünümünün üstünde (bkz. ui.boards.ActionBar).
    this.__actionBar = new ankamon.ui.boards.ActionBar((board, boards) => this.__rowMenu(board, boards, this.__barSessionOps()),
      () => this._checkedIds(this.__table).map(id => this.__boards && this.__boards.get(id)).filter(Boolean),
      { getAll: () => (this.__boards ? [...this.__boards.values()] : []) });
    this.add(this.__actionBar);
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
    this.__filterFields = this._addColumnFilters(this.__table, this.__columns, this.__apply,
      { rows: () => (this.__rows || []).map(r => r.cells), persist: true });

    // Tek ekran, iki görünüm (sekme yok, kullanıcı isteği): grid'deki tahtaların canlı ekran önizlemeleri (varsayılan) ya da
    // "Liste" seçiliyken grid (araç çubuğunun başındaki görünüm bölümü). Sağ menü işlemleri işaretli tahtalara ikisinden de uygulanır. "screen" yetkisi yoksa yalnız grid.
    this.__views = new qx.ui.container.Stack();
    const listPage = new qx.ui.container.Composite(new qx.ui.layout.VBox(8)).set({ padding: [8, 8, 0, 8] });
    listPage.add(this.__table, { flex: 1 });
    this.__note = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true, wrap: true, visibility: "excluded" });
    listPage.add(this.__note);
    this.__views.add(listPage);
    this.__listPage = listPage;
    if (this._can("screen")) {
      this.__views.add(this.__createScreensPage());
      this.__showListView(this.__createViewControls());
    }
    this.add(this.__views, { flex: 1 });

    // Sayfa açık kalsa bile kendiliğinden tazelenir (bkz. sınıf başı not — worker zinciriyle birlikte).
    this.__timer = new qx.event.Timer(ankamon.page.Boards.REFRESH_MS);
    this.__timer.addListener("interval", this.refresh, this);
    this.__timer.start();

    this.__updateActionState(); // başlangıçta hiç satır işaretli değil: ilgili düğmeler devre dışı.

    // Ctrl/⌘+A sayfa düzeyinde (kullanıcı isteği, 2026-11-05): odak tabloda ya da Ekranlar iframe'inde değilken
    // (ör. araç çubuğuna tıkladıktan sonra) tarayıcının kendi "tümünü seç"i Ekranlar alanını mavi saydam kutuyla
    // kaplıyordu. Görünen (süzülmüş) bütün tahtalar işaretlenir; Ekranlar'da işaretler kutucukların seçim
    // çerçevesine yansır (bkz. __pushSelection). Tablo odaktaysa Base'in kendi Ctrl+A'sı, iframe odaktaysa
    // screen/index.html'inki çalışır (ikisi de aç/kapa).
    this.__onSelectAllKey = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "a" || !this.isSeeable()) {
        return;
      }
      const el = document.activeElement;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(el.tagName))) {
        return;
      }
      const focused = qx.ui.core.FocusHandler.getInstance().getFocusedWidget();
      for (let w = focused; w; w = w.getLayoutParent()) {
        if (w === this.__table || w instanceof qx.ui.window.Window) {
          return;   // tablonun kendi işleyicisi / başka bir pencere (ör. terminal)
        }
      }
      e.preventDefault();
      const rows = this.__table.getTableModel().getRowCount();
      const all = rows > 0 && this._checkedIds(this.__table).length === rows;
      this._checkAll(this.__table, !all);
      if (this.__views.getSelection()[0] === this.__listPage) {
        if (all) {
          this.__table.getSelectionModel().resetSelection();
        } else if (rows) {
          this.__table.getSelectionModel().setSelectionInterval(0, rows - 1);
        }
      }
    };
    window.addEventListener("keydown", this.__onSelectAllKey, true);
  },

  statics: {
    /** Tahta ekle/düzenle MAC biçimi (BoardsApi::validatedBoardFields ile aynı): de:ad:de:ad:de:ad. */
    MAC_RE: /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i,

    /** Alt bardaki göstergeler (sağ menüdeki sırayla) — anahtarlar screen/index.html Tile.setStats ile aynı. */
    STATS_ITEMS: [
      ["net", "Ağ arabirimleri"], ["cpu", "İşlemci kullanımı"], ["temp", "İşlemci sıcaklığı"], ["mem", "Bellek (RAM)"],
      ["disk_temp", "Disk sıcaklığı (HDD)"], ["fan", "Fan hızı"], ["battery", "CMOS pili"]
    ],

    /** Oturum yoklamasının ağ kartı bilgisi (netifs) bu kadar saniyeden eskiyse "Kablo" logdan kanıta bakar. */
    CABLE_FRESH_S: 300,

    /**
     * "Kablo" sütununun metni: tahta yerel ağa KABLOLU kartıyla bağlı mı (internet değil; Wi-Fi ile de bağlı
     * olabilir). Asıl kaynak oturum yoklaması (30 sn, aynı SSH turu — bkz. worker executor/netif.py): kablolu
     * kartta kablo sinyali (carrier) + NetworkManager "bağlı" (100) + IPv4 → "Bağlı"; sinyal var ama bağlantı
     * yoksa "Bağlantı yok"; sinyal yoksa "Takılı değil"; kablolu kart yoksa "Kart yok". Yoklama eskiyse
     * (CABLE_FRESH_S) logdan kanıt: son 2 dk'da tahtanın IP'sinden log geldi ve o IP'nin MAC'i kablolu kartınki
     * (BoardsApi cable_log) → "Bağlı (log)". Kapalı tahtada boş (bilinmiyor).
     */
    /** "Durum" sütunu: ağda canlı (BoardsApi alive — Varlıklar'la aynı ölçü) → "Çevrimiçi", değilse "Kapalı". SSH erişimi
     * ayrı "Yönetilebilir" sütununda (board.online) — bkz. bellek smart-boards-online-vs-manageable. */
    /** "Yönetilebilir" sütunu (BoardsApi manageable / ssh_login_failing). */
    manageableText(board) {
      if (board.manageable ?? board.online) {
        return "Evet";
      }
      return board.ssh_login_failing ? "Hayır (parola)" : "Hayır";
    },

    statusText(board) {
      return (board.alive ?? board.online) ? "Çevrimiçi" : "Kapalı";
    },

    /**
     * "Wi-Fi" sütunu (ui.FactsView.wifiStatus kuralı). Bağlı/bağlı değil ve ağ adı, oturum yoklaması tazeyse
     * (netifs, 30 sn — CABLE_FRESH_S) ondan alınır; donanım bilgisi (facts) yalnız ilk tanınmada/Bilgi kartında
     * toplandığından günlerce eski kalabiliyor (bağlı görünüp bağlı olmayan tahta). Bağlıysa "Bağlı (Ağ adı)".
     */
    wifiText(board) {
      const f = board.facts || {};
      const fresh = board.netifs && board.session_checked_at &&
        Date.now() / 1000 - board.session_checked_at < ankamon.page.Boards.CABLE_FRESH_S;
      const live = fresh && (board.netifs.ifaces || []).find(i => i.kind === "wifi");
      const merged = live ? Object.assign({}, f, live.state === 100
        ? { wifi_state: "connected", wifi_ssid: live.ssid || live.connection || "" }
        : { wifi_state: "disconnected" }) : f;
      return (ankamon.ui.FactsView.wifiStatus(merged) || { text: "" }).text;
    },

    cableText(board) {
      const wired = ((board.netifs && board.netifs.ifaces) || []).filter(i => i.kind === "ethernet");
      if (!board.online) {
        return "";
      }
      const fresh = board.netifs && board.session_checked_at &&
        Date.now() / 1000 - board.session_checked_at < ankamon.page.Boards.CABLE_FRESH_S;
      if (fresh) {
        if (!wired.length) {
          return "Kart yok";
        }
        if (wired.some(i => i.carrier && i.state === 100 && (i.ipv4 || []).length)) {
          return "Bağlı";
        }
        return wired.some(i => i.carrier) ? "Bağlantı yok" : "Takılı değil";
      }
      return board.cable_log ? "Bağlı (log)" : "";
    },

    /**
     * "Oturum" sütununun metni: çevrimdışı ya da henüz yoklanmamış tahtada boş (bilinmiyor), oturum
     * yoksa "Oturum kapalı", varsa kullanıcı adı — oturum kilitliyse (dm-tool lock) "(kilitli)" ekiyle.
     * Ankamon ekran kilidi (Ekran ▸ Kilitle) ayrıca " / Kilitli" ile eklenir (bkz. worker executor/screenlock.py).
     */
    sessionText(board) {
      if (!board.online || !board.session_checked_at) {
        return "";
      }
      let text = "Oturum kapalı";
      if (board.session_username) {
        text = board.session_locked ? `${board.session_username} (kilitli)` : board.session_username;
      }
      const names = { keyboard: "Klavye", mouse: "Fare", touch: "Dokunmatik" };
      const input = (board.input_locks || []).map(d => names[d] || d).join("+");
      return (board.screen_locked ? `${text} / Kilitli` : text) + (input ? ` / ${input} kilitli` : "");
    },

    // Kilit teyidinden sonra kutucuk akışının yenilenmesi için en uzun bekleme (bkz. __refreshTile).
    TILE_REFRESH_MS: 8000,
    // "Kapanıyor…" yazısı (bkz. __sessionOps shutdownSent) tahta bu süre içinde kapanmadıysa kalkar.
    SHUTDOWN_NOTE_MS: 3 * 60 * 1000,

    // Ekran görünümü kapandıktan (Liste ya da başka sayfa) bu kadar sonra önizleme akışları duraklar
    // (kutucuklar son görüntüleriyle kalır — bkz. __pausePreview).
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
    if (this.__onSelectAllKey) {
      window.removeEventListener("keydown", this.__onSelectAllKey, true);
    }
    if (this.__sliderThemeListener) {
      qx.theme.manager.Meta.getInstance().removeListenerById(this.__sliderThemeListener);
    }
    if (this.__onScreenWindows) {
      qx.event.message.Bus.unsubscribe(ankamon.ui.BoardOps.SCREEN_WINDOWS, this.__onScreenWindows, this);
    }
    if (this.__onChatWindows) {
      qx.event.message.Bus.unsubscribe(ankamon.ui.chat.Window.CHANGED, this.__onChatWindows, this);
    }
    if (this.__onWifiRadio) {
      qx.event.message.Bus.unsubscribe(ankamon.ui.boards.WifiMonitor.RADIO_CHANGED, this.__onWifiRadio, this);
    }
  },

  members: {
    __timer: null,
    __table: null,
    __note: null,
    __columns: null,
    __filterFields: null,
    __views: null,
    __viewButtons: null,
    __viewReady: false,
    __listPage: null,
    __actionBar: null,
    __onSelectAllKey: null,

    /** Ekran görünümündeyken araç çubuğu da sağ menü gibi sonucu kutucuklarda gösterir. */
    __barSessionOps() {
      const screens = this.__screensPage && this.__views.getSelection()[0] === this.__screensPage;
      return screens ? this.__sessionOps() : null;
    },

    /**
     * Shell OPEN_PAGE (Genel bakış kartları): liste görünümüne geçer ve Durum süzgecini verilen
     * metne ("Çevrimiçi" | "Kapalı" | "" = hepsi) ayarlar; diğer sütun süzgeçleri temizlenir.
     * Süzgeç kutuları başlık ilk çizildiğinde oluşur (bkz. Base._addColumnFilters) — henüz yoksa
     * kısa aralıklarla yeniden denenir.
     */
    openWith(opts, tries = 0) {
      if (!("status" in opts)) {
        return;
      }
      if (this.__viewButtons) {
        this.__viewButtons.get("list").setValue(true);
      }
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
    __screensPage: null,
    __screenView: null,
    __frame: null,
    __screensTimer: null,
    __screensHiddenAt: null,
    __screensRunning: false,
    __previewKey: null,
    __previewMenu: null,
    __onMessage: null,
    __screenRes: null,
    __sizeLabel: null,
    __autoSize: false,
    __fitting: false,
    __fitReset: false,
    __fitResizeId: null,
    __shownBoards: null,
    __whoamiState: null,
    __liveQueue: null,
    __applyingPreview: false,
    __metrics: null,

    async _refresh() {
      const F = ankamon.util.Format;
      const [boards, metrics] = await Promise.all([
        ankamon.io.Api.get("/boards"),
        ankamon.io.Api.get("/metrics/latest")
      ]);
      // Kendiliğinden tazelemede kullanıcının o anki işaretlemeleri kaybolmasın. İstek SONRASI okunur: önce okununca
      // istek sürerken yapılan işaretleme (fare, Ctrl+A) yanıt gelince eski listeyle geri alınıyordu (2026-11-05).
      const wasChecked = this.__table ? new Set(this._checkedIds(this.__table)) : new Set();
      this.__boards = new Map(boards.boards.map(b => [b.id, b]));
      this.__metrics = metrics.latest || {};
      ankamon.ui.BoardOps.syncScreenLocks(boards.boards);
      const unit = (v, suffix) => v === null || v === undefined ? "" : v + suffix;
      const mbit = v => v === null || v === undefined ? "" : v.toFixed(v < 10 ? 2 : 1);   // birim sütun başlığında
      // cells[0]=kimlik, cells[1]=onay kutusu, cells[2..]=sütunlar.
      this.__rows = boards.boards.map(board => {
        const m = metrics.latest[board.id] || {};
        return {
          board,
          cells: [
            board.id, wasChecked.has(board.id),
            ankamon.page.Boards.statusText(board),
            ankamon.page.Boards.manageableText(board),
            board.label || board.hostname || board.ip,
            board.hostname, board.ip, board.mac, board.wifi_mac || "", F.etap(board.etap, board.facts.cpu_model),
            ankamon.page.Boards.sessionText(board),
            ankamon.page.Boards.wifiText(board),
            ankamon.page.Boards.cableText(board),
            board.facts.disk_total_bytes ? F.bytes(board.facts.disk_total_bytes) : "",
            board.facts.mem_installed_bytes || board.facts.mem_total_bytes ? ankamon.ui.FactsView.ramText(board.facts, false) : "",
            board.facts.bios_version || "", board.facts.kernel_version || "", board.facts.motherboard_model || "",
            board.facts.cpu_model || "", board.facts.cpu_phys_cores || "",
            F.percent(m.cpu_percent), F.percent(m.mem_percent), F.percent(m.disk_percent),
            mbit(m.net_rx_mbit), mbit(m.net_tx_mbit),
            unit(m.cpu_temp, " °C"), unit(m.case_temp, " °C"), unit(m.disk_temp, " °C"),
            unit(m.fan_rpm, " RPM"), m.battery_v === null || m.battery_v === undefined ? "" : m.battery_v.toFixed(2) + " V",
            F.ago(board.last_seen_at), F.ago(board.last_log_at)
          ]
        };
      });
      this.__apply();
      this.__actionBar.refresh();
      this.__note.setValue(boards.boards.length ? "" :
        "Henüz kayıtlı tahta yok. Tahtalar log göndermeye başladığında kendiliğinden listelenir; elle de ekleyebilirsiniz.");
      // Boş not yer kaplamasın: tablo pencerenin altına kadar uzansın (kullanıcı isteği).
      this.__note.setVisibility(boards.boards.length ? "excluded" : "visible");
    },

    /** Her sütunun altındaki metin kutularını (Excel tarzı sütun filtresi) uygular. */
    __apply() {
      // Eklenti kancası: Durum kutusuna yazılan metni bir eklenti üstlenebilir (bkz. ankamon.ext.Extensions).
      const status = this.__filterFields && this.__filterFields.status;
      if (status && ankamon.ext.Extensions.handle("boards.statusFilter", (status.getValue() || "").trim(), this)) {
        status.setValue("");
        return;
      }
      if (!this.__rows) {
        return;
      }
      // cells[0] kimlik, cells[1] onay kutusu; sütun i'nin değeri cells[i + 2]'dedir.
      const colFilters = this.__columns
        // Süzgeç kutusu başlık hücresi ilk çizildiğinde oluşur (bkz. Base._addColumnFilters); henüz
        // çizilmemiş (ekran dışı/gizli) sütunda yoktur — süzgeçsiz sayılır.
        .map((column, index) => ({ index: index + 2, text: ((this.__filterFields[column.id] || { getValue: () => "" }).getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);

      const shown = this.__rows.filter(({ cells }) =>
        colFilters.every(f => ankamon.page.Base.filterMatch(cells[f.index], f.text)));
      // Sıralı listede setData önce sırasız veriyle dataChanged, sonra yeniden sıralayıp metaDataChanged yayar
      // (Base.keepSortOnReload): aradaki sırasız sıra kutucuklara gitmesin — her tazelemede kutucuklar iki kez
      // yer değiştiriyor, tam ekrandaki kutucuk DOM'da taşınınca tam ekrandan düşüyordu. Sıra bir kez, sonda eşitlenir.
      this.__settingRows = true;
      try {
        this.__table.getTableModel().setData(this.__inScreenOrder(shown).map(r => r.cells));
      } finally {
        this.__settingRows = false;
      }
      this.__syncShownOrder();
    },

    /**
     * Listenin sütunla sıralanmamış (varsayılan) sırası: kutucukların sürükle-bırakla kaydedilen sırası
     * (bkz. __screenOrder, AuthApi::screenOrder) — o sıradakiler önce, sıralanmamışlar (yeni tahta) doğal
     * sırayla sona. Sütun başlığıyla sıralanınca o sıra geçerlidir (Base.keepSortOnReload).
     */
    __inScreenOrder(rows) {
      const order = this.__screenOrder || (this._user && this._user.screen_order) || [];
      const rank = new Map(order.map((id, i) => [id, i]));
      const ranked = rows.filter(r => rank.has(r.board.id)).sort((a, b) => rank.get(a.board.id) - rank.get(b.board.id));
      return ranked.concat(rows.filter(r => !rank.has(r.board.id)));
    },

    /** Gösterilen tahtalar, tablonun o anki satır sırasıyla; Ekranlar kutucukları aynı sırada çizilir. */
    __syncShownOrder() {
      if (!this.__rows || this.__settingRows) {
        return;
      }
      const byId = new Map(this.__rows.map(r => [r.board.id, r.board]));
      const model = this.__table.getTableModel();
      const shown = [];
      for (let i = 0; i < model.getRowCount(); i++) {
        const board = byId.get(model.getValue(0, i));
        if (board) {
          shown.push(board);
        }
      }
      this.__shownBoards = shown;
      this.__pushPreview();
    },

    /**
     * Ekran görünümü: grid'de o an listelenen (süzülmüş) tahtaların canlı ekran önizlemeleri.
     * Önizlemeler /screen/ sayfasının gömülü kipidir (spec.embed, q=thumb — küçük ve düşük kare hızlı;
     * komut loguna yazılmaz, bkz. ekran köprüsü nolog). Görünüm kapanınca (Liste işaretlendi ya da
     * başka bir sayfa) SCREENS_STOP_MS sonra akışlar duraklatılır (yük tasarrufu; bkz. __pausePreview) —
     * iframe ve kutucuklar son görüntüleriyle yerinde kalır, yeniden kurulmaz; dönülünce akışlar sürer.
     * Kutucuklar alttaki slider'la topluca, kenarlarından sürükleyerek tek tek boyutlandırılır.
     * Kutucuk sağ menüsü grid satırınınkiyle AYNI (__rowMenu); "Kullanıcılar ▸ Oturumları sorgula" (bkz.
     * __openPreviewMenu, BoardOps.menu) — SSH ile anlık sorgu sonucu (bkz. __whoamiState, worker/ankamon/executor/
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
      const page = new qx.ui.container.Composite(new qx.ui.layout.VBox());
      // qx.ui.embed.Iframe yerine düz <iframe> (Html bileşeni): Iframe her pointerdown'da üstüne saydam
      // bir "blocker" koyuyor ve sekme düğmesine tıklandıktan sonra bu katman açık kalıp kutucuklara
      // tıklama/sağ tığı yutuyordu (ölçüldü). Html bileşeninde böyle bir katman yok.
      this.__frame = new qx.ui.embed.Html("").set({ overflowX: "hidden", overflowY: "hidden" });
      page.add(this.__frame, { flex: 1 });
      this.__screenRes = new Map(); // tahta id → ekran genişliği (px), bkz. "tm-res"
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
          this.__pushSize(false);
          if (this.__autoSize) {
            this.__requestFit(false);
          }
          if (!this.__fitResizeId) {
            // Varsayılan boyuttayken pencere/kenar çubuğu genişliği değişince satırdaki ekran sayısı korunur.
            this.__fitResizeId = this.__frame.addListener("resize", () => this.__autoSize && this.__requestFit(false));
          }
          this.__pushView();
          if (this.__screensPaused) {
            this.__pausePreview(true);
          }
          this.__pushSelection();
          this.__pushPopped();
          this.__pushChat();
        } else if (e.data.type === "tm-select") {
          this.__checkFromPreview(e.data.ids || []);
        } else if (e.data.type === "tm-click") {
          qx.ui.menu.Manager.getInstance().hideAll();
        } else if (e.data.type === "tm-menu") {
          this.__openPreviewMenu(e.data.id, e.data.x, e.data.y, e.data.ids);
        } else if (e.data.type === "tm-statsmenu") {
          this.__openStatsMenu(e.data.id, e.data.x, e.data.y, e.data.ids);
        } else if (e.data.type === "tm-show") {
          // Kutucuğun ekran alanına çift tıklama = sağ menüdeki "Ekranı göster" (yalnız o tahta).
          const board = this.__boards.get(e.data.id);
          if (board && board.online && this._can("screen")) {
            ankamon.ui.BoardOps.screen([board], this._user);
          }
        } else if (e.data.type === "tm-manage") {
          // Kutucuktaki "🖱 Müdahale" = sağ menüdeki "Ekranı yönet": pencere büyütülmüş açılır (kullanıcı isteği).
          const board = this.__boards.get(e.data.id);
          if (board && board.online && this._can("screen") && this._can("screen.control")) {
            ankamon.ui.BoardOps.screen([board], this._user, true);
          }
        } else if (e.data.type === "tm-wake") {
          // Güç tasarrufundaki kutucuğa basıldı = sağ menü Ekran ▸ Uyandır (yalnız o tahta).
          const board = this.__boards.get(e.data.id);
          if (board && board.online && this._can("screen")) {
            this.__sessionOps().wake([board]);
          }
        } else if (e.data.type === "tm-reorder") {
          this.__saveScreenOrder(e.data.order || []);
        } else if (e.data.type === "tm-live") {
          this.__queueLiveWhoami(e.data.id);
        } else if (e.data.type === "tm-refreshed") {
          this.__tileRefreshed(e.data.id);
        } else if (e.data.type === "tm-fit") {
          this.__applyFit(e.data.px);
        } else if (e.data.type === "tm-res") {
          // Tahtanın ekran çözünürlüğü (VNC çerçeve boyutu): slider'ın yanındaki % değeri buna göre.
          this.__screenRes.set(e.data.id, e.data.w);
          this.__updateSizeLabel();
        }
      };
      window.addEventListener("message", this.__onMessage);
      // Ayrı pencerede açık ekranlar (BoardOps.screen): o tahtaların önizlemesi durur, yerine not yazar.
      this.__onScreenWindows = () => this.__pushPopped();
      qx.event.message.Bus.subscribe(ankamon.ui.BoardOps.SCREEN_WINDOWS, this.__onScreenWindows, this);
      // Sohbet açık tahtanın kutucuğu yüksek çözünürlükte akar: tahtadaki sohbet penceresi okunur.
      this.__onChatWindows = () => this.__pushChat();
      qx.event.message.Bus.subscribe(ankamon.ui.chat.Window.CHANGED, this.__onChatWindows, this);
      // Wi-Fi Monitör bir tahtanın kartını açtı/eski durumuna döndürdü: Wi-Fi sütunu anında güncellensin (kullanıcı isteği).
      // Aynı anda birçok tahtadan gelebilir — tek tazelemede toplanır.
      this.__onWifiRadio = () => {
        if (!this.__wifiRefreshQueued) {
          this.__wifiRefreshQueued = true;
          qx.event.Timer.once(() => {
            this.__wifiRefreshQueued = false;
            this._refresh().catch(() => {});
          }, this, 300);
        }
      };
      qx.event.message.Bus.subscribe(ankamon.ui.boards.WifiMonitor.RADIO_CHANGED, this.__onWifiRadio, this);

      // Görünürlük yoklaması: hem görünüm değişimini hem Shell'deki sayfa değişimini yakalar.
      this.__screensTimer = new qx.event.Timer(1000);
      this.__screensTimer.addListener("interval", this.__checkScreens, this);
      this.__screensTimer.start();
      return page;
    },

    /**
     * Araç çubuğunun başındaki görünüm bölümü (bkz. ui.boards.ActionBar.addViewControls):
     *  - Ekranlar | Liste: iki durumlu; ekran kutucukları ya da grid (seçim kullanıcı başına kalıcı).
     *  - Sensörler (her açılışta açık): kutucukların altındaki CPU/RAM/HDD/fan/pil barı.
     *  - Başarım: kutucuğun ekran alanında htop'un üst panelleri, saniyelik (bkz. screen/index.html Tile.syncPerf,
     *    worker/ankamon/screen/perf.py — yalnız açıkken ve görünen tahtalar için SSH açılır; seçim tarayıcıda kalıcı).
     * Sensörler ve Başarım kutucuklara ait olduğundan Liste'deyken devre dışıdır.
     */
    __createViewControls() {
      this.__screenView = this.__loadScreenView();
      const list = (this._user.ui_prefs || {})["boards.listView"] === true;
      this.__viewButtons = this.__actionBar.addViewControls([
        { id: "screens", label: "Ekranlar", icon: "layoutGrid", group: true, tip: "Tahtaların canlı ekran kutucukları" },
        { id: "list", label: "Liste", icon: "list", group: true, tip: "Tahtaları tablo olarak gösterir" },
        { id: "stats", label: "Sensörler", icon: "temperature", tip: "Kutucukların altında işlemci, bellek, disk sıcaklığı, fan ve pil voltajı barı" },
        { id: "perf", label: "Başarım", icon: "gauge", tip: "Ekran alanında tahtanın anlık işlemci çekirdekleri, bellek, görevler ve yük (htop gibi, saniyelik)" }
      ], (id, on) => {
        if (!this.__viewReady) {
          return;     // açılışta kayıtlı seçim uygulanıyor: yeniden kaydedilmez
        }
        if (id === "list") {
          this.__showListView(on);
          ankamon.page.Base.savePref(this._user, "boards.listView", on);
        } else if (id === "stats" || id === "perf") {
          this.__screenView[id] = on;
          this.__saveScreenView();
          this.__pushView();
        }
      });
      this.__viewButtons.get("stats").setValue(this.__screenView.stats);
      this.__viewButtons.get("perf").setValue(this.__screenView.perf);
      this.__viewButtons.get(list ? "list" : "screens").setValue(true);
      this.__viewReady = true;
      return list;
    },

    /** Liste / ekran görünümü arasında geçer; kutucuğa ait düğmeler Liste'de devre dışı. */
    __showListView(list) {
      this.__views.setSelection([list ? this.__listPage : this.__screensPage]);
      ["stats", "perf"].forEach(id => this.__viewButtons.get(id).setEnabled(!list));
    },

    __loadScreenView() {
      const view = { stats: true, perf: false };
      try {
        Object.assign(view, JSON.parse(localStorage.getItem("ankamon.boards.screenView") || "{}"));
      } catch (e) {
        // localStorage erişilemiyor ya da bozuk — varsayılana düş.
      }
      // Donanım barı her açılışta basılı başlar (kullanıcı isteği: varsayılan etkin) — kapatılması
      // yalnız o oturum için geçerlidir; Başarım seçimi kalıcıdır.
      return { stats: true, perf: view.perf === true };
    },

    __saveScreenView() {
      try {
        localStorage.setItem("ankamon.boards.screenView", JSON.stringify(this.__screenView));
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

    /** Ekran görünümünün altındaki, önizleme kutucuklarının boyutunu ayarlayan slider satırı. */
    __createSizeRow() {
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" })).set({
        padding: [2, 8]
      });
      const caption = new qx.ui.basic.Label("Boyut:").set({ font: "small", textColor: "app-muted" });
      row.add(caption);
      // İnce ve narin (kullanıcı isteği): temanın kalın slider'ı yerine 2 px'lik ray + küçük yuvarlak tutamaç.
      // Renkler etkin temadan (ray app-border, tutamaç temanın seçim rengi); tema değişince yeniden boyanır.
      const slider = new qx.ui.form.Slider().set({
        minimum: 140, maximum: 640, singleStep: 10, value: this.__loadTileSize() || 300, width: 200,
        height: 12, maxHeight: 12, allowGrowY: false, alignY: "middle", decorator: null, padding: 0,
        toolTipText: "Bütün kutucukları aynı boyuta getirir (tek tek boyut: kutucuğun kenarından sürükleyin)"
      });
      const knob = slider.getChildControl("knob").set({
        width: 12, height: 12, minWidth: 12, minHeight: 12, maxHeight: 12, decorator: null, alignY: "middle"
      });
      const paint = () => {
        const mgr = qx.theme.manager.Color.getInstance();
        const pick = (names, fallback) => {
          const name = names.find(n => mgr.isDynamic(n));
          return name ? mgr.resolve(name) : fallback;
        };
        const line = pick(["app-border"], "#c8c8c8");
        const accent = pick(["primary", "background-selected", "selected-start", "table-row-background-selected"], "#0067c0");
        slider.getContentElement().setStyle("background", `linear-gradient(transparent 5px, ${line} 5px, ${line} 7px, transparent 7px)`);
        knob.getContentElement().setStyles({ background: accent, borderRadius: "50%" });
      };
      paint();
      this.__sliderThemeListener = qx.theme.manager.Meta.getInstance().addListener("changeTheme", () => qx.event.Timer.once(paint, this, 0));
      this.__sizeSlider = slider;
      this.__autoSize = !this.__loadTileSize();
      slider.addListener("changeValue", e => {
        if (this.__fitting) {
          return;     // varsayılan boyut uygulanıyor: kaydedilmez, gönderimi __applyFit yapar
        }
        const v = e.getData();
        this.__autoSize = false;
        this.__tileSize = v;
        this.__saveTileSize(v);
        this.__pushSize(true);
        this.__updateSizeLabel();
      });
      this.__tileSize = slider.getValue();
      row.add(slider);
      this.__sizeLabel = new qx.ui.basic.Label("").set({ font: "small", textColor: "app-muted", minWidth: 36 });
      row.add(this.__sizeLabel);
      // Çift tık: hepsi varsayılan boyuta (satırdaki ekran sayısı ekran çözünürlüğünden), tek tek boyutlar silinir.
      [caption, this.__sizeLabel].forEach(label => label.addListener("dblclick", () => this.__resetTileSize()));
      caption.setToolTipText(`Çift tıklayın: hepsi varsayılan boyuta (satırda ${this.__defaultColumns()} ekran)`);
      this.__updateSizeLabel();
      // Yardım: önizleme ve veri toplama bağlantıları — paylaşılan yayın, müdahale, kullanıcı başına bağlantılar (bkz. ui.boards.ScreenFeedHelp).
      row.add(new qx.ui.core.Spacer(), { flex: 1 });
      const help = new qx.ui.form.Button("?").set({
        width: 26, minWidth: 26, padding: [1, 0], font: "bold",
        toolTipText: "Ekranlar ve veri toplama: tahtalara hangi bağlantılar açılır, kullanıcı sayısı yükü artırır mı?"
      });
      help.addListener("execute", () => ankamon.ui.boards.ScreenFeedHelp.open());
      row.add(help);
      return row;
    },

    /** Varsayılan boyutta satırdaki ekran sayısı: kullanıcının ekran genişliğinden (1920 → 5, 1366 → 4, 2560 → 7). */
    __defaultColumns() {
      return Math.min(8, Math.max(2, Math.round(window.screen.width / 384)));
    },

    __resetTileSize() {
      this.__autoSize = true;
      try {
        localStorage.removeItem("ankamon.boards.screenTileSize");
      } catch (e) {
        // sorun değil
      }
      this.__requestFit(true);
    },

    /** Genişliği iframe ölçer (kaydırma çubuğu, boşluklar onda); yanıt "tm-fit" ile __applyFit'e gelir. */
    __requestFit(reset) {
      this.__fitReset = this.__fitReset || reset;
      const el = this.__iframeEl();
      if (el && el.contentWindow) {
        el.contentWindow.postMessage({ type: "tm-fit", cols: this.__defaultColumns() }, window.location.origin);
      }
    },

    __applyFit(px) {
      const value = Math.min(640, Math.max(140, Math.floor(px)));
      const reset = this.__fitReset;
      this.__fitReset = false;
      if (!this.__autoSize || (value === this.__tileSize && !reset)) {
        return;
      }
      this.__fitting = true;
      try {
        this.__sizeSlider.setValue(value);
      } finally {
        this.__fitting = false;
      }
      this.__tileSize = value;
      this.__pushSize(reset);
      this.__updateSizeLabel();
    },

    /**
     * Slider'ın yanındaki % değeri: kutucuk genişliğinin tahta ekranının gerçek genişliğine oranı (ör. 1920
     * px'lik ekran 300 px'lik kutucukta %16). Tahtaların çözünürlüğü önizleme bağlanınca öğrenilir
     * ("tm-res"); farklı çözünürlükte tahtalar varsa en yaygın olanınki, hiç bilinmiyorsa 1920 esas alınır.
     */
    __updateSizeLabel() {
      if (!this.__sizeLabel) {
        return;
      }
      const counts = new Map();
      this.__screenRes.forEach(w => counts.set(w, (counts.get(w) || 0) + 1));
      let width = 1920;
      let best = 0;
      counts.forEach((n, w) => {
        if (n > best) {
          best = n;
          width = w;
        }
      });
      const pct = Math.max(1, Math.round(this.__tileSize * 100 / width));
      this.__sizeLabel.setValue("%" + pct);
      this.__sizeLabel.setToolTipText(`Kutucuk genişliği ${this.__tileSize} px, tahta ekranı ${width} px genişlikte (%${pct} oranında)` +
        (this.__autoSize ? " · varsayılan boyut" : ` · çift tıklayın: varsayılan boyut (satırda ${this.__defaultColumns()} ekran)`));
    },

    __loadTileSize() {
      try {
        const v = parseInt(localStorage.getItem("ankamon.boards.screenTileSize"), 10);
        if (v && v >= 140 && v <= 640) {
          return v;
        }
      } catch (e) {
        // localStorage erişilemiyor olabilir — varsayılana düş.
      }
      return null;    // kayıt yok: varsayılan boyut (bkz. __defaultColumns)
    },

    __saveTileSize(v) {
      try {
        localStorage.setItem("ankamon.boards.screenTileSize", String(v));
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

    /** Ekran penceresi açık tahtaları iframe'e bildirir (kutucuk akışı keser, "Ayrı pencerede izleniyor"). */
    __pushPopped() {
      const el = this.__iframeEl();
      if (el && el.contentWindow) {
        // frames: kapanan pencerelerin son kareleri, kutucuk "Bağlanıyor…" yerine onları gösterir (bkz. Tile.setLastFrame).
        el.contentWindow.postMessage({ type: "tm-popped", ids: ankamon.ui.BoardOps.screenWindowIds(),
          frames: ankamon.ui.BoardOps.takeLastFrames() }, window.location.origin);
      }
    },

    __pushChat() {
      const el = this.__iframeEl();
      if (el && el.contentWindow) {
        el.contentWindow.postMessage({ type: "tm-chat", ids: ankamon.ui.chat.Window.openIds() }, window.location.origin);
      }
    },

    /**
     * Önizleme kutucuklarının ortak boyutunu (CSS değişkeni --tile-min) iframe'e bildirir. reset: slider
     * oynatıldı — kenardan tek tek verilmiş boyutlar silinir, hepsi aynı boyuta gelir (bkz. screen setTileSize).
     */
    __pushSize(reset) {
      const el = this.__iframeEl();
      if (el && el.contentWindow) {
        el.contentWindow.postMessage({ type: "tm-size", px: this.__tileSize, reset: !!reset }, window.location.origin);
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
      // Liste ile kutucuklar hep aynı sırada: sütunla sıralı liste sürüklenen sıraya geçer (sıralama kalkar).
      const model = this.__table.getTableModel();
      if (model.getSortColumnIndex() >= 0) {
        model.clearSorting();
      }
      this.__apply();
      try {
        await ankamon.io.Api.put("/auth/screen-order", { order });
      } catch (e) {
        // sessizce yok sayılır — sıradaki sürükleme yine gönderir, kalıcılık kaybı önemsiz.
      }
    },

    __iframeEl() {
      const dom = this.__frame && this.__frame.getContentElement().getDomElement();
      return dom ? dom.querySelector("iframe") : null;
    },

    __checkScreens() {
      // Stack seçili olmayan görünümü "hidden" yapar ve isSeeable() bunu yakalamaz; Shell sayfa
      // değiştirince ise üst kapsayıcı "excluded" olur ve onu isSeeable() yakalar — ikisine de bakılır.
      const page = this.__screensPage;
      const seen = page.getVisibility() === "visible" && page.isSeeable() && !document.hidden;
      if (seen) {
        this.__screensHiddenAt = null;
        if (!this.__screensRunning) {
          this.__startPreview();
        } else if (this.__screensPaused) {
          this.__pausePreview(false);
        }
      } else if (this.__screensRunning && !this.__screensPaused) {
        const now = Date.now();
        if (this.__screensHiddenAt === null) {
          this.__screensHiddenAt = now;
        } else if (now - this.__screensHiddenAt >= ankamon.page.Boards.SCREENS_STOP_MS) {
          this.__pausePreview(true);
        }
      }
    },

    /**
     * Ekranlar uzun süre görünmeyince akışlar durur ama önizleme sayfası (iframe) kaldırılmaz (kullanıcı
     * isteği: sekme hiçbir zaman yeniden kurulmasın): kutucuklar son görüntüleriyle yerinde kalır; tahta
     * listesi/oturum/durum/sensör güncellemeleri gizliyken de iletilir. Görününce akışlar kaldığı yerden sürer.
     */
    __pausePreview(paused) {
      this.__screensPaused = paused;
      const el = this.__iframeEl();
      if (el && el.contentWindow) {
        el.contentWindow.postMessage({ type: "tm-pause", paused }, window.location.origin);
      }
    },

    __screensPaused: false,

    /** __apply'ın setData'sı sürerken true: ara (sırasız) model olayları kutucuk sırasına yansımaz (bkz. __syncShownOrder). */
    __settingRows: false,

    /** Wi-Fi Monitör'ün radyo değişikliği bildirimiyle sıraya alınmış tek tazeleme (bkz. __onWifiRadio). */
    __wifiRefreshQueued: false,

    /**
     * O an GÖSTERİLEN (süzülmüş) tahtalar, listenin satır sırasıyla (bkz. __syncShownOrder): liste
     * sütunla sıralıysa o sıra, değilse kutucukların sürükle-bırak sırası (__inScreenOrder).
     */
    __orderedShown() {
      return this.__shownBoards || [];
    },

    __previewList() {
      const whoami = this.__whoamiState || new Map();
      const metrics = this.__metrics || {};
      return this.__orderedShown().map(b => {
        // WoL yazısı (bkz. __sessionOps wolSent) tahta açılınca kalkar; "Kapanıyor…" (shutdownSent) tahta kapanınca
        // ya da kapanmadıysa SHUTDOWN_NOTE_MS sonra.
        const w = whoami.get(b.id);
        if (w && ((w.wol && b.online) || (w.off && (!b.online || Date.now() - w.off > ankamon.page.Boards.SHUTDOWN_NOTE_MS)))) {
          whoami.delete(b.id);
        }
        // Kutucuğun alt barı (bkz. screen/index.html Tile.setStats): grid'in İşlemci/Bellek/sensör
        // sütunlarıyla aynı son ölçümler — yalnız çevrimiçi tahtada (eski ölçüm kapalı tahtada yanıltır).
        const m = b.online ? metrics[b.id] : null;
        return {
          id: b.id, name: b.label || b.hostname || b.ip || ("#" + b.id), online: !!b.online, alive: !!(b.alive ?? b.online),
          whoami: whoami.get(b.id) || null,
          // "Oturumu açık kullanıcı yok (23 dk)": oturumsuz durumun başladığı an (epoch sn; bkz. BoardsApi
          // no_session_since) — kutucuk süreyi kendisi sayar.
          noSessionSince: b.online ? b.no_session_since || null : null,
          refresh: (this.__tileRefresh && this.__tileRefresh.get(b.id)) || 0,
          // Monitör DPMS ile kapalı (bkz. 025_board_display_state.sql): kutucukta "Ekran güç tasarrufu kipinde".
          powersave: !!b.online && ["Off", "Standby", "Suspend"].includes(b.display_state),
          // Alt bardaki ağ simgeleri ve güç tasarrufu yazısının altındaki TiHA otomatik kapatma geri sayımı
          // (bkz. migration 026, worker executor/netif.py + autoshutdown.py) — yalnız çevrimiçi tahtada.
          net: b.online ? b.netifs || null : null,
          autoshutdown: b.online ? b.autoshutdown || null : null,
          hide: this.__statsHidden()[b.id] || [],
          hw: this.__hwSummary(b.facts),
          stats: m ? {
            cpu: m.cpu_percent ?? null, mem: m.mem_percent ?? null, temp: m.cpu_temp ?? m.temp_max ?? null,
            disk_temp: m.disk_temp ?? null, fan: m.fan_rpm ?? null, battery: m.battery_v ?? null
          } : null
        };
      });
    },

    /**
     * Ekranlar "Başarım" görünümünün üstündeki donanım satırı: işlemci modeli (çekirdek/iş parçacığı,
     * en yüksek hız), RAM ve sistem diski — Bilgi kartının topladığı facts'ten (bkz. worker
     * executor/hwfacts.py); henüz toplanmamışsa null. Örn. "Intel Core i3-4000M · 2 çekirdek / 4 iş
     * parçacığı @ 2.40 GHz · RAM 7.2 GB · Disk 238.5 GB SSD (SAMSUNG MZ7TE256HMHP-000FH)".
     */
    __hwSummary(f) {
      if (!f || !f.cpu_model) {
        return null;
      }
      const gb = bytes => (bytes / 1073741824).toFixed(1) + " GB";
      const model = String(f.cpu_model).replace(/\((R|TM|tm)\)/g, "").replace(/\s+@.*$/, "")
        .replace(/\s+(CPU|APU)\b.*$/, "").replace(/\s+/g, " ").trim();
      const phys = f.cpu_phys_cores, threads = f.cpu_cores;
      let cpu = model;
      if (phys && threads && phys !== threads) {
        cpu += ` · ${phys} çekirdek / ${threads} iş parçacığı`;
      } else if (threads || phys) {
        cpu += ` · ${threads || phys} çekirdek`;
      }
      if (f.cpu_max_mhz) {
        cpu += ` @ ${(f.cpu_max_mhz / 1000).toFixed(2)} GHz`;
      }
      const parts = [cpu];
      // Takılı bellek (SMBIOS) — MemTotal değil: 8 GB modül işletim sisteminde ~7.2 GB görünür.
      if (f.mem_installed_bytes || f.mem_total_bytes) {
        parts.push("RAM " + ankamon.ui.FactsView.ramText(f));
      }
      if (f.disk_total_bytes) {
        const kind = f.disk_rotational === 0 ? " SSD" : f.disk_rotational === 1 ? " HDD" : "";
        parts.push(`Disk ${gb(f.disk_total_bytes)}${kind}` + (f.disk_model ? ` (${f.disk_model})` : ""));
      }
      return parts.join(" · ");
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
     * Önizleme kutucuğunun sağ menüsü — grid satırınınkiyle AYNI (__rowMenu); yalnız "Kullanıcılar" altındaki
     * Oturum aç / Oturumu kapat / Oturumları sorgula burada sessionOps ile iş penceresi yerine kutucuk
     * durumuna yönlendirilir (bkz. __sessionOps). Çoklu seçim: iframe'de Shift/Ctrl ile seçilenler (bkz.
     * docker/rootfs/screen/index.html "tm-menu").
     * @param ids {Array?} iframe'deki o anki çoklu seçim (sağ tıklanan dahil); verilmezse/tek
     *   elemanlıysa yalnız bu tek tahta — bkz. BoardOps.menu boards parametresiyle aynı desen.
     */
    __openPreviewMenu(id, x, y, ids) {
      this.__openPreviewMenuAt(id, x, y, ids, this.__iframeEl());
    },

    /**
     * Önizleme kutucuğunun sağ menüsü, konum verilen iframe öğesine GÖRE hesaplanır (x/y iframe içi
     * koordinat) — menü içeriği grid satırıyla AYNI (__rowMenu).
     */
    __openPreviewMenuAt(id, x, y, ids, el) {
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
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      menu.openAtPoint({ left: Math.round(rect.left + x), top: Math.round(rect.top + y) });
    },

    /** Bu kullanıcının tahta başına gizlediği göstergeler: {"<tahta id>": ["fan", …]} (users.ui_prefs["screens.stats"]). */
    __statsHidden() {
      return ((this._user && this._user.ui_prefs) || {})["screens.stats"] || {};
    },

    /**
     * Kutucuğun alt barına sağ tık (bkz. screen/index.html "tm-statsmenu"): hangi göstergelerin görüneceği.
     * İşaretler sağ tıklanan tahtanın durumunu gösterir; değişiklik o an seçili TÜM kutucuklara uygulanır
     * (seçim dışına sağ tıklanınca seçim o kutucuğa iner). Seçim kullanıcının tercihi olarak sunucuda saklanır
     * (AuthApi::prefs, "screens.stats") — sekmeye her girişte ve başka tarayıcıda da aynı görünür.
     */
    __openStatsMenu(id, x, y, ids) {
      const targets = (ids && ids.length ? ids : [id]).map(String);
      const hiddenOf = bid => new Set(this.__statsHidden()[bid] || []);
      const current = hiddenOf(String(id));
      const menu = new qx.ui.menu.Menu();
      menu.add(new qx.ui.menu.Button(targets.length > 1 ? `Göstergeler — seçili ${targets.length} tahta` : "Göstergeler").set({ enabled: false }));
      menu.add(new qx.ui.menu.Separator());
      const apply = mutate => {
        const map = Object.assign({}, this.__statsHidden());
        targets.forEach(bid => {
          const set = hiddenOf(bid);
          mutate(set);
          if (set.size) {
            map[bid] = [...set];
          } else {
            delete map[bid];
          }
        });
        const prefs = this._user.ui_prefs || (this._user.ui_prefs = {});
        prefs["screens.stats"] = map;
        ankamon.io.Api.put("/auth/prefs", { key: "screens.stats", value: map }).catch(e => ankamon.ui.Dialog.error(e));
        this.__pushPreview();
      };
      ankamon.page.Boards.STATS_ITEMS.forEach(([key, label]) => {
        const box = new qx.ui.menu.CheckBox(label).set({ value: !current.has(key) });
        box.addListener("changeValue", e => apply(set => (e.getData() ? set.delete(key) : set.add(key))));
        menu.add(box);
      });
      menu.add(new qx.ui.menu.Separator());
      const all = new qx.ui.menu.Button("Tümünü göster");
      all.addListener("execute", () => apply(set => set.clear()));
      menu.add(all);
      if (this.__previewMenu) {
        const old = this.__previewMenu;
        qx.event.Timer.once(() => old.destroy(), null, 0);
      }
      this.__previewMenu = menu;
      const el = this.__iframeEl();
      if (el) {
        const rect = el.getBoundingClientRect();
        menu.openAtPoint({ left: Math.round(rect.left + x), top: Math.round(rect.top + y) });
      }
    },

    /** "Oturumları sorgula": seçili tahtalarda o an oturum açmış kullanıcıyı paralel sorgular;
     * eşzamanlılık worker'da yüke göre dinamik (bkz. whoami.dynamic_concurrency). */
    __startWhoamiQuery(boardIds, quiet = false) {
      if (quiet) {
        // Kendiliğinden sorgu (kutucuk canlıya geçti) "Kapanıyor…" yazan tahtayı atlar (bkz. __sessionOps shutdownSent).
        boardIds = boardIds.filter(id => !((this.__whoamiState && this.__whoamiState.get(id)) || {}).off);
      }
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
      // "Kapanıyor…" (bkz. __sessionOps shutdownSent) kapanana dek kalır: kendiliğinden oturum sorgusu üstüne yazmaz.
      if (!board || !board.online || !this._can("screen") || (st && (st.status === "querying" || st.off))) {
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
     * kullanıcı adı (ya da "Oturumu açık kullanıcı yok") görünür.
     */
    __sessionOps() {
      const known = id => {
        const st = this.__whoamiState && this.__whoamiState.get(id);
        return st && st.status === "ok" && st.text ? st.text : "";
      };
      return {
        // Bilgisayarı aç (WoL): görev başlayınca kapalı kutucuğun kullanıcı adı alanında "SS:DD:sn Magic paket
        // gönderildi" (kullanıcı isteği). Tahta çevrimiçi olunca kalkar (bkz. __previewList).
        wolSent: boards => {
          if (!this.__whoamiState) {
            this.__whoamiState = new Map();
          }
          const at = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          boards.forEach(b => this.__whoamiState.set(b.id, { status: "ok", text: `${at} Magic paket gönderildi`, wol: true }));
          this.__pushPreview();
        },
        // Bilgisayarı kapat: komut tahtaya ulaşınca (iş hedefi "ok" — "Kapatma komutu verildi.") kutucuğun sol altında
        // "Kapanıyor…" (kullanıcı isteği 2026-11-10); ulaşamazsa kutucuk olduğu gibi kalır (hata çıktı penceresinde).
        // Tahta kapanınca kalkar (bkz. __previewList).
        shutdownSent: (jobId, boards) => {
          if (!this.__whoamiState) {
            this.__whoamiState = new Map();
          }
          const before = new Map(boards.map(b => [b.id, this.__whoamiState.get(b.id)]));
          this.__pollSession(jobId, new Set(boards.map(b => b.id)),
            t => (t.status === "ok" ? { status: "ok", text: "Kapanıyor…", off: Date.now() } : before.get(t.board_id)));
        },
        query: boards => this.__startWhoamiQuery(boards.map(b => b.id)),
        login: (boards, acc) => this.__sessionJob(boards.map(b => b.id), { type: "login", username: acc.name },
          () => `${acc.name} oturumu açılıyor…`,
          t => (t.status === "ok" ? { status: "ok", text: acc.name } : { status: "error", text: "Oturum açılamadı" })),
        logout: boards => this.__sessionJob(boards.map(b => b.id), { type: "logout" },
          id => (known(id) ? `${known(id)} oturumu kapatılıyor…` : "Oturum kapatılıyor…"),
          t => (t.status === "ok" ? { status: "ok", text: "" } : { status: "error", text: "Oturum kapatılamadı" })),
        // Ekran ▸ Uyandır: kutucukta geçici "Ekran uyandırılıyor…"; bitince önceki oturum bilgisi geri gelir
        // (uyandırma oturumu değiştirmez), hata olursa "Uyandırılamadı".
        wake: boards => {
          const before = new Map(boards.map(b => [b.id, this.__whoamiState && this.__whoamiState.get(b.id)]));
          this.__sessionJob(boards.map(b => b.id), { type: "wake" }, () => "Ekran uyandırılıyor…",
            t => {
              if (t.status !== "ok") {
                return { status: "error", text: "Uyandırılamadı" };
              }
              // "Güç tasarrufu" yazısı tahta listesinin bir sonraki tazelenmesini beklemeden kalksın.
              const board = this.__boards.get(t.board_id);
              if (board) {
                board.display_state = "On";
              }
              return before.get(t.board_id) || { status: "ok", text: known(t.board_id) };
            });
        },
        // Ekran ▸ Uyut: Uyandır'ın eşi; başarılıysa kutucuk hemen "güç tasarrufu" yazısına geçer.
        sleep: boards => {
          const before = new Map(boards.map(b => [b.id, this.__whoamiState && this.__whoamiState.get(b.id)]));
          this.__sessionJob(boards.map(b => b.id), { type: "sleep" }, () => "Ekran uyutuluyor…",
            t => {
              if (t.status !== "ok") {
                return { status: "error", text: "Uyutulamadı" };
              }
              const board = this.__boards.get(t.board_id);
              if (board) {
                board.display_state = "Off";
              }
              return before.get(t.board_id) || { status: "ok", text: known(t.board_id) };
            });
        },
        // Ekran ▸ Kilitle / Kilidi aç: tahta işi teyit edene dek kutucukta "Kilitleniyor…"; teyitten sonra akış
        // yeniden kurulur (kilit görseli görünür), yeni görüntü gelince önceki oturum bilgisi geri döner (ekran
        // kilidi oturumu değiştirmez). Grid'in "Oturum" hücresi tazelemeyi beklemeden "/ Kilitli" alır/bırakır.
        screenLock: (boards, on) => {
          const before = new Map(boards.map(b => [b.id, this.__whoamiState && this.__whoamiState.get(b.id)]));
          const pending = on ? "Kilitleniyor…" : "Kilit açılıyor…";
          this.__sessionJob(boards.map(b => b.id), { type: on ? "screen_lock" : "screen_unlock" }, () => pending,
            t => {
              if (t.status !== "ok") {
                return { status: "error", text: on ? "Kilitlenemedi" : "Kilit açılamadı" };
              }
              const board = this.__boards.get(t.board_id);
              if (board) {
                board.screen_locked = on;
                if (on) {
                  board.display_state = "On"; // kilitleme ekranı uyandırır: "güç tasarrufu" örtüsü kilidi kapatmasın
                }
              }
              this.__refreshTile(t.board_id, () => {
                const prev = before.get(t.board_id);
                if (prev) {
                  this.__whoamiState.set(t.board_id, prev);
                } else {
                  this.__whoamiState.delete(t.board_id);
                }
                this.__pushPreview();
              });
              return { status: "querying", text: pending };
            });
        },
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
     * Kutucuğun akışını yeniden kurdurur (bkz. screen/index.html Tile.refreshStream); yeni görüntü gelince
     * ("tm-refreshed") ya da en geç TILE_REFRESH_MS sonra done() çağrılır — kutucuk o an görünmüyor, akış
     * kurulamıyor olsa da yazı takılı kalmaz.
     */
    __refreshTile(id, done) {
      this.__tileRefresh = this.__tileRefresh || new Map();
      this.__tileRefreshDone = this.__tileRefreshDone || new Map();
      this.__tileRefresh.set(id, (this.__tileRefresh.get(id) || 0) + 1);
      this.__tileRefreshDone.set(id, done);
      qx.event.Timer.once(() => {
        if (this.__tileRefreshDone.get(id) === done) {
          this.__tileRefreshed(id);
        }
      }, this, ankamon.page.Boards.TILE_REFRESH_MS);
    },

    __tileRefreshed(id) {
      const done = this.__tileRefreshDone && this.__tileRefreshDone.get(id);
      if (done) {
        this.__tileRefreshDone.delete(id);
        done();
      }
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
        res = await ankamon.io.Api.post("/jobs", Object.assign({ board_ids: boardIds }, body));
      } catch (e) {
        boardIds.forEach(id => this.__whoamiState.set(id, { status: "error", text: "Başlatılamadı" }));
        this.__pushPreview();
        if (!quiet) {
          ankamon.ui.Dialog.error(e);
        }
        return;
      }
      this.__pollSession(res.id, new Set(boardIds), resultOf);
    },

    /** /api/jobs/{id}'yi kısa aralıkla okur; bitiren her tahtanın sonucunu ANINDA (en yavaşı
     * beklemeden) yansıtır — hepsi bitince kendiliğinden durur (bkz. ui.Jobs'taki aynı desen). */
    __pollSession(jobId, pending, resultOf) {
      ankamon.io.Api.get(`/jobs/${jobId}`).then(res => {
        let changed = false;
        ((res.job && res.job.targets) || []).forEach(t => {
          if (!pending.has(t.board_id) || ["queued", "running"].includes(t.status)) {
            return;
          }
          pending.delete(t.board_id);
          const state = resultOf(t);
          const cur = this.__whoamiState.get(t.board_id);
          if (cur && cur.off && !(state && state.off)) {
            return; // kapatma komutu ulaştı: öncesinde başlamış bir sorgunun sonucu "Kapanıyor…"yu silmesin
          }
          if (state) {
            this.__whoamiState.set(t.board_id, state);
          } else {
            this.__whoamiState.delete(t.board_id);
          }
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

    /**
     * Grid'deki işaretleri Ekranlar kutucuklarına yansıtır (bkz. __pushSelection). Tablo modelinin
     * "dataChanged" olayına bağlıdır (onay kutusu tıklaması, Tümünü işaretle/kaldır, süzgeç/yenileme).
     */
    __updateActionState() {
      if (this.__applyingPreview) {
        return; // __checkFromPreview satır satır işaretlerken her satırda değil, sonunda bir kez
      }
      this.__pushSelection();
      if (this.__actionBar) {
        this.__actionBar.refresh();
      }
    },

    /** Tahta ekle / Düzenle penceresi — ortak (bkz. ui.BoardOps.editBoard; Bakım ▸ Ahenk sağ menüsü de kullanır). */
    __edit(board) {
      ankamon.ui.BoardOps.editBoard(board, () => this.refresh(), this._user);
    },

    /**
     * Satır sağ menüsü: BoardOps.menu() çevrimiçi/çevrimdışına göre Komut çalıştır / Ekran / … ve
     * yan yana Bilgisayarı aç (WoL) + Bilgisayarı kapat ekler (bkz. ui.BoardOps) — burada bu sayfaya
     * özgü kayıt işlemleri (Düzenle / Sil), Logları göster (Loglar sayfasını bu tahtaya süzülmüş
     * açar — bkz. ui.Shell.OPEN_LOGS) ve hemen altında Bilgi kartı eklenir.
     */
    __rowMenu(board, boards = [board], sessionOps = null) {
      const menu = ankamon.ui.BoardOps.menu(board, this._user, boards, sessionOps) || new qx.ui.menu.Menu();
      const ICON = ankamon.ui.Shell.ICON;
      const add = (icon, label, handler) => menu.add(ankamon.ui.BoardOps.menuButton(icon, label, handler.bind(this)));
      // Logları göster + Bilgi kartı: ortak (bkz. BoardOps.logsAndInfo — Bakım ▸ Ahenk sağ menüsü de kullanır).
      const extra = ankamon.ui.BoardOps.logsAndInfo(board, this._user, boards).map(item => () => menu.add(item));
      // Bilgisayarı aç (WoL) artık BoardOps.menu'de "Bilgisayarı kapat"ın hemen yanında (kullanıcı
      // isteği: ikisi komşu); çevrimiçi tahtada orada devre dışı görünür.
      if (this._can("boards.manage")) {
        // Çoklu seçimde toplu düzenleme (ui.network.DeviceBulkEdit — kullanıcı isteği 2026-11-10).
        extra.push(() => add(ICON.edit, "Düzenle" + (boards.length > 1 ? ` (${boards.length} tahta)` : ""), () => (boards.length > 1
          ? ankamon.ui.network.DeviceBulkEdit.open({ boards, user: this._user, onSaved: () => this.refresh() })
          : this.__edit(board))));
        extra.push(() => add(ICON.delete, "Sil" + (boards.length > 1 ? ` (${boards.length} tahta)` : ""),
          () => this.__delete(boards)));
      }
      if (extra.length) {
        if (menu.getChildren().length) {
          menu.add(new qx.ui.menu.Separator());
        }
        extra.forEach(fn => fn());
      }
      // Eski üst düğme satırından (kullanıcı isteğiyle kaldırıldı) buraya taşınanlar: grid işaretleri
      // (yalnız o an GÖRÜNEN/süzülmüş satırlar — bkz. _checkAll) ve elle tahta ekleme.
      const shown = (this.__shownBoards || []).length;
      const checked = this._checkedIds(this.__table).length;
      menu.add(new qx.ui.menu.Separator());
      add(ICON.checkAll || "☑", "Tümünü işaretle" + (shown ? ` (${shown})` : ""), () => this._checkAll(this.__table, true));
      add(ICON.uncheckAll || "☐", "İşaretleri kaldır" + (checked ? ` (${checked})` : ""), () => this._checkAll(this.__table, false));
      menu.getChildren()[menu.getChildren().length - 1].setEnabled(checked > 0);
      if (this._can("boards.manage")) {
        add(ICON.add || "＋", "Tahta ekle…", () => this.__edit(null));
      }
      return menu;
    },

    /**
     * Bir ya da daha fazla tahtayı; loglarını ve sensör geçmişini de dahil ederek TAMAMEN siler
     * (toolbar "Sil" düğmesi işaretli tüm tahtaları, satır sağ menüsü tek tahtayı [board] olarak
     * gönderir) — bkz. backend BoardsApi::delete (logs + metrics). Silinen tahta engellenmez: hâlâ
     * log gönderiyorsa worker kaydı kendiliğinden yeniden açar.
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
      const sure = await ankamon.ui.Dialog.confirm(question, "Sil");
      if (!sure) {
        return;
      }

      const win = ankamon.ui.Dialog.window("Siliniyor…", 480);
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
          const r = await ankamon.io.Api.del("/boards/" + board.id);
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
      ankamon.ui.Dialog.buttons(win, [close]);
    }
  }
});
