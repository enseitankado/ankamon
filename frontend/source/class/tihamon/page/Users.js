/**
 * Kullanıcılar (Sistem altında), iki sekme (kullanıcı isteği):
 *  - "Kullanıcılar" (yalnız yönetici): hesaplar ve hangi özellikleri kullanabilecekleri.
 *  - "Oturumlar" ('logins' yetkisi): Tiha-Mon oturum geçmişi — bkz. ui.users.LoginSessions.
 * Sayfa 'logins' yetkisi olan yönetici olmayan kullanıcıya da açıktır (yalnız Oturumlar sekmesiyle; bkz. Shell.PAGES).
 */
qx.Class.define("tihamon.page.Users", {
  extend: tihamon.page.Base,

  construct(user) {
    // Başlık yok: sekme adları yeterli (bkz. page.Sessions).
    super(user, null);
    this._actions.exclude();
    this.__tabs = new qx.ui.tabview.TabView();

    if (user.is_admin) {
      const tab = new qx.ui.tabview.Page("Kullanıcılar").set({ layout: new qx.ui.layout.VBox(8), padding: 8 });
      tab.setUserData("key", "users");
      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8));
      [["Yenile", () => this.__loadUsers()],
        ["Ekle", () => this.__edit(null)],
        ["Düzenle", () => this.__withSelected(target => this.__edit(target))],
        ["Sil", () => this.__withSelected(target => this.__delete(target))]].forEach(([label, handler]) => {
        const button = new qx.ui.form.Button(label);
        button.addListener("execute", handler);
        bar.add(button);
      });
      tab.add(bar);
      this.__createUsersTable();
      tab.add(this.__table, { flex: 1 });
      this.__tabs.add(tab);
    }
    if (this._can("logins")) {
      this.__logins = new tihamon.ui.users.LoginSessions(this);
      this.__tabs.add(this.__logins);
    }
    this._rememberTab(this.__tabs, "users"); // son seçili sekme (bkz. Base._rememberTab)
    this.__tabs.addListener("changeSelection", () => this.refresh());
    this.add(this.__tabs, { flex: 1 });
  },

  members: {
    __tabs: null,
    __logins: null,
    __table: null,
    __users: null,
    __features: null,

    /** Yalnız görünen sekmenin verisi okunur. */
    async _refresh() {
      const tab = this.__tabs.getSelection()[0];
      if (tab && tab === this.__logins) {
        await this.__logins.load();
      } else if (this.__table) {
        await this.__loadUsers();
      }
    },

    __createUsersTable() {
      this.__table = this._createTable([
        { id: "username", label: "Kullanıcı adı", width: 160 },
        { id: "full_name", label: "Ad soyad", width: 200 },
        { id: "role", label: "Rol", width: 100 },
        { id: "active", label: "Durum", width: 90 },
        { id: "features", label: "Yetkiler" },
        { id: "login", label: "Son giriş", width: 130 }
      ], { prefsKey: "users.columns" });
      // Satıra çift tıklama = Düzenle (Tahtalar'daki gibi).
      this.__table.addListener("cellDbltap", e => {
        const row = e.getRow();
        const target = row === null ? null : this.__users && this.__users.get(this.__table.getTableModel().getValue(0, row));
        if (target) {
          this.__edit(target);
        }
      });
    },

    async __loadUsers() {
      const [users, features] = await Promise.all([
        tihamon.io.Api.get("/users"),
        this.__features ? { features: this.__features } : tihamon.io.Api.get("/features")
      ]);
      this.__features = features.features;
      const labels = new Map(this.__features.map(feature => [feature.key, feature.label]));
      this.__users = new Map(users.users.map(user => [user.id, user]));
      this.__table.getTableModel().setData(users.users.map(user => [
        user.id, user.username, user.full_name,
        user.is_admin ? "Yönetici" : "Kullanıcı",
        user.is_active ? "Etkin" : "Kapalı",
        user.is_admin ? "Tümü" : user.features.map(key => labels.get(key) || key).join(", "),
        tihamon.util.Format.ago(user.last_login_at)
      ]));
    },

    __withSelected(handler) {
      const ids = this._selectedIds(this.__table);
      if (ids.length !== 1) {
        tihamon.ui.Dialog.alert("Önce listeden bir kullanıcı seçin.");
        return;
      }
      handler(this.__users.get(ids[0]));
    },

    __edit(target) {
      const isNew = !target;
      target = target || { is_active: true, features: ["dashboard", "boards", "logs", "metrics"] };
      const win = tihamon.ui.Dialog.window(isNew ? "Kullanıcı ekle" : "Kullanıcıyı düzenle: " + target.username, 480);
      const form = new tihamon.ui.Form();
      if (isNew) {
        form.text("username", "Kullanıcı adı");
      }
      form.text("full_name", "Ad soyad", target.full_name);
      form.password("password", "Parola", isNew ? "en az 8 karakter" : "değiştirmek için yazın");
      win.add(form);

      // etapadmin her şeye yetkilidir ve kapatılamaz.
      const boxes = [];
      let active = null;
      if (!target.is_admin) {
        active = new qx.ui.form.CheckBox("Hesap etkin").set({ value: target.is_active });
        win.add(active);
        win.add(new qx.ui.basic.Label("Kullanabileceği özellikler").set({ font: "bold" }));
        // Alt özellikler (feature.parent, bkz. backend/config/feature_deps.php) üstlerinin hemen altında
        // girintili; üst kapalıyken işaretsiz ve devre dışı — üstü olmadan arayüzde kullanılamazlar.
        const list = new qx.ui.container.Composite(new qx.ui.layout.VBox(2));
        const byKey = new Map();
        const keys = new Set(this.__features.map(f => f.key));
        const parentOf = f => (f.parent && keys.has(f.parent) ? f.parent : null);
        const children = parent => this.__features.filter(f => parentOf(f) === parent);
        const addTree = (parent, depth) => children(parent).forEach(feature => {
          const box = new qx.ui.form.CheckBox(feature.label).set({
            value: target.features.includes(feature.key), marginLeft: depth * 22, rich: true
          });
          box.setUserData("key", feature.key);
          box.setUserData("parent", parentOf(feature) ? byKey.get(parentOf(feature)) : null);
          byKey.set(feature.key, box);
          boxes.push(box);
          list.add(box);
          addTree(feature.key, depth + 1);
        });
        addTree(null, 0);
        const sync = () => boxes.forEach(box => {
          const parent = box.getUserData("parent");
          const on = !parent || (parent.getValue() && parent.getEnabled());
          box.setEnabled(on);
          if (!on) {
            box.setValue(false);
          }
        });
        // Eski kayıtta alt özellik açık ama üstü kapalıysa üst açılır (sunucu da kaydederken aynısını yapar).
        boxes.slice().reverse().forEach(box => {
          if (box.getValue() && box.getUserData("parent")) {
            box.getUserData("parent").setValue(true);
          }
        });
        boxes.forEach(box => box.addListener("changeValue", sync));
        sync();
        const scroll = new qx.ui.container.Scroll(list).set({ maxHeight: 360 });
        win.add(scroll);
      }

      const cancel = new qx.ui.form.Button("Vazgeç");
      const save = new qx.ui.form.Button("Kaydet");
      cancel.addListener("execute", () => win.close());
      save.addListener("execute", async () => {
        const values = form.values();
        if (!target.is_admin) {
          values.is_active = active.getValue();
          values.features = boxes.filter(box => box.getValue()).map(box => box.getUserData("key"));
        }
        try {
          if (isNew) {
            await tihamon.io.Api.post("/users", values);
          } else {
            await tihamon.io.Api.patch("/users/" + target.id, values);
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

    async __delete(target) {
      const sure = await tihamon.ui.Dialog.confirm(`<b>${qx.bom.String.escape(target.username)}</b> hesabı silinsin mi?`, "Sil");
      if (sure) {
        await tihamon.io.Api.del("/users/" + target.id).catch(e => tihamon.ui.Dialog.error(e));
        this.refresh();
      }
    }
  }
});
