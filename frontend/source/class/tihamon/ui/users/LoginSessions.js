/**
 * Kullanıcılar ▸ Oturumlar: Tiha-Mon'un KENDİ kullanıcılarının oturum geçmişi (kim, ne zaman, hangi IP'den
 * girdi; son etkinlik; ne zaman/nasıl çıktı; o oturumda hangi işlemleri yaptı) — bkz. backend
 * LoginSessionsApi, db/migrations/019_login_sessions.sql. Tahtalardaki kullanıcı oturumları (Tahtalar ▸
 * Oturumlar, page.Sessions) ile KARIŞTIRILMASIN. Görmek 'logins' yetkisi ister.
 * Satıra çift tıklama / sağ menü: o oturumun işlem dökümü (audit_log).
 *
 * Durum ve süre sunucuda belirlenir (göç 021): tarayıcı çıkış yapmadan kapatılınca belirteç geçerli kalsa
 * da oturum "Bağlantı kesildi" olur ve süresi son isteğe kadardır; aynı tarayıcıdan yeniden giriş eski
 * oturumu "Yeniden giriş yapıldı" ile kapatır. Kendiliğinden biten oturumlarda "Çıkış" son etkinliktir (≈).
 */
qx.Class.define("tihamon.ui.users.LoginSessions", {
  extend: qx.ui.tabview.Page,

  /** @param page {tihamon.page.Base} tablo yardımcıları için */
  construct(page) {
    super("Oturumlar");
    this.setUserData("key", "logins");
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);
    this.__page = page;

    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    const refresh = new qx.ui.form.Button("Yenile");
    refresh.addListener("execute", () => this.load());
    bar.add(refresh);
    bar.add(new qx.ui.basic.Label("Dönem:"));
    this.__days = new qx.ui.form.SelectBox().set({ width: 140 });
    [[1, "Son 1 gün"], [7, "Son 7 gün"], [30, "Son 30 gün"], [90, "Son 90 gün"], [365, "Son 1 yıl"]].forEach(([d, label]) => {
      const item = new qx.ui.form.ListItem(label, null, d);
      this.__days.add(item);
      if (d === 30) {
        this.__days.setSelection([item]);
      }
    });
    this.__days.addListener("changeSelection", () => this.load());
    bar.add(this.__days);
    const actions = new qx.ui.form.Button("İşlemleri göster");
    actions.addListener("execute", () => {
      const row = this.__selectedRow();
      if (row) {
        this.__showActions(row);
      } else {
        tihamon.ui.Dialog.alert("Önce listeden bir oturum seçin.");
      }
    });
    bar.add(actions);
    this.add(bar);

    this.__columns = [
      { id: "username", label: "Kullanıcı", width: 120 },
      { id: "full_name", label: "Ad soyad", width: 150 },
      { id: "started", label: "Giriş", width: 150 },
      { id: "last_seen", label: "Son etkinlik", width: 150 },
      { id: "ended", label: "Çıkış", width: 150 },
      { id: "duration", label: "Süre", width: 100 },
      { id: "status", label: "Durum", width: 140 },
      { id: "ip", label: "IP adresi", width: 120 },
      // IP → MAC → takma ad (tahtalar/ağ listesi); takma ad yoksa MAC (bkz. LoginSessionsApi::COMPUTER_JOIN).
      { id: "computer", label: "Bilgisayar", hint: "Bilgisayar (IP → MAC → tahta/ağ listesindeki takma ad; yoksa MAC)", width: 170 },
      { id: "browser", label: "Tarayıcı", width: 160 },
      { id: "actions", label: "İşlem", hint: "İşlem sayısı (giriş/çıkış dahil)", width: 60 },
      { id: "action_names", label: "Kullandığı işlevler", width: 300 }
    ];
    this.__table = page._createTable(this.__columns, { storageKey: "logins.columns" });
    this.__filterFields = page._addColumnFilters(this.__table, this.__columns, this.__apply.bind(this));
    this.__table.addListener("cellDbltap", e => {
      const row = e.getRow() === null ? null : this.__shownRows[e.getRow()];
      if (row) {
        this.__showActions(row.session);
      }
    });
    this.__table.addListener("cellContextmenu", e => {
      const row = e.getRow() === null ? null : this.__shownRows[e.getRow()];
      if (!row) {
        this.__table.setContextMenu(null);
        return;
      }
      const menu = new qx.ui.menu.Menu();
      const item = new qx.ui.menu.Button(`İşlemleri göster (${row.session.username}, ${tihamon.util.Format.dateTime(row.session.started_ts)})`);
      item.addListener("execute", () => this.__showActions(row.session));
      menu.add(item);
      this.__table.setContextMenu(menu);
    });
    this.add(this.__table, { flex: 1 });
    this.__count = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
    this.add(this.__count);
  },

  statics: {
    STATUS: {
      active: "Aktif (sekme odakta)", open: "Açık (arka planda)", gone: "Bağlantı kesildi (çıkış yapılmadan)",
      logout: "Çıkış yaptı", replaced: "Yeniden giriş yapıldı", expired: "Zaman aşımı", revoked: "Sonlandırıldı"
    },
    /** Hâlâ bağlı olan durumlar (süre "sürüyor"). */
    LIVE: ["active", "open"],

    /** User-Agent'tan kısa "Tarayıcı / işletim sistemi" (ör. "Chrome 141 / Windows"). */
    browser(ua) {
      if (!ua) {
        return "";
      }
      const pick = [[/Edg\/(\d+)/, "Edge"], [/OPR\/(\d+)/, "Opera"], [/Firefox\/(\d+)/, "Firefox"],
        [/Chrom(?:e|ium)\/(\d+)/, "Chrome"], [/Version\/(\d+).*Safari/, "Safari"]]
        .map(([re, name]) => { const m = ua.match(re); return m ? `${name} ${m[1]}` : null; }).find(Boolean);
      const os = [[/Windows/, "Windows"], [/Android/, "Android"], [/iPhone|iPad/, "iOS"], [/Mac OS X/, "macOS"],
        [/Linux/, "Linux"]].find(([re]) => re.test(ua));
      return [pick || ua.slice(0, 40), os ? os[1] : null].filter(Boolean).join(" / ");
    }
  },

  members: {
    __page: null,
    __days: null,
    __table: null,
    __columns: null,
    __filterFields: null,
    __rows: null,
    __shownRows: null,
    __count: null,

    async load() {
      const days = this.__days.getSelection()[0].getModel();
      let res;
      try {
        res = await tihamon.io.Api.get(`/login-sessions?days=${days}`);
      } catch (e) {
        this.__count.setValue("Oturumlar okunamadı: " + qx.bom.String.escape(e.message || String(e)));
        return;
      }
      const F = tihamon.util.Format;
      const S = tihamon.ui.users.LoginSessions;
      const now = Date.now();
      this.__rows = res.sessions.map(s => {
        const live = S.LIVE.includes(s.status);
        const end = live ? now : (s.ended_ts || s.last_seen_ts || s.started_ts);
        // Çıkış/yeniden giriş anı kesindir; diğer bitişler son istek anıdır (yaklaşık).
        const exact = s.status === "logout" || s.status === "replaced";
        return {
          session: s,
          cells: [
            s.id, s.username, s.full_name || "",
            F.dateTime(s.started_ts), F.dateTime(s.last_seen_ts),
            live ? "—" : (exact ? "" : "≈ ") + F.dateTime(end),
            F.duration(Math.max(0, end - s.started_ts) / 1000) + (live ? " (sürüyor)" : ""),
            S.STATUS[s.status] || s.status,
            s.ip || "", s.computer || "", S.browser(s.user_agent), Number(s.actions) || 0, s.action_names || ""
          ]
        };
      });
      this.__apply();
    },

    __apply() {
      if (!this.__rows) {
        return;
      }
      const filters = this.__columns
        .map((column, index) => ({ index: index + 1, text: (this.__filterFields[column.id].getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
      const shown = this.__rows.filter(({ cells }) =>
        filters.every(f => String(cells[f.index] ?? "").toLowerCase().includes(f.text)));
      this.__table.getTableModel().setData(shown.map(r => r.cells));
      this.__shownRows = shown;
      const live = tihamon.ui.users.LoginSessions.LIVE;
      const open = this.__rows.filter(r => live.includes(r.session.status)).length;
      this.__count.setValue(`${shown.length} / ${this.__rows.length} oturum · şu an bağlı: ${open}`);
    },

    __selectedRow() {
      const ids = this.__page._selectedIds(this.__table);
      const row = ids.length ? (this.__rows || []).find(r => r.session.id === ids[0]) : null;
      return row ? row.session : null;
    },

    /** Oturumda yapılan işlemler (audit_log): zaman, işlem, hedef, ayrıntı. */
    async __showActions(s) {
      const F = tihamon.util.Format;
      let res;
      try {
        res = await tihamon.io.Api.get(`/login-sessions/${s.id}/actions`);
      } catch (e) {
        tihamon.ui.Dialog.error(e);
        return;
      }
      const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
      const win = tihamon.ui.Dialog.window(`Oturum işlemleri: ${s.username} · ${F.dateTime(s.started_ts)} · ${s.ip || ""}`,
        Math.min(1000, root.width - 40));
      const model = new qx.ui.table.model.Simple();
      model.setColumns(["Zaman", "İşlem", "Hedef", "Ayrıntı"]);
      model.setData(res.actions.map(a => [F.dateTime(a.ts), a.action, a.target || "",
        a.detail && a.detail !== "[]" && a.detail !== "{}" ? String(a.detail) : ""]));
      const table = new qx.ui.table.Table(model, {
        tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj)
      }).set({ statusBarVisible: false, height: Math.min(520, root.height - 200) });
      const behavior = table.getTableColumnModel().getBehavior();
      behavior.setWidth(0, 150);
      behavior.setWidth(1, 160);
      behavior.setWidth(2, 200);
      behavior.setWidth(3, "1*");
      win.add(new qx.ui.basic.Label(res.actions.length
        ? `${res.actions.length} işlem. Yalnız kayıt altına alınan işlemler (giriş/çıkış, ekleme/değiştirme/silme, görev başlatma…) listelenir; sayfa görüntülemeleri kaydedilmez.`
        : "Bu oturumda kayda geçen işlem yok (yalnız görüntüleme yapılmış ya da oturum, işlem kaydı eklenmeden önce açılmış).").set({ rich: true, textColor: "app-muted" }));
      win.add(table, { flex: 1 });
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      tihamon.ui.Dialog.buttons(win, [close]);
      win.open();
    }
  }
});
