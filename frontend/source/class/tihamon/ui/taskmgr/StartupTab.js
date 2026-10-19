/**
 * Başlangıç uygulamaları (Windows Görev Yöneticisi gibi): oturum açılınca kendiliğinden başlayan uygulamalar
 * (XDG autostart: /etc/xdg/autostart + ~/.config/autostart) — Ad, Yayımcı (paket), Durum, Başlangıç etkisi.
 * Etkinleştir / Devre dışı bırak, tahtada OTURUM AÇMIŞ kullanıcıya göre uygulanır (kullanıcının autostart
 * geçersiz kılması; sistem dosyası değişmez). Liste yalnız sekme görünürken 10 sn'de bir gelir.
 */
qx.Class.define("tihamon.ui.taskmgr.StartupTab", {
  extend: tihamon.ui.taskmgr.Tab,

  construct(win) {
    super(win, "Başlangıç uygulamaları", "startup");
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__info = new qx.ui.basic.Label("Yükleniyor…").set({ textColor: "app-muted", rich: true });
    bar.add(this.__info, { flex: 1 });
    this.__enable = this._button("Etkinleştir", () => this.__set(true));
    this.__disable = this._button("Devre dışı bırak", () => this.__set(false));
    bar.add(this.__enable);
    bar.add(this.__disable);
    this.add(bar);
    this.__table = this._table([
      { id: "name", label: "Ad", width: 280 },
      { id: "publisher", label: "Yayımcı", width: 200 },
      { id: "status", label: "Durum", width: 100 },
      { id: "impact", label: "Başlangıç etkisi", width: 120 },
      { id: "exec", label: "Komut satırı", width: 300, hidden: true },
      { id: "comment", label: "Açıklama", width: 300, hidden: true }
    ], "taskmgr.startup");
    this._rowMenu(this.__table, id => {
      const it = this.__item(id);
      if (!it) {
        return null;
      }
      const menu = new qx.ui.menu.Menu();
      this._item(menu, it.enabled ? "Devre dışı bırak" : "Etkinleştir", () => this.__set(!it.enabled));
      this._item(menu, "Çevrimiçi ara", () => window.open("https://www.google.com/search?q=" + encodeURIComponent(it.name + " " + it.publisher), "_blank"));
      return menu;
    });
    this.add(this.__table, { flex: 1 });
  },

  members: {
    __table: null,
    __info: null,
    __enable: null,
    __disable: null,

    __item(id) {
      const st = this._win.getModel().startup;
      return st ? st.items.find(x => x.id === id) : null;
    },

    async __set(enable) {
      const it = this.__item(this._selectedId(this.__table));
      if (!it || it.enabled === enable) {
        return;
      }
      try {
        const res = await this._win.getConn().send("startup", { id: it.id, enable });
        it.enabled = enable;
        this.update(this._win.getModel());
        this.__info.setValue(tihamon.ui.taskmgr.Fmt.esc(res.msg || "Tamam."));
      } catch (e) {
        tihamon.ui.Dialog.error(e);
      }
    },

    // overridden
    update(m) {
      const st = m.startup;
      if (!st) {
        return;
      }
      const F = tihamon.ui.taskmgr.Fmt;
      const q = this._win.getFilter();
      this.__info.setValue(st.user
        ? `Ayarlar tahtada oturum açmış <b>${F.esc(st.user)}</b> kullanıcısı için geçerlidir. ${st.items.filter(i => i.enabled).length} etkin / ${st.items.length}`
        : "Tahtada oturum açık değil: liste görüntülenir, değişiklik oturum açılınca yapılabilir.");
      this.__enable.setEnabled(!!st.user);
      this.__disable.setEnabled(!!st.user);
      const rows = st.items.filter(i => !q || i.name.toLowerCase().includes(q) || (i.publisher || "").toLowerCase().includes(q))
        .map(i => [i.id, i.name, i.publisher || "—", i.enabled ? "Etkin" : "Devre dışı", "Ölçülmedi", i.exec, i.comment]);
      this._setRows(this.__table, rows);
    }
  }
});
