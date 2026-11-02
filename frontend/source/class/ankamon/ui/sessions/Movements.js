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
 * Oturumlar sayfasının "Hareketler" sekmesi: o bilgisayardan gelen log, sensör ve Ankamon işlemlerinden ayıklanan olaylar,
 * kronolojik (bkz. worker tasks/session_activity.py, backend SessionActivityApi). Süzgeçler serbestçe birleşir: tek oturum, bir
 * tahta + kullanıcı, bir tahtanın bütün hareketleri, bir kullanıcının bütün tahtalardaki hareketleri. Zaman çizelgesi ve
 * Oturumlar grid'inin sağ menüsündeki "Oturum hareketleri" buraya süzülmüş gelir (applyFilter).
 */
qx.Class.define("ankamon.ui.sessions.Movements", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Sessions} */
  construct(page) {
    super("Hareketler");
    this.setUserData("key", "movements");
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    const bar = new qx.ui.container.Composite(new qx.ui.layout.Flow(8, 6).set({ alignY: "middle" })).set({ appearance: "toolbar", padding: [6, 10] });
    const labeled = (text, widget) => {
      bar.add(new qx.ui.basic.Label(text).set({ alignY: "middle" }));
      bar.add(widget);
      return widget;
    };
    this.__board = labeled("Bilgisayar:", new qx.ui.form.SelectBox().set({ width: 220 }));
    this.__user = labeled("Kullanıcı:", new qx.ui.form.SelectBox().set({ width: 190 }));
    this.__period = labeled("Dönem:", new qx.ui.form.SelectBox().set({ width: 130 }));
    [[1, "Son 24 saat"], [7, "Son 7 gün"], [30, "Son 30 gün"], [90, "Son 90 gün"], [0, "Tümü"]].forEach(([days, label]) =>
      this.__period.add(new qx.ui.form.ListItem(label, null, days)));
    this.__period.setSelection([this.__period.getSelectables(true)[1]]);
    this.__text = labeled("Ara:", new qx.ui.form.TextField().set({ width: 180, placeholder: "olay ya da log metni" }));
    this.__text.addListener("changeValue", () => this.load());
    this.__add(this.__board, "", "Tüm bilgisayarlar");
    this.__add(this.__user, "", "Tüm kullanıcılar");
    [this.__board, this.__user, this.__period].forEach(box => box.addListener("changeSelection", () => !this.__quiet && this.load()));
    const refresh = new qx.ui.form.Button("Yenile");
    refresh.addListener("execute", () => this.load());
    bar.add(refresh);
    this.add(bar);

    this.__scope = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" })).set({ visibility: "excluded" });
    this.__scopeLabel = new qx.ui.basic.Label("").set({ rich: true, alignY: "middle" });
    const clear = new qx.ui.form.Button("Oturum süzgecini kaldır");
    clear.addListener("execute", () => {
      this.__session = null;
      this.__scope.setVisibility("excluded");
      this.load();
    });
    this.__scope.add(this.__scopeLabel);
    this.__scope.add(clear);
    this.add(this.__scope);

    this.__columns = [
      { id: "time", label: "Zaman", width: 150 },
      { id: "board", label: "Bilgisayar", width: 190, choices: true },
      { id: "user", label: "Kullanıcı", width: 140, choices: true },
      { id: "kind", label: "Tür", width: 90, choices: true },
      { id: "summary", label: "Olay" },
      { id: "detail", label: "Log", width: 320 }
    ];
    this.__table = page._createTable(this.__columns, { prefsKey: "session-movements.columns" });
    this.__fields = page._addColumnFilters(this.__table, this.__columns, () => this.__apply(), { rows: () => this.__rows || [] });
    this.add(this.__table, { flex: 1 });
    this.__status = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
    this.add(this.__status);
    this.addListener("appear", () => this.load());
  },

  statics: {
    KINDS: { oturum: "Oturum", yetki: "Yetki", usb: "USB", ag: "Ağ", uygulama: "Uygulama", ssh: "SSH", guc: "Güç", hesap: "Hesap",
      sistem: "Sistem", komut: "Komut", ankamon: "Ankamon", sensor: "Sensör" }
  },

  members: {
    __board: null,
    __user: null,
    __period: null,
    __text: null,
    __scope: null,
    __scopeLabel: null,
    __columns: null,
    __table: null,
    __fields: null,
    __status: null,
    __rows: null,
    __session: null,
    __quiet: false,
    __seq: 0,

    __add(box, value, label) {
      box.add(new qx.ui.form.ListItem(label, null, value));
    },

    __value(box) {
      const item = box.getSelection()[0];
      return item ? item.getModel() : "";
    },

    __select(box, value) {
      const item = box.getSelectables(true).find(i => i.getModel() === value);
      if (item) {
        box.setSelection([item]);
      }
    },

    /**
     * Süzülmüş açar. @param f {Map} {session?: {id, label}, board_id?, board_name?, username?, days?}: verilmeyen süzgeç "tümü" olur.
     */
    applyFilter(f) {
      this.__quiet = true;
      this.__session = f.session || null;
      this.__scope.setVisibility(f.session ? "visible" : "excluded");
      if (f.session) {
        this.__scopeLabel.setValue("Yalnız bu oturum: <b>" + qx.bom.String.escape(f.session.label) + "</b>");
      }
      if (f.board_id && !this.__board.getSelectables(true).some(i => i.getModel() === String(f.board_id))) {
        this.__add(this.__board, String(f.board_id), f.board_name || "#" + f.board_id);
      }
      if (f.username && !this.__user.getSelectables(true).some(i => i.getModel() === f.username)) {
        this.__add(this.__user, f.username, f.username);
      }
      this.__select(this.__board, f.board_id ? String(f.board_id) : "");
      this.__select(this.__user, f.username || "");
      // Geçmiş bir oturum ya da kişi: dönem kısıtı sonucu boş göstermesin.
      this.__select(this.__period, f.days === undefined ? 0 : f.days);
      this.__quiet = false;
      this.load();
    },

    /** Seçenekleri korur: seçili değer listede kalır, yeni tahta/kullanıcı eklenir. */
    __fill(box, entries, allLabel) {
      const keep = this.__value(box);
      this.__quiet = true;
      box.removeAll().forEach(item => item.dispose());
      this.__add(box, "", allLabel);
      entries.forEach(([value, label]) => this.__add(box, value, label));
      if (keep && !entries.some(([value]) => value === keep)) {
        this.__add(box, keep, keep);
      }
      this.__select(box, keep);
      this.__quiet = false;
    },

    async load() {
      const seq = ++this.__seq;
      const days = this.__value(this.__period);
      const q = {};
      if (this.__value(this.__board)) {
        q.board_id = this.__value(this.__board);
      }
      if (this.__value(this.__user)) {
        q.username = this.__value(this.__user);
      }
      if (this.__session) {
        q.session_id = this.__session.id;
      } else if (days) {
        q.from = Math.floor(Date.now() / 1000) - days * 86400;
      }
      const text = (this.__text.getValue() || "").trim();
      if (text) {
        q.q = text;
      }
      let data;
      try {
        data = await ankamon.io.Api.get("/session-activity?" + new URLSearchParams(q).toString());
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      if (seq !== this.__seq || this.isDisposed()) {
        return;
      }
      this.__fill(this.__board, data.boards.filter(b => b.board_id).map(b => [String(b.board_id), b.board_name]), "Tüm bilgisayarlar");
      this.__fill(this.__user, [["-", "(oturumsuz)"]].concat(data.users.map(u => [u, u])), "Tüm kullanıcılar");
      const F = ankamon.util.Format;
      const K = ankamon.ui.sessions.Movements.KINDS;
      this.__rows = data.events.map(e => [e.id, F.dateTime(e.at * 1000), e.board_name, e.username || "", K[e.kind] || e.kind, e.summary, e.detail || ""]);
      this.__apply();
      this.__status.setValue(`${data.events.length} olay` + (data.limited ? " (en yeni kayıtlar; daraltmak için süzgeç kullanın)" : "") +
        ". Tahta logları her uygulama açılışını kaydetmez: yalnız logda ya da sensörde izi olan hareketler listelenir.");
    },

    __apply() {
      if (!this.__rows) {
        return;
      }
      const filters = this.__columns
        .map((column, index) => ({ index: index + 1, text: ((this.__fields[column.id] || { getValue: () => "" }).getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
      this.__table.getTableModel().setData(
        this.__rows.filter(cells => filters.every(f => ankamon.page.Base.filterMatch(cells[f.index], f.text))));
    }
  }
});
