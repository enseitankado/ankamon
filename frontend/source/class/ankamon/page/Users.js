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
 * Kullanıcılar (Sistem altında), iki sekme (kullanıcı isteği):
 *  - "Hesaplar" (yalnız yönetici): hesaplar ve hangi özellikleri kullanabilecekleri.
 *  - "Oturumlar" ('logins' yetkisi): Ankamon oturum geçmişi — bkz. ui.users.LoginSessions.
 * Sayfa 'logins' yetkisi olan yönetici olmayan kullanıcıya da açıktır (yalnız Oturumlar sekmesiyle; bkz. Shell.PAGES).
 */
qx.Class.define("ankamon.page.Users", {
  extend: ankamon.page.Base,

  construct(user) {
    // Başlık yok: sekme adları yeterli (bkz. page.Sessions).
    super(user, null);
    this._actions.exclude();
    this.__tabs = new qx.ui.tabview.TabView();

    if (user.is_admin) {
      // "Hesaplar" (kullanıcı isteği; eski adı "Kullanıcılar" — kimlik "users" kalır, kayıtlı sekme tercihi bozulmasın).
      const tab = new qx.ui.tabview.Page("Hesaplar").set({ layout: new qx.ui.layout.VBox(8), padding: 8 });
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
      this.__logins = new ankamon.ui.users.LoginSessions(this);
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
        { id: "role", label: "Rol", width: 100, choices: true },
        { id: "active", label: "Durum", width: 90, choices: true },
        { id: "features", label: "Yetkiler" },
        { id: "login", label: "Son giriş", width: 130 }
      ], { prefsKey: "users.columns", filterable: true });
      // Satıra çift tıklama = Düzenle (Cihazlar'daki gibi).
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
        ankamon.io.Api.get("/users"),
        this.__features ? { features: this.__features } : ankamon.io.Api.get("/features")
      ]);
      this.__features = features.features;
      const labels = new Map(this.__features.map(feature => [feature.key, feature.label]));
      this.__users = new Map(users.users.map(user => [user.id, user]));
      this.__table.getTableModel().setData(users.users.map(user => [
        user.id, user.username, user.full_name,
        user.is_admin ? "Yönetici" : "Kullanıcı",
        user.is_active ? "Etkin" : "Kapalı",
        user.is_admin ? "Tümü" : user.features.map(key => labels.get(key) || key).join(", "),
        ankamon.util.Format.ago(user.last_login_at)
      ]));
    },

    __withSelected(handler) {
      const ids = this._selectedIds(this.__table);
      if (ids.length !== 1) {
        ankamon.ui.Dialog.alert("Önce listeden bir kullanıcı seçin.");
        return;
      }
      handler(this.__users.get(ids[0]));
    },

    __edit(target) {
      const isNew = !target;
      // Yeni kullanıcının varsayılan yetkileri (kullanıcı isteği): açma/kapatma/yeniden başlatma ve ekran
      // yansıtma işaretli; Sensörler (metrics) işaretsiz.
      target = target || { is_active: true, features: ["dashboard", "devices", "logs", "power", "cast"] };
      // Geniş: özellik etiketleri uzun (bkz. backend/config/features.php); liste aşağıda boyuna göre büyür.
      const rootBounds = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
      const win = ankamon.ui.Dialog.window(isNew ? "Kullanıcı ekle" : "Kullanıcıyı düzenle: " + target.username,
        Math.min(900, rootBounds.width - 40));
      const form = new ankamon.ui.Form();
      if (isNew) {
        form.text("username", "Kullanıcı adı");
      }
      form.text("full_name", "Ad soyad", target.full_name);
      form.password("password", "Parola", isNew ? "en az 8 karakter" : "değiştirmek için yazın");
      win.add(form);

      // etapadmin her şeye yetkilidir ve kapatılamaz.
      let picker = null;
      let active = null;
      if (!target.is_admin) {
        active = new qx.ui.form.CheckBox("Hesap etkin").set({ value: target.is_active });
        win.add(active);
        // Hazır roller + konu gruplarına ayrılmış, katlanır yetki listesi; bağımlılıklar (feature.parent) orada
        // korunur — bkz. ui.users.FeatureRolePicker (kullanıcı isteği 2026-11-23).
        picker = new ankamon.ui.users.FeatureRolePicker(this.__features, target.features);
        win.add(picker.getRoleBar());
        win.add(new qx.ui.basic.Label("Kullanabileceği özellikler").set({ font: "bold" }));
        const list = picker.getList();
        // Liste tamamı (bütün gruplar açık) görünecek yükseklikte (kullanıcı isteği); pencere ekrana sığmazsa — kalan
        // yer kadar — kaydırılır. Scroll kendiliğinden içeriği kadar büyümez ve uzun etiketler satır kaydırdığından
        // boyut ipucu gerçek boyu vermez: pencere göründükten sonra listenin GERÇEK yüksekliği ölçülüp uygulanır;
        // seçimi olmayan gruplar ölçümden SONRA katlanır (açıldıklarında pencere boyu oynamasın).
        const scroll = new qx.ui.container.Scroll(list).set({ height: 200 });
        win.addListenerOnce("appear", () => qx.event.Timer.once(() => {
          const listHeight = (list.getBounds() || {}).height || 0;
          const winHeight = (win.getBounds() || {}).height || 0;
          const rest = winHeight - ((scroll.getBounds() || {}).height || 0); // form + düğmeler + çerçeve
          scroll.setHeight(Math.max(160, Math.min(listHeight + 4, rootBounds.height - 24 - rest)));
          picker.collapseEmptyGroups();
          qx.ui.core.queue.Manager.flush();
          win.center();
        }, this, 0));
        win.addListener("close", () => picker.dispose());
        win.add(scroll, { flex: 1 });
      }

      const cancel = new qx.ui.form.Button("Vazgeç");
      const save = new qx.ui.form.Button("Kaydet");
      cancel.addListener("execute", () => win.close());
      save.addListener("execute", async () => {
        const values = form.values();
        if (!target.is_admin) {
          values.is_active = active.getValue();
          values.features = picker.getSelected();
        }
        try {
          if (isNew) {
            await ankamon.io.Api.post("/users", values);
          } else {
            await ankamon.io.Api.patch("/users/" + target.id, values);
          }
          win.close();
          this.refresh();
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
      });
      ankamon.ui.Dialog.buttons(win, [cancel, save]);
      // ESC'de onay (bkz. ui.WindowEscClose): rol/grup düğmeleri yetkileri toplu değiştirdiğinden yalnız dokunulan
      // alanlara bakan varsayılan denetim yetmez — form, "Hesap etkin" ve yetki seçimi açılıştakiyle karşılaştırılır.
      const snapshot = () => JSON.stringify([form.values(), active && active.getValue(), picker && picker.getSelected()]);
      const initial = snapshot();
      win.setUserData("escDirty", () => (picker && picker.isDisposed() ? false : snapshot() !== initial));
      win.open();
    },

    async __delete(target) {
      const sure = await ankamon.ui.Dialog.confirm(`<b>${qx.bom.String.escape(target.username)}</b> hesabı silinsin mi?`, "Sil");
      if (sure) {
        await ankamon.io.Api.del("/users/" + target.id).catch(e => ankamon.ui.Dialog.error(e));
        this.refresh();
      }
    }
  }
});
