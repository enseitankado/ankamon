/**
 * Oturumlar sayfasının "Zaman çizelgesi" sekmesi (eski adı "Kullanıcılar"): kullanıcıların hangi tahtada, ne zaman, ne kadar
 * süre oturum açtığını (ve hangilerinin düzgün kapanmadığını) zaman çizelgesinde gösterir.
 *
 * Veri, Oturumlar sekmesiyle aynı (/board-sessions — page.Sessions çeker, setData ile verir);
 * süzme ve özetleme tamamen istemcide yapılır.
 *  - Süzgeçler: kullanıcı, tahta, tür (tahta oturumu / web terminal), "yalnız düzgün kapanmayanlar".
 *  - Gruplama: satırlar tahtalar (çubukta kullanıcı adı) ya da kullanıcılar (çubukta tahta).
 *  - Aralık: hazır düğmeler + çizelgede tekerlek/sürükleme; özet ve (üstteki) tablo HER ZAMAN görünen
 *    aralığa göre hesaplanır (aralığı taşan oturumların yalnız aralık içindeki süresi sayılır).
 *  - "Satırlar: Tahtalar" görünümünde tahtanın KAPALI olduğu aralıklar satırda gri taralı arka plan
 *    olarak görünür (kurum kapalıyken boşluk ile "kimse oturum açmadı"yı ayırır — bkz. __loadUptime).
 *  - Tablo satırına çift tıklama o tahtayı/kullanıcıyı süzgece alır; çubuğa sağ tıklama süzme
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

    // Süzgeçler ayrı bir bar (kullanıcı isteği): temanın araç çubuğu görünümü — Ekranlar sekmesinin
    // araç çubuğuyla aynı zemin/kenar; Flow yerleşimi dar pencerede satır kırar.
    const filters = new qx.ui.container.Composite(new qx.ui.layout.Flow(8, 6).set({ alignY: "middle" })).set({
      appearance: "toolbar", padding: [6, 10]
    });
    const labeled = (text, widget) => {
      filters.add(new qx.ui.basic.Label(text).set({ alignY: "middle" }));
      filters.add(widget);
      widget.addListener("changeSelection", () => this.__changed());
      return widget;
    };
    this.__user = labeled("Kullanıcı:", new qx.ui.form.SelectBox().set({ width: 190 }));
    this.__board = labeled("Tahta:", new qx.ui.form.SelectBox().set({ width: 210 }));
    this.__kind = labeled("Tür:", this.__select([["board", "Tahta oturumu"], ["webshell", "Web terminal"], ["", "Tümü"]]));
    this.__groupBy = labeled("Satırlar:", this.__select([["board", "Tahtalar"], ["user", "Kullanıcılar"]]));
    this.__badOnly = new qx.ui.form.CheckBox("Yalnız düzgün kapanmayanlar").set({ alignY: "middle" });
    this.__badOnly.addListener("changeValue", () => this.__changed());
    filters.add(this.__badOnly);
    this.add(filters);

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
    this.__timeline = new ankamon.ui.sessions.Timeline();
    this.__timeline.addListener("changeRange", e => this.__summarize(e.getData()));
    this.__timeline.addListener("itemContextmenu", e => this.__itemMenu(e.getData()));
    this.__timeline.addListener("groupContextmenu", e => {
      const data = e.getData();
      this.__openMenu(this.__groupMenu(data.group), data.event);
    });
    const lower = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({ paddingTop: 6 });
    lower.add(ranges);
    lower.add(this.__summary);
    lower.add(this.__timeline, { flex: 1 });

    this.__columns = [
      { id: "name", label: "Tahta" },
      { id: "count", label: "Oturum", width: 80 },
      { id: "total", label: "Toplam süre", width: 120 },
      { id: "avg", label: "Ortalama", width: 110 },
      { id: "bad", label: "Düzgün kapanmayan", width: 150 },
      { id: "first", label: "İlk oturum", width: 150 },
      { id: "last", label: "Son oturum", width: 150 }
    ];
    this.__table = page._createTable(this.__columns, { prefsKey: "board-users.columns" });
    // Süre/tarih sütunları ekranda metin; sıralama satır sonundaki ham sayılarla yapılır (bkz. __summarize).
    const model = this.__table.getTableModel();
    [[3, 8], [4, 9], [6, 10], [7, 11]].forEach(([col, raw]) =>
      model.setSortMethods(col, (a, b) => (a[raw] - b[raw]) || 0));
    this.__table.addListener("cellDbltap", e => this.__pickRow(e.getRow()));
    this.__table.addListener("cellContextmenu", e => {
      const key = e.getRow() === null ? null : this.__table.getTableModel().getValue(0, e.getRow());
      this.__table.setContextMenu(key ? this.__groupMenu(key) : null);
    });
    this.__table.setToolTipText("Çift tıklayınca o satır süzgece alınır");
    // SplitPane.add() ÇIPLAK SAYI flex bekler (genel Widget.add'in aksine — bkz. ankamon-architecture notu).
    split.add(this.__table, 2);
    split.add(lower, 3);
    this.add(split, { flex: 1 });
  },

  statics: {
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
    __user: null,
    __board: null,
    __pinnedBoard: null,
    __pendingBoard: false,
    __kind: null,
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

    /** @param sessions {Array} /board-sessions yanıtındaki satırlar */
    setData(sessions) {
      this.__sessions = sessions;
      if (this.__pendingBoard) {
        this.__applyBoard();
      } else {
        this.__fillOptions();
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
        this.__selectValue(this.__kind, kind === "webshell" ? "webshell" : "board");
        this.__fillOptions();
        this.__selectValue(this.__user, username);
        this.__selectValue(this.__board, "");
        this.__selectValue(this.__groupBy, "board");
        this.__badOnly.setValue(false);
      } finally {
        this.__updatingOptions = false;
      }
      this.__render();
      this.__timeline.fit();
    },

    /**
     * Tahtalar/Ekranlar sağ menüsü "Oturum geçmişi" (bkz. page.Sessions.openWith): yalnız o tahta — Tür "Tümü"
     * (web terminal dahil), satırlar kullanıcılara göre, aralık tahtanın bütün oturumlarını kapsar. Veri henüz
     * gelmediyse (sayfa ilk açılıyor) setData'da uygulanır. Tahtanın hiç oturumu yoksa da seçenek listede kalır
     * (bkz. __fillOptions __pinnedBoard) — yoksa seçim düşer ve "Tüm tahtalar" görünürdü.
     * @param board {Map} {id, name}
     */
    showBoard(board) {
      this.__pinnedBoard = { key: "b" + board.id, name: board.name };
      this.__pendingBoard = true;
      if (this.__sessions) {
        this.__applyBoard();
      }
    },

    __applyBoard() {
      this.__pendingBoard = false;
      this.__updatingOptions = true;
      try {
        this.__selectValue(this.__kind, "");
        this.__fillOptions();
        this.__selectValue(this.__user, "");
        this.__selectValue(this.__board, this.__pinnedBoard.key);
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

    /** Kullanıcı/tahta seçeneklerini (seçili türe uyan) veriden üretir; seçili değer korunur. */
    __fillOptions() {
      if (!this.__sessions) {
        return;
      }
      const kind = this.__value(this.__kind);
      const rows = this.__sessions.filter(s => !kind || s.kind === kind);
      const users = new Map();
      const boards = new Map();
      rows.forEach(s => {
        users.set(s.username, (users.get(s.username) || 0) + 1);
        boards.set(this.__boardKey(s), s.board || s.host || "?");
      });
      if (this.__pinnedBoard && !boards.has(this.__pinnedBoard.key)) {
        boards.set(this.__pinnedBoard.key, this.__pinnedBoard.name);
      }
      const fill = (box, entries, allLabel) => {
        const keep = this.__value(box);
        box.removeAll().forEach(item => item.dispose());
        box.add(new qx.ui.form.ListItem(allLabel, null, ""));
        entries.forEach(([value, label]) => box.add(new qx.ui.form.ListItem(label, null, value)));
        this.__selectValue(box, entries.some(([v]) => v === keep) ? keep : "");
      };
      const collator = new Intl.Collator("tr");
      this.__updatingOptions = true;
      try {
        fill(this.__user, [...users.keys()].sort(collator.compare).map(u => [u, `${u} (${users.get(u)})`]), "Tüm kullanıcılar");
        fill(this.__board, [...boards.entries()].sort((a, b) => collator.compare(a[1], b[1])), "Tüm tahtalar");
      } finally {
        this.__updatingOptions = false;
      }
    },

    __changed() {
      if (this.__updatingOptions) {
        return;
      }
      this.__fillOptions();
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
      const kind = this.__value(this.__kind);
      const user = this.__value(this.__user);
      const board = this.__value(this.__board);
      const byBoard = this.__value(this.__groupBy) === "board";
      const badOnly = this.__badOnly.getValue();
      const now = Date.now() / 1000;

      this.__shown = this.__sessions.filter(s =>
        (!kind || s.kind === kind) && (!user || s.username === user) &&
        (!board || this.__boardKey(s) === board) && (!badOnly || S.isBad(s)));

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
      if (byBoard) {
        items.push(...this.__offItems(new Set(groups.keys())));
      }
      this.__timeline.setData([...groups.entries()].map(([id, content]) => ({ id, content: esc(content) })), items);
      // Satır adları sütununun başlığı: tahta satırlarında kayıtlı tahtalar dışında, log gönderen ama
      // tahta olarak eklenmemiş makineler (bilgisayar adıyla) de bulunabildiğinden "Bilgisayar".
      this.__timeline.setGroupHeader(byBoard ? "Bilgisayar" : "Kullanıcı");
      const nameLabel = byBoard ? "Tahta" : "Kullanıcı";
      if (this.__columns[0].label !== nameLabel) {
        this.__columns[0].label = nameLabel;
        this.__table.getTableModel().setColumnNamesById({ name: nameLabel });
      }
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

      const per = new Map();
      let count = 0, total = 0, bad = 0;
      this.__shown.forEach(s => {
        const end = s.ended_at || now;
        if (end < from || s.started_at > to) {
          return;
        }
        const seconds = Math.max(0, Math.min(end, to) - Math.max(s.started_at, from));
        const key = byBoard ? this.__boardKey(s) : s.kind + ":" + s.username;
        const name = byBoard ? (s.board || s.host || "?") : s.username + (s.kind === "webshell" ? " (web terminal)" : "");
        const row = per.get(key) || { key, name, count: 0, total: 0, bad: 0, first: Infinity, last: 0 };
        row.count++;
        row.total += seconds;
        row.bad += S.isBad(s) ? 1 : 0;
        row.first = Math.min(row.first, s.started_at);
        row.last = Math.max(row.last, s.started_at);
        per.set(key, row);
        count++;
        total += seconds;
        bad += S.isBad(s) ? 1 : 0;
      });

      const span = `${F.dateTime(from * 1000)} – ${F.dateTime(to * 1000)}`;
      this.__summary.setValue(count
        ? `<b>${count}</b> oturum · toplam <b>${F.duration(total)}</b> · ortalama <b>${F.duration(total / count)}</b> · ` +
          `<b style="color:${bad ? "#d93025" : "inherit"}">${bad}</b> düzgün kapanmadı · ` +
          `<b>${per.size}</b> ${byBoard ? "tahta" : "kullanıcı"} <span style="color:#5f6368">(${span})</span>`
        : `<span style="color:#5f6368">Bu aralıkta süzgece uyan oturum yok (${span}). "Tümü" ile bütün kayıtları görebilirsiniz.</span>`);

      this.__rows = [...per.values()].sort((a, b) => b.total - a.total);
      this.__table.getTableModel().setData(this.__rows.map(r => [
        r.key, r.name, r.count, F.duration(r.total), F.duration(r.total / r.count), r.bad,
        F.dateTime(r.first * 1000), F.dateTime(r.last * 1000),
        r.total, r.total / r.count, r.first, r.last
      ]), false);
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

    /** Tablo satırına çift tıklama: o tahtayı/kullanıcıyı süzgece al. */
    __pickRow(rowIndex) {
      this.__pickKey(this.__table.getTableModel().getValue(0, rowIndex));
    },

    /** Satır anahtarını (bkz. __groupMenu) süzgece alır. */
    __pickKey(key) {
      if (!key) {
        return;
      }
      if (this.__value(this.__groupBy) === "board") {
        this.__selectValue(this.__board, key);
      } else {
        const i = key.indexOf(":");
        this.__selectValue(this.__kind, key.slice(0, i));
        this.__fillOptions();
        this.__selectValue(this.__user, key.slice(i + 1));
      }
    },

    /** Çubuğa sağ tıklama menüsü. @param data {Map} {item, event} */
    __itemMenu(data) {
      const s = this.__shown && this.__shown.find(x => (x.kind === "webshell" ? "w:" : "b:") + x.id === data.item);
      if (!s) {
        return;
      }
      const ops = ankamon.ui.BoardOps;
      const icon = ankamon.ui.Shell.ICON;
      const menu = new qx.ui.menu.Menu();
      menu.add(ops.menuButton(icon.sessions, `Yalnız bu kullanıcı (${s.username})`, () => {
        this.__selectValue(this.__kind, s.kind);
        this.__fillOptions();
        this.__selectValue(this.__user, s.username);
      }));
      menu.add(ops.menuButton(icon.boards, `Yalnız bu tahta (${s.board || s.host})`,
        () => this.__selectValue(this.__board, this.__boardKey(s))));
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
    __groupMenu(key) {
      const byBoard = this.__value(this.__groupBy) === "board";
      const ops = ankamon.ui.BoardOps;
      const icon = ankamon.ui.Shell.ICON;
      const menu = new qx.ui.menu.Menu();
      if (byBoard) {
        const s = (this.__shown || []).find(x => this.__boardKey(x) === key);
        const name = s ? s.board || s.host : key.slice(1);
        menu.add(ops.menuButton(icon.boards, `Yalnız bu bilgisayar (${name})`, () => this.__selectValue(this.__board, key)));
        if (key.startsWith("h") && this.__page._can("sessions.hosts")) {
          menu.add(new qx.ui.menu.Separator());
          menu.add(ops.menuButton(icon.delete, `Bu bilgisayarın kayıtlarını sil (${key.slice(1)})…`,
            () => this.__deleteHost(key.slice(1))));
        }
      } else {
        const i = key.indexOf(":");
        menu.add(ops.menuButton(icon.sessions, `Yalnız bu kullanıcı (${key.slice(i + 1)})`, () => this.__pickKey(key)));
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
        if (this.__value(this.__board) === "h" + host) {
          this.__selectValue(this.__board, "");
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
