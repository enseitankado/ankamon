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
 * Sağ menü / araç çubuğu "Wi-Fi Monitör": seçili bütün tahtalar (sensörler) TEK pencerede, iki sekmede (kullanıcı isteği
 * 2026-11-10): "Tespitler" (varsayılan) bütün sensörlerin bulguları — satır başındaki onay kutusuyla işaretlenen satırlara güven
 * işlemleri uygulanır; "Sensörler" her sensörün tarama/izleme durumu, kipi, kartı ve sayıları. İki grid'de de sütunlar süzülür
 * (hazır değer listesiyle), sıralanır, sırası değiştirilir. Amaç sınıfa getirilmiş telefonları bulmak: sensörlerin duyduğu
 * Wi-Fi ağları, Wi-Fi arayan ve Wi-Fi'ye bağlı cihazlar "güvenilir" listesine (MAC adresiyle, sunucuda — /api/wifimon/fixed)
 * göre ayrılır; güvenilir olmayanlar telefon kanıtına göre öne çıkarılır (bkz. ui.boards.WifimonClassify, ui.boards.WifimonRender).
 * Bluetooth kullanılmaz. Pencere zaten açıksa yeni tahtalar ona eklenir.
 *
 * Her sensör için ayrı WebSocket (worker screen/wifi.py). "Sürekli izle" varsayılan açık (kullanıcı isteği). Kapalı Wi-Fi tarama
 * süresince geçici açılır (kayıtlı ağa bağlanmaz), pencere kapanınca eski durumuna döner; Tahtalar grid'inin Wi-Fi sütunu dinleme
 * sürerken "Monitör modu" gösterir, kapanışta tazelenir.
 *
 * SSH güvenliği (kullanıcı isteği): tahta ağa yalnız Wi-Fi ile bağlıysa kart monitör kipine alınmaz (SSH erişimi kopardı) — yalnız
 * ağ taraması yapılır; hem kabloyla hem Wi-Fi ile bağlı tahtalar ancak kullanıcı onaylarsa dinlenir (Wi-Fi bağlantıları pencere
 * açık kaldıkça kesilir, kapanınca yeniden kurulur). Tahtadaki program da SSH'nin Wi-Fi'den gelip gelmediğini ayrıca denetler.
 */
qx.Class.define("ankamon.ui.boards.WifiMonitor", {
  type: "static",

  statics: {
    /** Sürekli izlemede yoklama ve bağlı cihaz satırı son duyuluşundan bu kadar sonra listeden düşer. */
    PROBE_KEEP_MS: 5 * 60 * 1000,

    HELP: "Bu pencere seçili tahtaların (<b>sensörlerin</b>) çevresindeki Wi-Fi vericilerini gösterir: <b>Tespitler</b> sekmesinde bulgular, " +
      "<b>Sensörler</b> sekmesinde her sensörün durumu (<i>İzleniyor</i> = sürekli izleme sürüyor; çift tık: o sensörün " +
      "tespitleri). Sınıfın/okulun olağan erişim noktalarını ve cihazlarını <b>güvenilir</b> işaretleyin — satır başındaki kutuyla " +
      "işaretleyip <i>Bu sınıfta güvenilir</i> / <i>Okul genelinde güvenilir</i> (Tespitler sekmesindeki düğmeler ya da sağ tık) ya da toptan (sınıflar boşken) <i>Görünenleri güvenilir yap</i>; güven " +
      "<b>MAC adresiyle</b> kurulur (aynı adı taşıyan bir telefon paylaşım noktası okulun ağı sayılmaz). Sonra gerisi " +
      "<b>yabancı</b> olarak öne çıkar. <b>Neler görülebilir:</b> telefonun paylaşım noktası (hotspot) açıksa Wi-Fi ağı olarak; " +
      "Wi-Fi'si açık ama bağlı değilse ara ara gönderdiği <b>yoklamalarla</b> (Wi-Fi arayan cihaz; Tür sütununda aradığı ağ " +
      "sayısı, ipucunda adları). Telefonlar ağ ararken her taramada yeni bir <b>rastgele adres</b> kullanır; aynı cihaz " +
      "sayılan adresler tek satırda toplanır (Kanıt sütununda <i>N adres</i>; ölçütler: aynı WPS kimliği, aynı aranan ağ listesi, " +
      "802.11 sıra numarası sürekliliği, aynı yetenek parmak izi ve yakın sinyal — kestirimdir); bir Wi-Fi ağına bağlıysa gönderdiği veri çerçeveleriyle <b>Wi-Fi'ye bağlı cihaz</b> olarak " +
      "(içerik şifreli, yalnız adresler görülür). Bu ikisi Wi-Fi trafiği dinlenerek bulunur: sensörün Wi-Fi kartı dinleme " +
      "süresince monitör kipine alınır (Tahtalar listesinin Wi-Fi sütununda <i>Monitör modu</i>). Ağa yalnız Wi-Fi ile bağlı " +
      "tahta monitör kipine alınmaz (SSH erişimi kopardı); hem kablo hem Wi-Fi ile bağlı tahtalar onayınızla dinlenir (Wi-Fi " +
      "bağlantıları pencere kapanana dek kesilir). Kanıttaki <i>N sensörde</i>: aynı MAC adresini duyan sensör sayısı. " +
      "<b>Sınırlar:</b> ekranı kapalı telefon seyrek yoklar, bağlı telefon yalnız dinlenen kanalda ve o anda bir şey " +
      "gönderiyorsa görülür — <i>Sürekli izle</i> açık kalsın; uçak kipindeki ya da Wi-Fi'si kapalı telefon görülemez; sinyal " +
      "gücü yalnız kaba bir yakınlık ipucudur, komşu sınıftaki telefon da duyulabilir.",

    __win: null,

    /**
     * Message Bus konusu (veri: tahta kimliği): bir tahtanın Wi-Fi kartının durumu değişti (geçici açıldı, monitör kipine
     * girdi, kapanınca eski durumuna döndü). Sunucu yeni durumu boards.facts'e yazmıştır; Tahtalar listesi kendini tazeler.
     */
    RADIO_CHANGED: "ankamon.wifimon.radio",

    /**
     * Tahta başına dinleme planı: {force} (kablo + Wi-Fi bağlı, kullanıcı onayladı: Wi-Fi bağlantısı kesilip dinlenir) ya da
     * {noSniff: "wifionly"|"declined"} (yalnız ağ taraması). Kablo bilgisi Tahtalar listesinin Kablo sütunuyla aynı kaynaktan
     * (page.Boards.cableText); kesin koruma tahtadadır (SSH Wi-Fi'den geliyorsa asla monitör kipi — worker wifi_remote_scan.py).
     */
    async __wifimonPlan(boards) {
      const plan = new Map();
      const wifiUp = b => (b.facts || {}).wifi_state === "connected";
      const cabled = b => /^Bağlı/.test(ankamon.page.Boards.cableText(b) || "");
      const name = b => b.label || b.hostname || b.ip || "#" + b.id;
      const both = boards.filter(b => wifiUp(b) && cabled(b));
      boards.filter(b => wifiUp(b) && !cabled(b)).forEach(b => plan.set(b.id, { noSniff: "wifionly" }));
      if (both.length) {
        const esc = qx.bom.String.escape;
        const ok = await ankamon.ui.Dialog.confirm(
          `<b>${both.map(b => esc(name(b))).join(", ")}</b> hem kabloyla hem Wi-Fi ile bağlı.<br><br>Wi-Fi trafiğini dinlemek için ` +
          `${both.length > 1 ? "bu tahtaların" : "bu tahtanın"} <b>Wi-Fi bağlantısı kopacak</b> ve pencere açık kaldıkça kopuk ` +
          "kalacak (kablo bağlantısı ve uzaktan erişim sürer); pencere kapanınca Wi-Fi yeniden bağlanır.<br><br>Dinlemeye dahil " +
          "edilsin mi? <i>Vazgeç</i> derseniz bu tahtalarda yalnız ağ taraması yapılır.", "Dahil et (Wi-Fi kopacak)");
        both.forEach(b => plan.set(b.id, ok ? { force: true } : { noSniff: "declined" }));
      }
      return plan;
    },

    /**
     * @param boards {Array} tahtalar (çevrim içi olanlar)
     * @param user {Map?} oturumdaki kullanıcı (grid sütun tercihleri için)
     */
    async open(boards, user) {
      boards = (Array.isArray(boards) ? boards : [boards]).filter(Boolean);
      if (!boards.length) {
        return;
      }
      if (this.__win && this.__win.ctx) {
        const fresh = boards.filter(b => !this.__win.ctx.has(b.id));
        const plan = await this.__wifimonPlan(fresh);
        fresh.forEach(board => this.__win.ctx.addBoard(board, plan.get(board.id) || {}));
        this.__win.open();
        this.__win.focus();
        return;
      }
      const plan = await this.__wifimonPlan(boards);
      const bounds = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280 };
      const win = ankamon.ui.Dialog.window("Wi-Fi Monitör", Math.max(900, Math.min(1400, bounds.width - 40)), { maximizable: true });
      win.setHeight(640);
      this.__win = win;
      win.ctx = this.__createWifimonContext(win, user);
      boards.forEach(board => win.ctx.addBoard(board, plan.get(board.id) || {}));
      win.addListener("close", () => {
        win.ctx.closeAll();
        win.ctx = null;
        if (this.__win === win) {
          this.__win = null;
        }
      });
      win.open();
      win.ctx.loadFixed();
    },

    __createWifimonContext(win, user) {
      const Classify = ankamon.ui.boards.WifimonClassify;
      const Render = ankamon.ui.boards.WifimonRender;
      const Base = ankamon.page.Base;

      // Üst satır (iki sekmede ortak): tarama denetimleri.
      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(10).set({ alignY: "middle" }));
      const refresh = new qx.ui.form.Button("Yenile");
      const watchBox = new qx.ui.form.CheckBox("Sürekli izle").set({
        value: true,
        toolTipText: "Açıkken liste sürekli tazelenir (Sensörler sekmesinde 'İzleniyor'); tahtada geçici açılan radyo izleme bitene kadar açık kalır."
      });
      const probeBox = new qx.ui.form.CheckBox("Wi-Fi trafiğini dinle").set({
        value: true,
        toolTipText: "Ağ arayan cihazların yoklamalarını ve bir ağa bağlı cihazların veri çerçevelerini dinler (sensörün Wi-Fi kartı " +
          "dinleme süresince monitör kipine alınır; ağa yalnız Wi-Fi ile bağlı tahtada yapılmaz)."
      });
      const fixedBox = new qx.ui.form.CheckBox("Güvenilirleri göster");
      const help = new qx.ui.form.Button("?").set({ toolTipText: "Neler görülebilir, sınırlar" });
      [refresh, watchBox, probeBox, fixedBox].forEach(w => bar.add(w));
      bar.add(new qx.ui.core.Spacer(), { flex: 1 });
      bar.add(help);
      win.add(bar);

      // Sekmeler (kullanıcı isteği 2026-11-10): Tespitler (varsayılan) ve Sensörler, her biri kendi grid'iyle.
      const tabs = new qx.ui.tabview.TabView().set({ contentPadding: 6 });
      const findingsPage = new qx.ui.tabview.Page("Tespitler");
      findingsPage.setLayout(new qx.ui.layout.VBox(6));
      const sensorsPage = new qx.ui.tabview.Page("Sensörler");
      sensorsPage.setLayout(new qx.ui.layout.VBox(6));
      tabs.add(findingsPage);
      tabs.add(sensorsPage);
      win.add(tabs, { flex: 1 });

      // Tespitler: güven işlemleri satır başındaki onay kutusuyla işaretlenen satırlara uygulanır.
      const trustBar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      const trustClass = new qx.ui.form.Button("Bu sınıfta güvenilir AP").set({ enabled: false });
      const trustSchool = new qx.ui.form.Button("Okul genelinde güvenilir AP").set({ enabled: false });
      const untrust = new qx.ui.form.Button("Güvenilirlikten çıkar").set({ enabled: false });
      const checkedInfo = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
      const baseline = new qx.ui.form.Button("Görünenleri güvenilir yap…").set({
        toolTipText: "Şu an görünen bütün kalıcı adresli vericileri kendi sınıflarına güvenilir işaretler (sınıflar boşken yapın)."
      });
      const manage = new qx.ui.form.Button("Güvenilir listesi…");
      [trustClass, trustSchool, untrust, checkedInfo].forEach(w => trustBar.add(w));
      trustBar.add(new qx.ui.core.Spacer(), { flex: 1 });
      [baseline, manage].forEach(w => trustBar.add(w));
      findingsPage.add(trustBar);

      // Grid'ler: page.Base yardımcılarıyla (süzgeç kutuları + hazır değer listesi, sütun sırası/gizleme tercihi).
      const host = new ankamon.ui.boards.WifimonGridHost(user);
      const columns = Render.COLUMNS;
      const table = host._createTable(columns, { prefsKey: "wifimon.columns", checkable: true });
      const sensorColumns = Render.SENSOR_COLUMNS;
      const sensorTable = host._createTable(sensorColumns, { prefsKey: "wifimon.sensors.columns" });
      let meta = new Map();
      let sensorMeta = new Map();
      let allRows = [];
      let sensorRows = [];
      const checked = new Set(); // işaretli tespit satırları (kimlik) — tablo her tazelemede yeniden kurulduğu için burada
      Render.attach(table, columns, id => meta.get(id));
      Render.attach(sensorTable, sensorColumns, id => sensorMeta.get(id));
      findingsPage.add(table, { flex: 1 });
      sensorsPage.add(sensorTable, { flex: 1 });

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const feeds = new Map();
      let fixed = [];
      let fixedIndex = new Map();
      let closed = false;
      let renderQueued = false;

      // Süzgeci uygular; seçim (ışıklı satırlar) ve kaydırma yeri korunur, sıralama Base.keepSortOnReload ile.
      const applyTo = (tbl, cols, fields, rows, offset) => {
        const active = cols.map((c, i) => ({ i, text: (fields[c.id].getValue() || "").trim() })).filter(f => f.text);
        const shown = rows.filter(cells => active.every(f => Base.filterMatch(cells[offset + f.i], f.text)));
        const tm = tbl.getTableModel();
        const sel = tbl.getSelectionModel();
        const ids = new Set();
        sel.iterateSelection(r => ids.add(tm.getValue(0, r)));
        const scroller = tbl.getPaneScroller(0);
        const top = scroller.getScrollY();
        tm.setData(shown);
        if (ids.size) {
          sel.setBatchMode(true);
          sel.resetSelection();
          for (let r = 0; r < tm.getRowCount(); r++) {
            if (ids.has(tm.getValue(0, r))) {
              sel.addSelectionInterval(r, r);
            }
          }
          sel.setBatchMode(false);
        }
        scroller.setScrollY(top);
        return shown.length;
      };
      const syncTabs = shown => {
        const total = allRows.length;
        findingsPage.setLabel(`Tespitler (${shown === total ? total : shown + "/" + total})`);
        const watching = sensorRows.filter(r => r[1] === "İzleniyor").length;
        sensorsPage.setLabel(`Sensörler (${sensorRows.length}${watching ? ", " + watching + " izleniyor" : ""})`);
      };
      const apply = () => {
        syncTabs(applyTo(table, columns, filters, allRows, 2));
        syncTrust();
      };
      const applySensors = () => {
        applyTo(sensorTable, sensorColumns, sensorFilters, sensorRows, 1);
        syncTabs(table.getTableModel().getRowCount());
      };
      const filters = host._addColumnFilters(table, columns, apply, { rows: () => allRows });
      const sensorFilters = host._addColumnFilters(sensorTable, sensorColumns, applySensors, { rows: () => sensorRows });

      const render = () => {
        if (renderQueued || closed) {
          return;
        }
        renderQueued = true;
        qx.event.Timer.once(() => {
          renderQueued = false;
          if (closed) {
            return;
          }
          const now = Date.now();
          const list = Array.from(feeds.values());
          const hearers = Classify.hearers(list);
          const sensorCount = list.filter(f => f.data).length;
          const entries = list.map(feed => ({ feed, view: Classify.board(feed, fixedIndex, hearers, sensorCount, now) }));
          const built = Render.model(entries, { showFixed: fixedBox.getValue(), now, checked });
          meta = built.meta;
          allRows = built.rows;
          checked.forEach(id => !meta.has(id) && checked.delete(id)); // listeden düşen satırın işareti de düşer
          const sensors = Render.sensorModel(entries);
          sensorMeta = sensors.meta;
          sensorRows = sensors.rows;
          applySensors();
          apply();
          const watching = list.some(f => f.watching && f.ws);
          win.setCaption(`Wi-Fi Monitör — ${list.length === 1 ? list[0].name : list.length + " sensör"}${watching ? " · sürekli izleniyor" : ""}`);
        }, null, 120);
      };

      // Onay kutusu değişince işaretli küme güncellenir (görünmeyen — süzülmüş — satırların işareti korunur).
      table.getTableModel().addListener("dataChanged", () => {
        const tm = table.getTableModel();
        let changed = false;
        for (let r = 0; r < tm.getRowCount(); r++) {
          const id = tm.getValue(0, r);
          const on = !!tm.getValue(1, r);
          if (on !== checked.has(id)) {
            changed = true;
            if (on) {
              checked.add(id);
            } else {
              checked.delete(id);
            }
          }
        }
        if (changed) {
          syncTrust();
        }
      });

      // İşaretli tespitler ve güven işlemleri.
      const checkedFindings = () => [...checked].map(id => meta.get(id)).filter(m => m && !m.sensor);
      const trustable = m => {
        const row = m.item.row;
        return !m.item.fixed && !row.active && !row.board_name && row.addr && !(row.kind === "probe" && row.random);
      };
      const trustItems = (list, school) => list.filter(trustable).map(m => ({
        kind: m.item.row.kind === "wifi" ? "bssid" : "probe", value: m.item.row.addr,
        board_id: school ? null : m.feed.board.id, label: m.item.row.name || ""
      }));
      const what = list => {
        const kinds = new Set(list.filter(trustable).map(m => (m.item.row.kind === "wifi" ? "AP" : "cihaz")));
        return kinds.size === 0 ? "AP" : kinds.size === 1 ? [...kinds][0] : "AP/cihaz";
      };
      const syncTrust = () => {
        const list = checkedFindings();
        const can = list.filter(trustable).length;
        const out = list.filter(m => m.item.fixed).length;
        trustClass.set({ enabled: can > 0, label: `Bu sınıfta güvenilir ${what(list)}${can ? " (" + can + ")" : ""}`,
          toolTipText: "İşaretli vericiler yalnız duyulduğu sensörün sınıfında güvenilir sayılır (MAC adresiyle)." });
        trustSchool.set({ enabled: can > 0, label: `Okul genelinde güvenilir ${what(list)}${can ? " (" + can + ")" : ""}`,
          toolTipText: "İşaretli vericiler bütün sensörlerde güvenilir sayılır — yalnız bu MAC adresi (aynı adı taşıyan başka verici değil)." });
        untrust.set({ enabled: out > 0, label: `Güvenilirlikten çıkar${out ? " (" + out + ")" : ""}`,
          toolTipText: "İşaretli güvenilir satırları güvenilir listesinden çıkarır (güvenilirler 'Güvenilirleri göster' açıkken listelenir)." });
        const skipped = list.length - can - out;
        checkedInfo.setValue(!list.length ? "Satır başındaki kutuyla işaretleyin."
          : `${list.length} işaretli` + (skipped > 0 ? ` · ${skipped} işaretlenemez (rastgele adresli arayan cihaz, tahta ya da sensörün ağı)` : ""));
      };

      const loadFixed = async () => {
        try {
          fixed = (await ankamon.io.Api.get("/wifimon/fixed")).fixed || [];
        } catch (err) {
          fixed = [];
          ankamon.ui.Dialog.error(err);
        }
        fixedIndex = Classify.index(fixed);
        render();
      };
      const addFixed = async items => {
        if (!items.length) {
          return;
        }
        try {
          await ankamon.io.Api.post("/wifimon/fixed", { items });
        } catch (err) {
          ankamon.ui.Dialog.error(err);
        }
        await loadFixed();
      };
      const removeFixed = async ids => {
        try {
          await ankamon.io.Api.del("/wifimon/fixed", { ids });
        } catch (err) {
          ankamon.ui.Dialog.error(err);
        }
        await loadFixed();
      };
      // İşlem sonrası işaretler kalkar (satırların düzeyi değişir; yeni seçim temiz başlasın).
      const clearChecks = () => {
        checked.clear();
        render();
      };
      const doTrust = async (school, list) => {
        await addFixed(trustItems(list || checkedFindings(), school));
        clearChecks();
      };
      const doUntrust = async list => {
        await removeFixed([...new Set((list || checkedFindings()).filter(m => m.item.fixed).map(m => m.item.fixed.id))]);
        clearChecks();
      };
      trustClass.addListener("execute", () => doTrust(false));
      trustSchool.addListener("execute", () => doTrust(true));
      untrust.addListener("execute", () => doUntrust());

      const popup = (e, tbl, build) => {
        const menu = new qx.ui.menu.Menu();
        const item = (label, fn, enabled = true) => {
          const b = new qx.ui.menu.Button(label).set({ enabled });
          b.addListener("execute", fn);
          menu.add(b);
        };
        build(item, menu);
        menu.setOpener(tbl);
        menu.openAtPointer(e);
        menu.addListenerOnce("disappear", () => qx.event.Timer.once(() => menu.dispose(), null, 0));
      };
      const showSensorFindings = feed => {
        filters.sensor.setValue(`"${feed.name}"`);
        tabs.setSelection([findingsPage]);
      };

      // Tespitler sağ tık: tıklanan satır işaretliyse bütün işaretlilere, değilse yalnız ona uygulanır.
      table.addListener("cellContextmenu", e => {
        const row = e.getRow();
        if (row === null || row === undefined) {
          return;
        }
        const id = table.getTableModel().getValue(0, row);
        const m = meta.get(id);
        if (!m) {
          return;
        }
        const list = checked.has(id) ? checkedFindings() : [m];
        const n = list.length > 1 ? ` (${list.length} işaretli)` : "";
        popup(e, table, (item, menu) => {
          item(`Bu sınıfta güvenilir ${what(list)}${n}`, () => doTrust(false, list), list.some(trustable));
          item(`Okul genelinde güvenilir ${what(list)}${n}`, () => doTrust(true, list), list.some(trustable));
          item(`Güvenilirlikten çıkar${n}`, () => doUntrust(list), list.some(x => x.item.fixed));
          menu.add(new qx.ui.menu.Separator());
          item(`Yalnız bu sensörü göster (${m.feed.name})`, () => filters.sensor.setValue(`"${m.feed.name}"`));
          item("Bütün sensörleri göster", () => filters.sensor.setValue(""), !!filters.sensor.getValue());
        });
      });
      // Sensörler sağ tık: sensörün tespitleri, yeniden tarama.
      sensorTable.addListener("cellContextmenu", e => {
        const row = e.getRow();
        const m = row === null || row === undefined ? null : sensorMeta.get(sensorTable.getTableModel().getValue(0, row));
        if (!m) {
          return;
        }
        sensorTable.getSelectionModel().setSelectionInterval(row, row);
        popup(e, sensorTable, item => {
          item(`Bu sensörün tespitlerini göster (${m.feed.name})`, () => showSensorFindings(m.feed));
          item(`Bu sensörü yeniden tara (${m.feed.name})`, () => connect(m.feed), !m.feed.ws);
        });
      });
      sensorTable.addListener("cellDbltap", e => {
        const m = sensorMeta.get(sensorTable.getTableModel().getValue(0, e.getRow()));
        if (m) {
          showSensorFindings(m.feed);
        }
      });

      const wifiNote = (info, watching) => {
        if (info.wifi_fail) {
          return info.wifi_fail === "autoconnect" ? "Otomatik bağlanma kapatılamadığından Wi-Fi açılmadı." : "Wi-Fi geçici açılamadı; ağlar listelenemedi.";
        }
        if (info.wifi_temp !== "1") {
          return "";
        }
        return watching ? "Wi-Fi izleme için geçici açık; izleme bitince kapatılacak." : "Wi-Fi geçici açık, tarama sonrası kapatılacak.";
      };
      const PLAN_NOTE = {
        wifionly: "Tahta ağa yalnız Wi-Fi ile bağlı görünüyor: SSH erişimi kopmasın diye monitör kipine alınmıyor (yalnız ağ taraması).",
        declined: "Wi-Fi bağlantısı korunsun diye dinlenmiyor (yalnız ağ taraması)."
      };
      const planNote = feed => (feed.plan.noSniff && probeBox.getValue() ? PLAN_NOTE[feed.plan.noSniff] : "");
      const discard = sock => {
        if (sock) {
          sock.onmessage = sock.onclose = null;
          sock.close();
        }
      };
      const anyBusy = () => Array.from(feeds.values()).some(f => f.ws);
      const syncControls = () => refresh.setEnabled(!watchBox.getValue() && !anyBusy());

      const onMessage = (feed, d) => {
        const watching = feed.watching;
        if (d.phase === "scanning") {
          feed.statusText = "Taranıyor…";
          feed.notes = [planNote(feed), wifiNote(d.info || {}, watching)];
        } else if (d.phase === "data") {
          feed.data = d;
          feed.at = d.at * 1000;
          feed.forced = (d.info || {}).forced === "1";
          // Kartın o anki durumu Tahtalar listesinin Wi-Fi sütununa anında geçer: sunucu bu iletiyi göndermeden önce
          // boards.facts'e yazdı (bkz. worker screen/wifi.py _store_radio).
          const radioKey = `${d.radio}|${d.state}`;
          if (radioKey !== feed.radioKey) {
            feed.radioKey = radioKey;
            qx.event.message.Bus.dispatchByName(this.RADIO_CHANGED, feed.board.id);
          }
          const sniff = feed.probe && d.device;
          feed.statusText = sniff ? "Wi-Fi trafiği dinleniyor…" : `Son tarama ${new Date(feed.at).toLocaleTimeString("tr-TR")}`;
          feed.notes = [planNote(feed), wifiNote(d.info || {}, watching), feed.forced ? "Wi-Fi bağlantısı onayınızla kesildi; pencere kapanınca yeniden kurulacak." : ""];
          if (!sniff) {
            feed.initialKeys = feed.initialKeys || new Set(d.rows.map(Classify.rowKey));
          }
        } else if (d.phase === "probes") {
          const now = Date.now();
          if (!watching) {
            feed.probes = new Map();
          }
          d.rows.forEach(row => {
            // Rastgele adresli arayan: önceki dinlemelerde aynı cihaz sayılan satıra eklenir (telefon her taramada yeni
            // adres alır; worker yalnız bir dinleme içinde birleştirir — bkz. Classify.sameProbeDevice).
            let key = Classify.rowKey(row);
            if (row.kind === "probe" && row.random) {
              for (const [k, p] of feed.probes) {
                const why = k === key ? "" : p.at < now ? Classify.sameProbeDevice(p.row, row) : "";
                if (k === key || why) {
                  row = Classify.mergeProbeRows(p.row, row, why);
                  key = k;
                  break;
                }
              }
            }
            feed.probes.set(key, { row, at: now });
          });
          feed.probes.forEach((p, key) => now - p.at > this.PROBE_KEEP_MS && feed.probes.delete(key));
          feed.probeInfo = d;
          feed.at = now;
          feed.statusText = `Son tarama ${new Date(now).toLocaleTimeString("tr-TR")}`;
          const wasSniffing = feed.sniffing;
          feed.sniffing = !d.note;
          if (feed.sniffing !== wasSniffing) {
            qx.event.message.Bus.dispatchByName(this.RADIO_CHANGED, feed.board.id); // Wi-Fi sütunu: "Monitör modu"
          }
          if (d.note) {
            feed.notes.push(Render.PROBE_NOTE[d.note] || "Wi-Fi trafiği dinlenemedi.");
          }
          if (!feed.initialKeys) {
            feed.initialKeys = new Set(((feed.data && feed.data.rows) || []).map(Classify.rowKey));
            feed.probes.forEach((p, key) => feed.initialKeys.add(key));
          }
        } else if (d.phase === "done") {
          feed.sniffing = false;
          feed.forced = false;
          qx.event.message.Bus.dispatchByName(this.RADIO_CHANGED, feed.board.id); // geri yüklenen durum (bkz. "data")
          const parts = [];
          if (d.result === "fail" || d.result === "lock") {
            feed.error = true;
            parts.push("Tahtadaki kartın eski durumuna dönmesi doğrulanamadı; lütfen denetleyin.");
          } else if (d.wifi_fail) {
            parts.push(wifiNote(d, false));
          } else if (d.wifi_temp === "1") {
            parts.push(d.result === "shared" ? "Wi-Fi geçici açıldı; bu tahtadaki başka bir tarama bitince kapatılacak."
              : "Wi-Fi geçici açıldı, tarama sonrası kapatıldı.");
          }
          if (d.policy === "off" && d.radio === "disabled" && d.result !== "shared") {
            parts.push("Bu tahtada Wi-Fi kapalı tutuluyor (Wi-Fi'yi kapat); kart kapalı bırakıldı.");
          }
          if (feed.probeInfo && feed.probeInfo.note) {
            parts.push(Render.PROBE_NOTE[feed.probeInfo.note] || "");
          }
          parts.push(planNote(feed));
          feed.notes = parts;
        }
        render();
      };

      const connect = feed => {
        discard(feed.ws);
        feed.watching = watchBox.getValue();
        feed.probe = probeBox.getValue() && !feed.plan.noSniff;
        feed.error = false;
        const query = [feed.watching ? "watch=1" : "", feed.probe ? "probe=1" : "", feed.probe && feed.plan.force ? "force=1" : ""]
          .filter(Boolean).join("&");
        const sock = feed.ws = new WebSocket(`${proto}//${location.host}/screen/ws/wifi/${feed.board.id}${query ? "?" + query : ""}`);
        feed.statusText = "Bağlanılıyor…";
        syncControls();
        render();
        sock.onmessage = e => onMessage(feed, JSON.parse(e.data));
        sock.onclose = e => {
          if (closed || sock !== feed.ws) {
            return;
          }
          feed.ws = null;
          feed.sniffing = false;
          syncControls();
          if (e.code !== 1000) {
            const why = { 4001: "Tahta bulunamadı.", 4002: "Tahtaya ulaşılamıyor.", 4003: "SSH girişi reddedildi.", 4009: "Tahtada nmcli yok.", 4010: "Tahtada /run dizinine yazılamıyor." };
            const retry = watchBox.getValue() && ![4001, 4003, 4009, 4010].includes(e.code);
            feed.error = true;
            feed.statusText = (why[e.code] || "Bağlantı kesildi.") + (retry ? " Yeniden deneniyor…" : "");
            if (retry) {
              qx.event.Timer.once(() => !closed && !feed.ws && feeds.has(feed.board.id) && watchBox.getValue() && connect(feed), null, 5000);
            }
          } else if (!/Son tarama/.test(feed.statusText || "")) {
            feed.statusText = "Bitti";
          }
          render();
        };
      };

      const restartAll = () => feeds.forEach(feed => connect(feed));
      const stopAll = () => feeds.forEach(feed => {
        if (feed.ws && feed.ws.readyState === WebSocket.OPEN) {
          feed.ws.send("stop");
          feed.watching = false;
          feed.statusText = "İzleme durduruluyor…";
        } else if (feed.ws) {
          discard(feed.ws);
          feed.ws = null;
        }
      });

      // Görünenleri güvenilir yap: her sensörün şu an duyduğu kalıcı adresli vericiler kendi sınıfına güvenilir işaretlenir.
      baseline.addListener("execute", async () => {
        const items = [];
        const now = Date.now();
        const list = Array.from(feeds.values());
        const hearers = Classify.hearers(list);
        list.forEach(feed => Classify.board(feed, fixedIndex, hearers, list.length, now).rows.forEach(item => {
          const m = { item, feed };
          if (trustable(m)) {
            items.push(trustItems([m], false)[0]);
          }
        }));
        if (!items.length) {
          ankamon.ui.Dialog.alert("Güvenilir işaretlenecek yeni verici yok (rastgele adresli Wi-Fi arayan cihazlar işaretlenemez).", "Wi-Fi Monitör");
          return;
        }
        const ok = await ankamon.ui.Dialog.confirm(`Şu an görünen <b>${items.length}</b> verici, duyulduğu sensörün sınıfında güvenilir işaretlenecek.` +
          "<br><br>Bunu sınıflar <b>boşken</b> (öğrenci ve telefon yokken) yapın: o anda sınıfta açık bir telefon varsa o da güvenilir sayılır.",
        "Güvenilir yap");
        if (ok) {
          await addFixed(items.slice(0, 500));
        }
      });
      manage.addListener("execute", () => ankamon.ui.boards.WifimonFixedDialog.open(() => fixed, removeFixed));
      help.addListener("execute", () => ankamon.ui.Dialog.alert(this.HELP, "Wi-Fi Monitör — neler görülebilir"));
      fixedBox.addListener("changeValue", render);
      refresh.addListener("execute", () => feeds.forEach(feed => !feed.ws && connect(feed)));
      watchBox.addListener("changeValue", e => {
        // Eski oturum kapanırken yenisi başlarsa tahtadaki sayım radyoyu boşuna kapatmaz (bkz. wifi_remote_scan.py).
        if (e.getData()) {
          restartAll();
        } else {
          stopAll();
        }
        syncControls();
        render();
      });
      probeBox.addListener("changeValue", () => watchBox.getValue() && restartAll());
      // Sürekli izlemede "… önce" yazıları ve düşen satırlar için ara sıra yeniden çiz.
      const ticker = new qx.event.Timer(15000);
      ticker.addListener("interval", () => watchBox.getValue() && render());
      ticker.start();

      return {
        loadFixed,
        has: id => feeds.has(id),
        addBoard: (board, plan) => {
          if (feeds.has(board.id)) {
            return;
          }
          const feed = { board, plan: plan || {}, name: board.label || board.hostname || board.ip || "#" + board.id, ws: null,
            watching: false, probe: false, sniffing: false, forced: false, error: false, statusText: "", notes: [], data: null,
            probes: new Map(), probeInfo: null, initialKeys: null, at: 0 };
          feeds.set(board.id, feed);
          connect(feed);
        },
        closeAll: () => {
          closed = true;
          // Pencere kapanınca tahtalar kartı kendisi geri yükler (birkaç sn; zorla kesilen Wi-Fi yeniden bağlanır), sunucu son
          // durumu boards.facts'e yazar ve "Monitör modu"nu siler; kapanış iletisi bu pencereye artık gelmeyeceğinden Tahtalar
          // listesi birkaç kez tazelenir (değişen durum anında görünsün).
          const ids = Array.from(feeds.keys());
          [4000, 9000, 20000, 45000].forEach(ms => qx.event.Timer.once(() =>
            ids.forEach(id => qx.event.message.Bus.dispatchByName(ankamon.ui.boards.WifiMonitor.RADIO_CHANGED, id)), null, ms));
          ticker.stop();
          ticker.dispose();
          feeds.forEach(feed => discard(feed.ws));
          feeds.clear();
          host.dispose();
        }
      };
    }
  }
});
