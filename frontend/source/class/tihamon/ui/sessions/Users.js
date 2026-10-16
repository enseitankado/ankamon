/**
 * Oturumlar sayfasının "Kullanıcılar" sekmesi: kullanıcıların hangi tahtada, ne zaman, ne kadar
 * süre oturum açtığını (ve hangilerinin düzgün kapanmadığını) zaman çizelgesinde gösterir.
 *
 * Veri, Oturumlar sekmesiyle aynı (/board-sessions — page.Sessions çeker, setData ile verir);
 * süzme ve özetleme tamamen istemcide yapılır.
 *  - Süzgeçler: kullanıcı, tahta, tür (tahta oturumu / web terminal), "yalnız düzgün kapanmayanlar".
 *  - Gruplama: satırlar tahtalar (çubukta kullanıcı adı) ya da kullanıcılar (çubukta tahta).
 *  - Aralık: hazır düğmeler + çizelgede tekerlek/sürükleme; alttaki özet ve tablo HER ZAMAN görünen
 *    aralığa göre hesaplanır (aralığı taşan oturumların yalnız aralık içindeki süresi sayılır).
 *  - "Satırlar: Tahtalar" görünümünde tahtanın KAPALI olduğu aralıklar satırda gri taralı arka plan
 *    olarak görünür (kurum kapalıyken boşluk ile "kimse oturum açmadı"yı ayırır — bkz. __loadUptime).
 *  - Tablo satırına çift tıklama o tahtayı/kullanıcıyı süzgece alır; çubuğa sağ tıklama süzme
 *    ve (açık tahta oturumunda, "boards.login" yetkisiyle) oturumu kapat/kilitle menüsü açar.
 *
 * "Düzgün kapanmadı": kapanış mesajı gelmeden tahta çevrimdışı oldu (offline — elektrik kesintisi,
 * güç düğmesiyle kapatma) ya da kapanmadan yeni oturum açıldı (superseded) ya da web terminal
 * hizmeti yeniden başladı (restart) — bkz. worker/tihamon/tasks/board_sessions.py.
 */
qx.Class.define("tihamon.ui.sessions.Users", {
  extend: qx.ui.tabview.Page,

  /** @param page {tihamon.page.Sessions} */
  construct(page) {
    super("Kullanıcılar");
    this.__page = page;
    this.setLayout(new qx.ui.layout.VBox(6));
    this.setPadding(8);

    const filters = new qx.ui.container.Composite(new qx.ui.layout.Flow(8, 6).set({ alignY: "middle" }));
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
    const S = tihamon.ui.sessions.Users.STATES;
    // Kutu boyutu satır içi: Timeline CSS'i sonradan yüklendiğinden etiket genişliği o olmadan
    // ölçülür ve son maddeler kırpılırdı (renkler sınıftan gelir, ölçüyü etkilemez).
    const chip = cls => `<span class="tm-legend ${cls}" style="display:inline-block;width:12px;height:12px;` +
      "box-sizing:border-box;border:1px solid;border-radius:2px;vertical-align:-2px;margin:0 4px 0 10px\"></span>";
    const legend = Object.keys(S).map(k => chip("tm-s-" + k) + S[k]).join("") + chip("tm-off") + "Tahta kapalı";
    ranges.add(new qx.ui.basic.Label(legend).set({ rich: true, alignY: "middle", textColor: "app-muted" }));
    this.add(ranges);

    this.__summary = new qx.ui.basic.Label("").set({ rich: true });
    this.add(this.__summary);

    const split = new qx.ui.splitpane.Pane("vertical");
    this.__timeline = new tihamon.ui.sessions.Timeline();
    this.__timeline.addListener("changeRange", e => this.__summarize(e.getData()));
    this.__timeline.addListener("itemContextmenu", e => this.__itemMenu(e.getData()));
    split.add(this.__timeline, 3);

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
    this.__table.setToolTipText("Çift tıklayınca o satır süzgece alınır");
    split.add(this.__table, 2);
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
      return ["offline", "superseded", "restart"].includes(s.end_reason);
    },

    state(s) {
      if (!s.ended_at) {
        return s.locked ? "locked" : "open";
      }
      if (s.end_reason === "offline" || s.end_reason === "restart") {
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

    /** @param sessions {Array} /board-sessions yanıtındaki satırlar */
    setData(sessions) {
      this.__sessions = sessions;
      this.__fillOptions();
      this.__render();
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
      const F = tihamon.util.Format;
      const S = tihamon.ui.sessions.Users;
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
        // Aynı ad iki türde (tahta kullanıcısı / Tiha-Mon kullanıcısı) farklı kişiler olabilir.
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
            `${F.dateTime(s.started_at * 1000)} → ${s.ended_at ? F.dateTime(s.ended_at * 1000) : "devam ediyor"}<br>` +
            `Süre: ${F.duration(end - s.started_at)}<br>` +
            `${s.kind === "webshell" ? "Web terminal · " : ""}${s.locked ? "Açık (kilitli)" : F.sessionEndReason(s.end_reason)}`
        };
      });
      if (byBoard) {
        items.push(...this.__offItems(new Set(groups.keys())));
      }
      this.__timeline.setData([...groups.entries()].map(([id, content]) => ({ id, content: esc(content) })), items);
      const nameLabel = byBoard ? "Tahta" : "Kullanıcı";
      if (this.__columns[0].label !== nameLabel) {
        this.__columns[0].label = nameLabel;
        this.__table.getTableModel().setColumnNamesById({ name: nameLabel });
      }
      this.__summarize(this.__timeline.getWindow());
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
      const F = tihamon.util.Format;
      const S = tihamon.ui.sessions.Users;
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
        const res = await tihamon.io.Api.get(`/board-uptime?from=${q.from}&to=${q.to}`);
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
      const key = this.__table.getTableModel().getValue(0, rowIndex);
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
      const ops = tihamon.ui.BoardOps;
      const icon = tihamon.ui.Shell.ICON;
      const menu = new qx.ui.menu.Menu();
      menu.add(ops.menuButton(icon.sessions, `Yalnız bu kullanıcı (${s.username})`, () => {
        this.__selectValue(this.__kind, s.kind);
        this.__fillOptions();
        this.__selectValue(this.__user, s.username);
      }));
      menu.add(ops.menuButton(icon.boards, `Yalnız bu tahta (${s.board || s.host})`,
        () => this.__selectValue(this.__board, this.__boardKey(s))));
      if (s.kind === "board" && !s.ended_at && s.board_id && this.__page._can("boards.login")) {
        const board = { id: s.board_id, label: s.board };
        menu.add(new qx.ui.menu.Separator());
        menu.add(ops.menuButton(icon.logout, `Oturumu kapat (${s.username})`,
          () => ops.sessionAction("logout", [board], null, s.username)));
        menu.add(ops.menuButton(icon.lock, `Oturumu kilitle (${s.username})`,
          () => ops.sessionAction("lock", [board], null, s.username)));
      }
      menu.addListenerOnce("disappear", () => qx.event.Timer.once(() => menu.destroy(), null, 0));
      menu.openAtPoint({ left: data.event.pageX, top: data.event.pageY });
    }
  }
});
