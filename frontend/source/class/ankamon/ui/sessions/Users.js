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
 * Oturumlar sayfasının "Zaman çizelgesi" sekmesi (eski adı "Kullanıcılar"): kullanıcıların hangi tahtada, ne zaman, ne kadar
 * süre oturum açtığını (ve hangilerinin düzgün kapanmadığını) zaman çizelgesinde gösterir.
 *
 * Veri, Oturumlar sekmesiyle aynı (/board-sessions — page.Sessions çeker, setData ile verir);
 * süzme ve özetleme tamamen istemcide yapılır.
 *  - Üstteki tablo (kullanıcı isteği 2026-11-06: eski Kullanıcı/Tahta/Tür seçicileri tabloya girdi): her satır bir
 *    tahta × kullanıcı × tür (tahta oturumu / web terminal) birleşimi. Tahta, Kullanıcı ve Tür sütunları hazır listeyle
 *    ya da elle yazarak süzülür ve bu süzgeç ZAMAN ÇİZELGESİNİ de süzer; öteki sütun süzgeçleri yalnız tabloyu.
 *    Sütunlar sıralanır, genişlikler içeriğe göre ayarlanır (storageKey), her başlık ve hücre ipuçlu.
 *  - "Satırlar" (çizelgede tahtalar / kullanıcılar) ve "Yalnız düzgün kapanmayanlar" tablonun üstünde yer kaplamasın diye
 *    alttaki aralık düğmelerinin satırında.
 *  - Aralık: hazır düğmeler + çizelgede sürükleme; tekerlek dikey kaydırır, Ctrl+tekerlek yakınlaştırır (bkz. Timeline).
 *    Özet ve tablo HER ZAMAN görünen aralığa göre hesaplanır (aralığı taşan oturumların yalnız aralık içindeki süresi).
 *  - "Satırlar: Tahtalar" görünümünde tahtanın KAPALI olduğu aralıklar satırda gri taralı arka plan
 *    olarak görünür (kurum kapalıyken boşluk ile "kimse oturum açmadı"yı ayırır — bkz. __loadUptime).
 *  - Tablo satırına çift tıklama o tahtayı ve kullanıcıyı süzgece alır; çubuğa sağ tıklama süzme
 *    ve (açık tahta oturumunda, "boards.login" yetkisiyle) oturumu kapat/kilitle menüsü açar.
 *  - Satır (tablo satırı ya da çizelgedeki satır adı) sağ menüsü: süzgece alma; Tahtalar'a kayıtlı olmayan
 *    bilgisayarda ("sessions.hosts" yetkisiyle) onaylı "Bu bilgisayarın kayıtlarını sil".
 *
 * "Düzgün kapanmadı": kapanış mesajı gelmeden tahta çevrimdışı oldu (offline — elektrik kesintisi,
 * güç düğmesiyle kapatma) ya da kapanmadan yeni oturum açıldı (superseded) ya da web terminal
 * hizmeti yeniden başladı (restart) — bkz. worker/ankamon/tasks/board_sessions.py.
 */
qx.Class.define("ankamon.ui.sessions.Users", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Sessions} */
  construct(page) {
    super("Zaman çizelgesi");
    // Sekme kimliği (sol ağaç yaprağı, hatırlanan sekme) etiketten bağımsız — bkz. ui.Shell PAGES "sessions".
    this.setUserData("key", "timeline");
    this.__page = page;
    this.setLayout(new qx.ui.layout.VBox(6));
    this.setPadding(8);

    // Çizelge satırları ve "yalnız düzgün kapanmayanlar": alttaki aralık satırında (tablonun üstünde ayrı satır yok).
    this.__groupBy = this.__select([["board", "Tahtalar"], ["user", "Kullanıcılar"]]).set({ width: 120 });
    this.__groupBy.addListener("changeSelection", () => this.__changed());
    this.__badOnly = new qx.ui.form.CheckBox("Yalnız düzgün kapanmayanlar").set({ alignY: "middle" });
    this.__badOnly.addListener("changeValue", () => this.__changed());

    const ranges = new qx.ui.container.Composite(new qx.ui.layout.Flow(6, 6).set({ alignY: "middle" }));
    const day = 24 * 3600 * 1000;
    const rangeButton = (label, handler) => {
      const b = new qx.ui.form.Button(label).set({ padding: [3, 9], font: "small" });
      b.addListener("execute", handler);
      ranges.add(b);
    };
    const last = ms => () => this.__timeline.setWindow(new Date(Date.now() - ms), new Date(Date.now() + ms / 50));
    rangeButton("Son 24 saat", last(day));
    rangeButton("Son 7 gün", last(7 * day));
    rangeButton("Son 30 gün", last(30 * day));
    rangeButton("Bu ay", () => {
      const now = new Date();
      this.__timeline.setWindow(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1));
    });
    rangeButton("Tümü", () => this.__timeline.fit());
    ranges.add(new qx.ui.basic.Label("Satırlar:").set({ alignY: "middle", marginLeft: 12 }));
    ranges.add(this.__groupBy);
    ranges.add(this.__badOnly.set({ marginLeft: 8 }));
    const S = ankamon.ui.sessions.Users.STATES;
    // Kutu boyutu satır içi: Timeline CSS'i sonradan yüklendiğinden etiket genişliği o olmadan
    // ölçülür ve son maddeler kırpılırdı (renkler sınıftan gelir, ölçüyü etkilemez).
    const chip = cls => `<span class="tm-legend ${cls}" style="display:inline-block;width:12px;height:12px;` +
      "box-sizing:border-box;border:1px solid;border-radius:2px;vertical-align:-2px;margin:0 4px 0 10px\"></span>";
    // Renk açıklamaları satırda çok yer kaplıyordu (kullanıcı bildirimi): üzerine gelince ipucunda, alt alta.
    const legend = Object.keys(S).map(k => chip("tm-s-" + k) + S[k]).concat(chip("tm-off") + "Tahta kapalı")
      .map(line => `<div style="margin:2px 0">${line}</div>`).join("");
    const legendTip = new qx.ui.tooltip.ToolTip(legend).set({ rich: true, showTimeout: 100 });
    ranges.add(new qx.ui.basic.Label("ⓘ Renkler").set({
      alignY: "middle", textColor: "app-muted", marginLeft: 10, toolTip: legendTip, cursor: "help"
    }));

    this.__summary = new qx.ui.basic.Label("").set({ rich: true });

    // Yerleşim (kullanıcı isteği): süzgeç barı → tahta grid'i → aralık düğmeleri + özet + zaman
    // çizelgesi (aralık düğmeleri çizelgeyi yönettiği için onunla aynı bölümde). Grid ile alt bölüm
    // arasındaki ayraç sürüklenebilir.
    const split = new qx.ui.splitpane.Pane("vertical");
    // Ayraç ince olunca fareyle tutmak zordu (kullanıcı bildirimi): temanın görünümü korunur, yalnız kalınlaşır.
    split.getChildControl("splitter").setHeight(ankamon.ui.sessions.Users.SPLITTER_HEIGHT);
    this.__timeline = new ankamon.ui.sessions.Timeline();
    this.__timeline.addListener("changeRange", e => this.__summarize(e.getData()));
    this.__timeline.addListener("itemContextmenu", e => this.__itemMenu(e.getData()));
    this.__timeline.addListener("itemClick", e => this.__openShot(e.getData().item));
    this.__timeline.addListener("groupContextmenu", e => {
      const data = e.getData();
      this.__openMenu(this.__groupMenu(data.group), data.event);
    });
    const lower = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({ paddingTop: 6 });
    lower.add(ranges);
    // "Gece saatlerini gizle" (kullanıcı isteği): özet satırının sonunda, varsayılan işaretli; seçim
    // kullanıcı başına sunucuda (users.ui_prefs["timeline.nights.show"] — yalnız işaret kaldırılınca yazılır).
    const T = ankamon.ui.sessions.Timeline;
    const prefs = page._user.ui_prefs || {};
    const nights = new qx.ui.form.CheckBox(`Gece saatlerini gizle (${T.nightHoursText()})`).set({
      value: prefs[ankamon.ui.sessions.Users.PREF_SHOW_NIGHTS] !== true, alignY: "middle", marginLeft: 12,
      toolTipText: "Her günün bu saatleri çizelgede gösterilmez; gündüzler yan yana gelir, böylece görünen alan daha verimli kullanılır."
    });
    this.__timeline.setNightsHidden(nights.getValue());
    nights.addListener("changeValue", e => {
      this.__timeline.setNightsHidden(e.getData());
      ankamon.page.Base.savePref(page._user, ankamon.ui.sessions.Users.PREF_SHOW_NIGHTS, e.getData() ? null : true);
    });
    const summaryRow = new qx.ui.container.Composite(new qx.ui.layout.HBox().set({ alignY: "middle" }));
    summaryRow.add(this.__summary, { flex: 0 });
    summaryRow.add(nights);
    lower.add(summaryRow);
    lower.add(this.__timeline, { flex: 1 });

    const C = ankamon.ui.sessions.Users.COL;
    this.__columns = [
      { id: "board", label: "Tahta", choices: true, hint: "Oturumun açıldığı tahta (Tahtalar'a kayıtlı değilse bilgisayar adı). Süzgeç zaman çizelgesini de süzer." },
      { id: "user", label: "Kullanıcı", choices: true, hint: "Oturumu açan kullanıcı: tahtada giriş ekranından oturum açan kişi ya da web terminal açan Ankamon kullanıcısı. Süzgeç zaman çizelgesini de süzer." },
      { id: "kind", label: "Tür", choices: true, hint: "Tahta oturumu: tahtanın giriş ekranından açılan oturum · Web terminal: Ankamon üzerinden açılan uzak terminal. Süzgeç zaman çizelgesini de süzer." },
      { id: "count", label: "Oturum", hint: "Görünen aralıktaki oturum sayısı" },
      { id: "total", label: "Toplam süre", hint: "Görünen aralıkta toplam açık kalma süresi (aralığı taşan oturumların yalnız aralık içindeki kısmı)" },
      { id: "avg", label: "Ortalama", hint: "Oturum başına ortalama süre (görünen aralıkta)" },
      { id: "bad", label: "Düzgün kapanmayan", hint: "Kapanış kaydı gelmeden biten oturumlar: elektrik kesintisi, güç düğmesi, ağ kopması, kapanmadan yeni oturum…" },
      { id: "first", label: "İlk oturum", hint: "Görünen aralıktaki ilk oturumun başlangıcı" },
      { id: "last", label: "Son oturum", hint: "Görünen aralıktaki son oturumun başlangıcı" }
    ];
    // storageKey: genişlikler içeriğe göre kendiliğinden (kullanıcının elle ayarladığı korunur) — kullanıcı isteği.
    this.__table = page._createTable(this.__columns, { storageKey: "timeline.grid.columns" });
    this.__filters = page._addColumnFilters(this.__table, this.__columns, () => this.__filtersChanged(),
      { rows: () => this.__allRows || [] });
    // Varsayılan (eski "Tür: Tahta oturumu" seçimi gibi): yalnız tahta oturumları.
    this.__filters.kind.setValue(`"${ankamon.ui.sessions.Users.KIND.board}"`);
    // Süre/tarih sütunları ekranda metin; sıralama satır sonundaki ham sayılarla yapılır (bkz. __summarize).
    const model = this.__table.getTableModel();
    [[C.total, C.rawTotal], [C.avg, C.rawAvg], [C.first, C.rawFirst], [C.last, C.rawLast]].forEach(([col, raw]) =>
      model.setSortMethods(col, (a, b) => (a[raw] - b[raw]) || 0));
    // Hücre ipuçları: satırın kendi değerleriyle (bkz. ui.table.HintRenderer).
    const hints = this.__cellHints();
    this.__columns.forEach((column, index) => this.__table.getTableColumnModel().setDataCellRenderer(index + 1,
      new ankamon.ui.table.HintRenderer(info => (info.rowData ? hints[column.id](info.rowData) : null))));
    this.__table.addListener("cellDbltap", e => this.__pickRow(e.getRow()));
    this.__table.addListener("cellContextmenu", e => {
      const row = e.getRow() === null ? null : this.__table.getTableModel().getRowData(e.getRow());
      this.__table.setContextMenu(row ? this.__tableMenu(row) : null);
    });
    this.__table.setToolTipText("Çift tıklayınca o tahta ve kullanıcı süzgece alınır");
    // SplitPane.add() ÇIPLAK SAYI flex bekler (genel Widget.add'in aksine — bkz. ankamon-architecture notu).
    split.add(this.__table, 2);
    split.add(lower, 3);
    this.add(split, { flex: 1 });
  },

  statics: {
    /** Tablo modeli sütunları (0 = satır anahtarı); raw* sıralama için ham değerler. */
    COL: { board: 1, user: 2, kind: 3, count: 4, total: 5, avg: 6, bad: 7, first: 8, last: 9,
      rawTotal: 10, rawAvg: 11, rawFirst: 12, rawLast: 13, boardKey: 14, kindKey: 15, username: 16 },
    /** Tür sütununun metinleri. */
    KIND: { board: "Tahta oturumu", webshell: "Web terminal" },

    /** Tablo ile çizelge arasındaki sürüklenebilir ayracın kalınlığı (px). */
    SPLITTER_HEIGHT: 8,

    /** ui_prefs anahtarı: true = gece saatleri de gösterilsin (varsayılan: gizli). */
    PREF_SHOW_NIGHTS: "timeline.nights.show",

    /** Çubuk renkleri (CSS: ui.sessions.Timeline.CSS, sınıf "tm-s-<anahtar>") ve açıklamaları. */
    STATES: {
      ok: "Düzgün kapandı",
      open: "Açık",
      locked: "Açık (kilitli)",
      offline: "Kapanmadı: tahta çevrimdışı oldu",
      superseded: "Kapanmadı: yeni oturum açıldı",
      web: "Web terminal"
    },

    /** Düzgün kapanmayan oturum mu (bkz. sınıf başı not). */
    isBad(s) {
      // power_loss/network: kontrolsüz kapanış; otomatik kapanma, kapatma, yeniden başlatma düzgün sayılır (bkz. tasks/session_end.py).
      return ["offline", "superseded", "restart", "power_loss", "network"].includes(s.end_reason);
    },

    state(s) {
      if (!s.ended_at) {
        return s.locked ? "locked" : "open";
      }
      if (["offline", "restart", "power_loss", "network"].includes(s.end_reason)) {
        return "offline";
      }
      if (s.end_reason === "superseded") {
        return "superseded";
      }
      return s.kind === "webshell" ? "web" : "ok";
    }
  },

  members: {
    __page: null,
    __filters: null,
    __allRows: null,
    __pendingBoard: null,
    __groupBy: null,
    __badOnly: null,
    __summary: null,
    __timeline: null,
    __table: null,
    __columns: null,
    __sessions: null,
    __shown: null,
    __rows: null,
    __range: null,
    __uptime: null,
    __uptimeLoading: false,
    __updatingOptions: false,
    __framed: false,
    __lessons: null,
    __lessonsAt: 0,
    __shots: null,

    /** Ekran görüntüleri (bkz. ankamon.ui.sessions.ScreenshotViewer): oturum kayıtlarından bağımsız, çizelgede işaret olarak. */
    async __loadShots() {
      try {
        const shots = (await ankamon.io.Api.get("/screenshots")).screenshots;
        if (JSON.stringify(shots) !== JSON.stringify(this.__shots)) {
          this.__shots = shots;
          if (!this.isDisposed()) {
            this.__render();
          }
        }
      } catch (e) {
        // görüntü listesi okunamazsa çizelge oturumlarla çalışmaya devam eder
      }
    },

    /** Süzgece uyan görüntülerin çizelge öğeleri; satırlar `groups`a eklenir (oturumu olmayan tahta/kişi de görünsün). */
    __shotItems(groups, byBoard, badOnly) {
      const f = this.__textFilters();
      if (badOnly || !ankamon.page.Base.filterMatch(ankamon.ui.sessions.Users.KIND.board, f.kind)) {
        return [];
      }
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const M = ankamon.page.Base.filterMatch;
      return (this.__shots || []).filter(s => M(s.board_name, f.board) && (!f.user || M(s.session_username || "", f.user))).map(s => {
        const group = byBoard ? (s.board_id ? "b" + s.board_id : "h" + s.board_name) : "board:" + (s.session_username || "");
        if (!groups.has(group)) {
          groups.set(group, byBoard ? s.board_name : (s.session_username || "(oturum yok)"));
        }
        return {
          id: "s:" + s.id, group, type: "box", start: new Date(s.taken_at * 1000), content: "📷", className: "tm-shot",
          title: `<b>Ekran görüntüsü</b> · ${esc(s.board_name)}<br>Oturum: ${esc(s.session_username || "yok")}<br>` +
            `${F.dateTime(s.taken_at * 1000)} · çeken: ${esc(s.taken_by)}`
        };
      });
    },

    __shotOf(item) {
      return String(item).startsWith("s:") ? (this.__shots || []).find(s => "s:" + s.id === item) : null;
    },

    /** Çizelgede görüntü işaretine tıklama: kalıcı pencerede normal boyutta. */
    __openShot(item) {
      const shot = this.__shotOf(item);
      if (shot) {
        ankamon.ui.sessions.ScreenshotViewer.open(shot, this.__page._can("logs.manage"), () => this.__loadShots());
      }
    },

    /** @param sessions {Array} /board-sessions yanıtındaki satırlar */
    setData(sessions) {
      this.__sessions = sessions;
      this.__loadShots();
      if (this.__pendingBoard) {
        this.__applyBoard();
      } else {
        this.__render();
      }
      this.__loadLessons();
    },

    /** Ders saatleri (Ayarlar ▸ Ders saatleri): en çok dakikada bir yeniden okunur; değişince çizelge yeniden kurulur. */
    async __loadLessons() {
      if (this.__lessonsAt && Date.now() - this.__lessonsAt < 60000) {
        return;
      }
      this.__lessonsAt = Date.now();
      try {
        const value = await ankamon.io.Api.get("/lesson-times");
        if (JSON.stringify(value) !== JSON.stringify(this.__lessons)) {
          this.__lessons = value;
          this.__render();
        }
      } catch (e) {
        // ders saatleri okunamazsa ipucu yalnız ders satırları olmadan gösterilir
      }
    },

    /**
     * Oturumun denk geldiği ders saatleri, ipucunda alt alta (kullanıcı isteği): "1. ders (08:30–09:10):
     * 5 dk sonra açıldı, bitimden 2 dk önce kapandı". Yalnız ders günlerinde; birden çok güne yayılan
     * oturumda satır başına tarih eklenir, çok uzun listeler kısaltılır.
     * @param s {Map} oturum  @param end {Number} bitiş (sn; açık oturumda şimdi)
     * @return {String} HTML ("" — ders tanımlı değilse)
     */
    __lessonLines(s, end) {
      const L = this.__lessons;
      if (!L || !L.lessons || !L.lessons.length) {
        return "";
      }
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const min = ankamon.ui.LessonTimesEditor.minutes;
      const dur = sec => F.duration(sec);
      const lines = [];
      const day = new Date(s.started_at * 1000);
      day.setHours(0, 0, 0, 0);
      const multiDay = new Date(end * 1000).toDateString() !== day.toDateString();
      for (let d = 0; d < 14 && day.getTime() / 1000 < end; d++, day.setDate(day.getDate() + 1)) {
        const weekday = day.getDay() || 7; // 1=Pzt … 7=Paz
        if (!(L.days || []).includes(weekday)) {
          continue;
        }
        const base = day.getTime() / 1000;
        L.lessons.forEach(l => {
          const ls = base + min(l.start) * 60;
          const le = base + min(l.end) * 60;
          if (s.started_at >= le || end <= ls) {
            return;
          }
          const open = s.started_at > ls ? `${dur(s.started_at - ls)} sonra açıldı` : "başında açıktı";
          let close;
          if (!s.ended_at && end < le) {
            close = "hâlâ açık";
          } else if (end < le) {
            close = `bitimden ${dur(le - end)} önce kapandı`;
          } else {
            close = "sonuna kadar açık kaldı";
          }
          const date = multiDay ? `${day.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" })} · ` : "";
          lines.push(`${date}<b>${esc(l.name)}</b> <span style="opacity:.7">(${l.start}–${l.end})</span>: ${open}, ${close}`);
        });
      }
      if (!lines.length) {
        return "<br><i>Ders saati dışında</i>";
      }
      const MAX = 12;
      const extra = lines.length > MAX ? `<br>… ${lines.length - MAX} ders daha` : "";
      return "<br>" + lines.slice(0, MAX).join("<br>") + extra;
    },

    /**
     * "Oturum geçmişi" (Oturumlar sekmesindeki sağ menü): o kullanıcıyı süzer, satırları tahtalara
     * göre gruplar ve aralığı kullanıcının bütün oturumlarını kapsayacak şekilde ayarlar.
     */
    showUser(username, kind) {
      this.__updatingOptions = true;
      try {
        this.__setFilter("kind", ankamon.ui.sessions.Users.KIND[kind === "webshell" ? "webshell" : "board"]);
        this.__setFilter("user", username);
        this.__setFilter("board", "");
        this.__selectValue(this.__groupBy, "board");
        this.__badOnly.setValue(false);
      } finally {
        this.__updatingOptions = false;
      }
      this.__render();
      this.__timeline.fit();
    },

    /**
     * Tahtalar/Ekranlar sağ menüsü "Oturum geçmişi" (bkz. page.Sessions.openWith): yalnız o tahta — tür süzgeci boş
     * (web terminal dahil), satırlar kullanıcılara göre, aralık tahtanın bütün oturumlarını kapsar. Veri henüz
     * gelmediyse (sayfa ilk açılıyor) setData'da uygulanır.
     * @param board {Map} {id, name}
     */
    showBoard(board) {
      this.__pendingBoard = board;
      if (this.__sessions) {
        this.__applyBoard();
      }
    },

    __applyBoard() {
      const board = this.__pendingBoard;
      this.__pendingBoard = null;
      this.__updatingOptions = true;
      try {
        this.__setFilter("kind", "");
        this.__setFilter("user", "");
        this.__setFilter("board", board.name);
        this.__selectValue(this.__groupBy, "user");
        this.__badOnly.setValue(false);
      } finally {
        this.__updatingOptions = false;
      }
      this.__render();
      this.__timeline.fit();
    },

    __select(pairs) {
      const box = new qx.ui.form.SelectBox();
      pairs.forEach(([value, label]) => box.add(new qx.ui.form.ListItem(label, null, value)));
      return box;
    },

    __value(box) {
      const item = box.getSelection()[0];
      return item ? item.getModel() : "";
    },

    __selectValue(box, value) {
      const item = box.getSelectables(true).find(i => i.getModel() === value);
      if (item) {
        box.setSelection([item]);
      }
    },

    __boardKey(s) {
      return s.board_id ? "b" + s.board_id : "h" + (s.host || "");
    },

    /** Sütun süzgecini tek değere (tam eşleşme: "değer") ayarlar; boş değer süzgeci temizler. */
    __setFilter(id, value) {
      this.__filters[id].setValue(value ? `"${value}"` : "");
    },

    /** Tablonun Tahta / Kullanıcı / Tür süzgeç metinleri (çizelgeyi de süzenler). */
    __textFilters() {
      const get = id => (this.__filters[id].getValue() || "").trim();
      return { board: get("board"), user: get("user"), kind: get("kind") };
    },

    /** Süzgeçte tek değer seçiliyse o değer (ör. hareketler için kullanıcı adı), yoksa null. */
    __single(id) {
      const values = ankamon.page.Base.parseChoices(this.__filters[id].getValue());
      return values && values.length === 1 ? values[0] : null;
    },

    __sessionMatches(s, f) {
      const M = ankamon.page.Base.filterMatch;
      return M(s.board || s.host || "?", f.board) && M(s.username, f.user) &&
        M(ankamon.ui.sessions.Users.KIND[s.kind] || s.kind, f.kind);
    },

    /** Tablo süzgeci değişti: Tahta/Kullanıcı/Tür çizelgeyi de süzer, öteki sütunlar yalnız tabloyu. */
    __filtersChanged() {
      if (this.__updatingOptions) {
        return;
      }
      const f = JSON.stringify(this.__textFilters());
      if (f !== this.__lastText) {
        this.__render();
      } else {
        this.__applyTable();
      }
    },

    __lastText: null,

    __changed() {
      if (this.__updatingOptions) {
        return;
      }
      this.__render();
    },

    /** Süzgece uyan oturumları çizelgeye verir. */
    __render() {
      if (!this.__sessions) {
        return;
      }
      const F = ankamon.util.Format;
      const S = ankamon.ui.sessions.Users;
      const esc = qx.bom.String.escape;
      const f = this.__textFilters();
      this.__lastText = JSON.stringify(f);
      const kind = /^"[^"|]*"$/.test(f.kind) ? (Object.keys(S.KIND).find(k => `"${S.KIND[k]}"` === f.kind) || "") : "";
      const byBoard = this.__value(this.__groupBy) === "board";
      const badOnly = this.__badOnly.getValue();
      const now = Date.now() / 1000;

      // Tablo satırları (ve hazır listeler) için süzgeçsiz oturumlar; çizelge için Tahta/Kullanıcı/Tür süzgeçlileri.
      this.__base = this.__sessions.filter(s => !badOnly || S.isBad(s));
      this.__shown = this.__base.filter(s => this.__sessionMatches(s, f));

      const groups = new Map();
      const items = this.__shown.map(s => {
        const boardName = s.board || s.host || "?";
        // Aynı ad iki türde (tahta kullanıcısı / Ankamon kullanıcısı) farklı kişiler olabilir.
        const userKey = s.kind + ":" + s.username;
        const userName = s.kind === "webshell" && !kind ? `${s.username} (web terminal)` : s.username;
        const group = byBoard ? this.__boardKey(s) : userKey;
        groups.set(group, byBoard ? boardName : userName);
        const end = s.ended_at || now;
        const state = S.state(s);
        return {
          id: (s.kind === "webshell" ? "w:" : "b:") + s.id,
          group,
          start: new Date(s.started_at * 1000),
          end: new Date(Math.max(end, s.started_at + 1) * 1000),
          content: esc(byBoard ? userName : boardName),
          className: "tm-s-" + state,
          title: `<b>${esc(s.username)}</b> · ${esc(boardName)}<br>` +
            `Süre: ${F.duration(end - s.started_at)} (${F.dateTime(s.started_at * 1000)} → ` +
            `${s.ended_at ? F.dateTime(s.ended_at * 1000) : "devam ediyor"})<br>` +
            `${s.kind === "webshell" ? "Web terminal · " : ""}${s.locked ? "Açık (kilitli)" : (s.end_detail || F.sessionEndReason(s.end_reason))}` +
            (s.kind === "webshell" ? "" : this.__lessonLines(s, end))
        };
      });
      items.push(...this.__shotItems(groups, byBoard, badOnly));
      if (byBoard) {
        items.push(...this.__offItems(new Set(groups.keys())));
      }
      this.__timeline.setData([...groups.entries()].map(([id, content]) => ({ id, content: esc(content) })), items);
      // Satır adları sütununun başlığı: tahta satırlarında kayıtlı tahtalar dışında, log gönderen ama
      // tahta olarak eklenmemiş makineler (bilgisayar adıyla) de bulunabildiğinden "Bilgisayar".
      this.__timeline.setGroupHeader(byBoard ? "Bilgisayar" : "Kullanıcı");
      if (!this.__framed) {
        this.__framed = true;
        this.__frameToday();
      }
      this.__summarize(this.__timeline.getWindow());
    },

    /**
     * Varsayılan aralık (kullanıcı isteği): 24 saat, bugün ilk oturumu açan en solda. Bugün henüz
     * oturum yoksa son 24 saat. Yalnız ilk veriyle uygulanır — sonraki tazelemeler kullanıcının
     * kaydırdığı/yakınlaştırdığı aralığı bozmaz.
     */
    __frameToday() {
      const day = 24 * 3600 * 1000;
      const midnight = new Date().setHours(0, 0, 0, 0) / 1000;
      const first = Math.min(...this.__shown.map(s => s.started_at).filter(t => t >= midnight));
      if (Number.isFinite(first)) {
        const start = first * 1000 - 10 * 60 * 1000; // çubuğun başı kenara yapışmasın
        this.__timeline.setWindow(new Date(start), new Date(start + day));
      } else {
        this.__timeline.setWindow(new Date(Date.now() - day), new Date(Date.now() + day / 50));
      }
    },

    /**
     * Görünen aralıktaki oturumların özeti (üst satır) ve satır başına (tahta/kullanıcı) tablo.
     * @param range {Map|null} {start, end: Date}
     */
    __summarize(range) {
      if (range) {
        this.__range = range;
        this.__loadUptime();
      }
      if (!this.__shown || !this.__range) {
        return;
      }
      const F = ankamon.util.Format;
      const S = ankamon.ui.sessions.Users;
      const byBoard = this.__value(this.__groupBy) === "board";
      const from = this.__range.start.getTime() / 1000;
      const to = this.__range.end.getTime() / 1000;
      const now = Date.now() / 1000;

      const KIND = S.KIND;
      const per = new Map();
      const inRange = s => !((s.ended_at || now) < from || s.started_at > to);
      const seconds = s => Math.max(0, Math.min(s.ended_at || now, to) - Math.max(s.started_at, from));
      (this.__base || []).filter(inRange).forEach(s => {
        const key = this.__boardKey(s) + "|" + s.kind + ":" + s.username;
        const row = per.get(key) || { key, board: s.board || s.host || "?", user: s.username, kind: s.kind,
          boardKey: this.__boardKey(s), count: 0, total: 0, bad: 0, first: Infinity, last: 0 };
        row.count++;
        row.total += seconds(s);
        row.bad += S.isBad(s) ? 1 : 0;
        row.first = Math.min(row.first, s.started_at);
        row.last = Math.max(row.last, s.started_at);
        per.set(key, row);
      });
      // Özet: çizelgede görünenler (Tahta/Kullanıcı/Tür süzgeçli).
      let count = 0, total = 0, bad = 0;
      const groupsSeen = new Set();
      this.__shown.filter(inRange).forEach(s => {
        count++;
        total += seconds(s);
        bad += S.isBad(s) ? 1 : 0;
        groupsSeen.add(byBoard ? this.__boardKey(s) : s.kind + ":" + s.username);
      });

      const span = `${F.dateTime(from * 1000)} – ${F.dateTime(to * 1000)}`;
      this.__summary.setValue(count
        ? `<b>${count}</b> oturum · toplam <b>${F.duration(total)}</b> · ortalama <b>${F.duration(total / count)}</b> · ` +
          `<b style="color:${bad ? "#d93025" : "inherit"}">${bad}</b> düzgün kapanmadı · ` +
          `<b>${groupsSeen.size}</b> ${byBoard ? "tahta" : "kullanıcı"} <span style="color:#5f6368">(${span})</span>`
        : `<span style="color:#5f6368">Bu aralıkta süzgece uyan oturum yok (${span}). "Tümü" ile bütün kayıtları görebilirsiniz.</span>`);

      this.__allRows = [...per.values()].sort((a, b) => b.total - a.total).map(r => [
        r.key, r.board, r.user, KIND[r.kind] || r.kind, r.count, F.duration(r.total), F.duration(r.total / r.count), r.bad,
        F.dateTime(r.first * 1000), F.dateTime(r.last * 1000),
        r.total, r.total / r.count, r.first, r.last, r.boardKey, r.kind, r.user
      ]);
      this.__applyTable();
    },

    /** Bütün sütun süzgeçleri → tablo (sıralama korunur — bkz. Base.keepSortOnReload). */
    __applyTable() {
      if (!this.__allRows) {
        return;
      }
      const M = ankamon.page.Base.filterMatch;
      const filters = this.__columns.map((c, i) => ({ i: i + 1, text: (this.__filters[c.id].getValue() || "").trim() }))
        .filter(x => x.text);
      this.__table.getTableModel().setData(this.__allRows.filter(cells => filters.every(x => M(cells[x.i], x.text))));
    },

    __base: null,

    /** Hücre ipuçları (sütun kimliği → (satır) → metin). */
    __cellHints() {
      const F = ankamon.util.Format;
      const C = ankamon.ui.sessions.Users.COL;
      return {
        board: r => `${r[C.board]} — çift tık: yalnız bu tahta ve ${r[C.user]}`,
        user: r => r[C.kindKey] === "webshell" ? `${r[C.user]}: web terminal açan Ankamon kullanıcısı`
          : `${r[C.user]}: tahtada giriş ekranından oturum açan kullanıcı`,
        kind: r => r[C.kindKey] === "webshell" ? "Web terminal: Ankamon üzerinden tahtaya açılan uzak terminal"
          : "Tahta oturumu: tahtanın giriş ekranından açılan oturum",
        count: r => `Görünen aralıkta ${r[C.count]} oturum`,
        total: r => `Görünen aralıkta toplam ${F.duration(r[C.rawTotal])} açık kaldı (aralığı taşan oturumların yalnız aralık içindeki kısmı)`,
        avg: r => `Oturum başına ortalama ${F.duration(r[C.rawAvg])}`,
        bad: r => r[C.bad] ? `${r[C.bad]} oturum düzgün kapanmadı (elektrik kesintisi, güç düğmesi, ağ kopması ya da kapanmadan yeni oturum)`
          : "Bütün oturumlar düzgün kapandı",
        first: r => `Görünen aralıktaki ilk oturum ${F.dateTime(r[C.rawFirst] * 1000)} tarihinde başladı (${F.ago(r[C.rawFirst])})`,
        last: r => `Görünen aralıktaki son oturum ${F.dateTime(r[C.rawLast] * 1000)} tarihinde başladı (${F.ago(r[C.rawLast])})`
      };
    },

    /**
     * Tahtaların açık aralıkları (GET /board-uptime — worker'ın loglardan ARTIMLI doldurduğu tablo,
     * her istekte yeniden hesaplanmaz). Görünen aralığın iki yanına birer aralık boyu pay eklenerek
     * çekilir; önbellek görünen aralığı kapsıyor ve 60 sn'den yeniyse yeniden istenmez. Uç yoksa
     * ya da hata verirse çizelge kapalı gölgesi olmadan çalışmaya devam eder.
     */
    async __loadUptime() {
      if (this.__uptimeLoading || !this.__range || this.__value(this.__groupBy) !== "board") {
        return;
      }
      const from = this.__range.start.getTime() / 1000;
      const to = this.__range.end.getTime() / 1000;
      const c = this.__uptime;
      if (c && c.from <= from && c.to >= to && Date.now() - c.at < 60000) {
        return;
      }
      const span = to - from;
      const q = { from: Math.floor(from - span), to: Math.ceil(to + span) };
      this.__uptimeLoading = true;
      try {
        const res = await ankamon.io.Api.get(`/board-uptime?from=${q.from}&to=${q.to}`);
        this.__uptime = { from: q.from, to: q.to, at: Date.now(), boards: res.boards || [] };
      } catch (e) {
        // Uç henüz yoksa / hata: aynı aralık için 60 sn boyunca yeniden denenmez.
        this.__uptime = { from: q.from, to: q.to, at: Date.now(), boards: null };
      } finally {
        this.__uptimeLoading = false;
      }
      if (!this.isDisposed()) {
        this.__render();
      }
    },

    /**
     * Tahta satırlarına "kapalı" arka plan çubukları: açık aralıkların, çekilen [from, to] (ve
     * şimdi) içindeki tümleyeni. @param groups {Set} çizelgedeki tahta satır anahtarları
     */
    __offItems(groups) {
      const c = this.__uptime;
      if (!c || !c.boards) {
        return [];
      }
      const now = Date.now() / 1000;
      const to = Math.min(c.to, now);
      const out = [];
      c.boards.forEach(b => {
        const group = b.board_id ? "b" + b.board_id : "h" + (b.host || "");
        if (!groups.has(group)) {
          return;
        }
        // Tahtanın ilk log kaydından (since) öncesi bilinmiyor: "kapalı" diye taranmaz.
        let cursor = Math.max(c.from, b.since || 0);
        const gap = (start, end, i) => {
          if (end - start >= 60) {
            out.push({
              id: `off:${group}:${i}`, group, type: "background", className: "tm-off",
              start: new Date(start * 1000), end: new Date(end * 1000)
            });
          }
        };
        (b.up || []).forEach(([start, end], i) => {
          gap(cursor, Math.min(start, to), i);
          cursor = Math.max(cursor, end === null ? to : end);
        });
        gap(cursor, to, "son");
      });
      return out;
    },

    /** Tablo satırına çift tıklama: o tahtayı ve kullanıcıyı (ve türü) süzgece al. */
    __pickRow(rowIndex) {
      const row = this.__table.getTableModel().getRowData(rowIndex);
      if (!row) {
        return;
      }
      const C = ankamon.ui.sessions.Users.COL;
      this.__updatingOptions = true;
      try {
        this.__setFilter("board", row[C.board]);
        this.__setFilter("user", row[C.user]);
        this.__setFilter("kind", row[C.kind]);
      } finally {
        this.__updatingOptions = false;
      }
      this.__render();
    },

    /** Çizelge satır anahtarını (bkz. __groupMenu) süzgece alır. */
    __pickKey(key) {
      if (!key) {
        return;
      }
      if (this.__value(this.__groupBy) === "board") {
        const s = (this.__sessions || []).find(x => this.__boardKey(x) === key);
        this.__setFilter("board", s ? s.board || s.host : key.slice(1));
      } else {
        const i = key.indexOf(":");
        this.__updatingOptions = true;
        try {
          this.__setFilter("kind", ankamon.ui.sessions.Users.KIND[key.slice(0, i)] || "");
        } finally {
          this.__updatingOptions = false;
        }
        this.__setFilter("user", key.slice(i + 1));
      }
    },

    /** Tablo satırı sağ menüsü: tahta (bilgisayar) menüsü + kullanıcı süzgeci. */
    __tableMenu(row) {
      const C = ankamon.ui.sessions.Users.COL;
      const menu = this.__groupMenu(row[C.boardKey], true);
      menu.add(ankamon.ui.BoardOps.menuButton(ankamon.ui.Shell.ICON.sessions, `Yalnız bu kullanıcı (${row[C.user]})`,
        () => this.__pickKey(row[C.kindKey] + ":" + row[C.username])));
      return menu;
    },

    /** Çubuğa sağ tıklama menüsü. @param data {Map} {item, event} */
    __itemMenu(data) {
      if (this.__shotOf(data.item)) {
        const open = new qx.ui.menu.Menu();
        open.add(ankamon.ui.BoardOps.menuButton(ankamon.ui.Shell.ICON.screenshot, "Görüntüyü aç", () => this.__openShot(data.item)));
        this.__openMenu(open, data.event);
        return;
      }
      const s = this.__shown && this.__shown.find(x => (x.kind === "webshell" ? "w:" : "b:") + x.id === data.item);
      if (!s) {
        return;
      }
      const ops = ankamon.ui.BoardOps;
      const icon = ankamon.ui.Shell.ICON;
      const menu = new qx.ui.menu.Menu();
      menu.add(ops.menuButton(icon.sessions, `Yalnız bu kullanıcı (${s.username})`, () => this.__pickKey(s.kind + ":" + s.username)));
      menu.add(ops.menuButton(icon.boards, `Yalnız bu tahta (${s.board || s.host})`, () => this.__setFilter("board", s.board || s.host)));
      if (s.kind === "board") {
        menu.add(new qx.ui.menu.Separator());
        menu.add(ops.menuButton(icon.movements, "Oturum hareketleri", () => this.__page.showMovements({
          session: { id: s.id, label: `${s.username} · ${s.board || s.host} · ${ankamon.util.Format.dateTime(s.started_at * 1000)}` },
          username: s.username, board_id: s.board_id, board_name: s.board || s.host
        })));
        menu.add(ops.menuButton(icon.movements, `Bu kullanıcının tüm hareketleri (${s.username})`,
          () => this.__page.showMovements({ username: s.username })));
      }
      // Açık tahta oturumu: o tahtanın canlı ekranı (Ekran ▸ Ekranı göster ile aynı işlev).
      if (s.kind === "board" && !s.ended_at && s.board_id && this.__page._can("screen")) {
        menu.add(new qx.ui.menu.Separator());
        menu.add(ops.menuButton(icon.screen, `Ekranı göster (${s.board || s.host})`,
          () => ops.screen([{ id: s.board_id, label: s.board || s.host }], this.__page._user)));
      }
      if (s.kind === "board" && !s.ended_at && s.board_id && this.__page._can("boards.login")) {
        const board = { id: s.board_id, label: s.board };
        menu.add(new qx.ui.menu.Separator());
        menu.add(ops.menuButton(icon.logout, `Oturumu kapat (${s.username})`,
          () => ops.sessionAction("logout", [board], null, s.username)));
        menu.add(ops.menuButton(icon.lock, `Oturumu kilitle (${s.username})`,
          () => ops.sessionAction("lock", [board], null, s.username)));
      }
      this.__openMenu(menu, data.event);
    },

    __openMenu(menu, event) {
      if (!menu) {
        return;
      }
      menu.addListenerOnce("disappear", () => qx.event.Timer.once(() => menu.destroy(), null, 0));
      menu.openAtPoint({ left: event.pageX, top: event.pageY });
    },

    /**
     * Satır (zaman çizelgesindeki satır adı ya da üstteki tablonun satırı) sağ menüsü: süzgece alma ve —
     * Tahtalar'a kayıtlı olmayan bilgisayarda (anahtar "h<ad>"), "sessions.hosts" yetkisiyle — kayıtlarını
     * silme. @param key {String} satır anahtarı (tahta satırlarında "b<id>"/"h<ad>", kullanıcıda "<tür>:<ad>")
     * @return {qx.ui.menu.Menu|null}
     */
    __groupMenu(key, forceBoard) {
      const byBoard = forceBoard || this.__value(this.__groupBy) === "board";
      const ops = ankamon.ui.BoardOps;
      const icon = ankamon.ui.Shell.ICON;
      const menu = new qx.ui.menu.Menu();
      if (byBoard) {
        const s = (this.__shown || []).find(x => this.__boardKey(x) === key);
        const name = s ? s.board || s.host : key.slice(1);
        menu.add(ops.menuButton(icon.boards, `Yalnız bu bilgisayar (${name})`, () => this.__setFilter("board", name)));
        if (key.startsWith("b")) {
          menu.add(ops.menuButton(icon.movements, "Oturum hareketleri", () => this.__page.showMovements(
            { board_id: Number(key.slice(1)), board_name: name, username: this.__single("user") || undefined })));
        }
        if (key.startsWith("h") && this.__page._can("sessions.hosts")) {
          menu.add(new qx.ui.menu.Separator());
          menu.add(ops.menuButton(icon.delete, `Bu bilgisayarın kayıtlarını sil (${key.slice(1)})…`,
            () => this.__deleteHost(key.slice(1))));
        }
      } else {
        const i = key.indexOf(":");
        // "(oturum yok)" satırı: yalnız oturumsuz çekilen ekran görüntülerini taşır, süzülecek bir kullanıcı yoktur.
        if (key.slice(i + 1)) {
          menu.add(ops.menuButton(icon.sessions, `Yalnız bu kullanıcı (${key.slice(i + 1)})`, () => this.__pickKey(key)));
        } else {
          menu.add(ops.menuButton(icon.movements, "Oturumsuz hareketler", () => this.__page.showMovements({ username: "-" })));
        }
        if (key.startsWith("board:") && key.slice(i + 1)) {
          // Tahta süzgecinde tek kayıtlı tahta seçiliyse o tahtadaki, değilse bütün tahtalardaki hareketleri.
          const name = this.__single("board");
          const s = name && (this.__sessions || []).find(x => x.board_id && x.board === name);
          menu.add(ops.menuButton(icon.movements, "Oturum hareketleri", () => this.__page.showMovements({
            username: key.slice(i + 1), board_id: s ? s.board_id : undefined, board_name: s ? name : undefined
          })));
        }
      }
      return menu;
    },

    /**
     * Kayıtlı olmayan bilgisayarın oturum ve açık/kapalı kayıtlarını (isteğe bağlı ham loglarını) onay
     * aldıktan sonra siler (DELETE /api/board-hosts — bkz. SessionsApi::deleteHost).
     */
    async __deleteHost(host) {
      const esc = qx.bom.String.escape;
      const count = (this.__sessions || []).filter(s => !s.board_id && s.host === host).length;
      const win = ankamon.ui.Dialog.window("Bilgisayarın kayıtlarını sil", 480);
      win.add(new qx.ui.basic.Label(
        `<b>${esc(host)}</b> Tahtalar'a kayıtlı değil. Bu bilgisayarın <b>${count} oturum kaydı</b> ve açık/kapalı ` +
        "aralıkları kalıcı olarak silinecek; geri alınamaz.<br><br>Bilgisayar hâlâ log gönderiyorsa yalnız bundan " +
        "sonraki oturumları yeniden görünür.").set({ rich: true, wrap: true }));
      const logs = new qx.ui.form.CheckBox("Ham sistem loglarını da sil (Loglar ▸ Sistem logları)");
      win.add(logs);
      const cancel = new qx.ui.form.Button("Vazgeç");
      const ok = new qx.ui.form.Button("Sil");
      let confirmed = false;
      cancel.addListener("execute", () => win.close());
      ok.addListener("execute", () => {
        confirmed = true;
        win.close();
      });
      ankamon.ui.Dialog.buttons(win, [cancel, ok]);
      await new Promise(resolve => {
        win.addListener("close", resolve);
        win.open();
      });
      if (!confirmed) {
        return;
      }
      try {
        const res = await ankamon.io.Api.del("/board-hosts", { host, logs: logs.getValue() });
        this.__uptime = null;   // açık/kapalı aralıkları yeniden çekilsin
        if (this.__single("board") === host) {
          this.__setFilter("board", "");
        }
        await this.__page.refresh();
        ankamon.ui.Dialog.alert(`<b>${esc(host)}</b>: ${res.sessions} oturum kaydı, ${res.uptime} açık/kapalı aralığı` +
          (logs.getValue() ? `, ${res.logs} log satırı` : "") + " silindi.", "Silindi");
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    }
  }
});
