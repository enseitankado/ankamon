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
 * Ayarlar ▸ Eklentiler sekmesinin gövdesi: yüklü eklentileri (GET /extensions) KATLANIR bölümler olarak listeler
 * (kullanıcı isteği 2026-11-12: bölümler alt alta uzayıp sayfayı dikeyde kaplıyordu). Bölüm başlığına tıklayınca açılır/
 * kapanır; açık bölümler kullanıcı başına hatırlanır (ui_prefs "settings.extOpen"). Ayar şeması bildiren her eklenti
 * için şema-güdümlü bir form (ankamon.ui.Form) ve kendi "Kaydet" düğmesi üretir (PUT /extensions/settings {name,
 * values}). Şema action.json "params" biçimindedir (type: text | number | select | password | checkbox). Eklenti
 * ankamon.ext.Extensions.addSettingsTab ile bölümüne ek sekme koyabilir (ör. veri yönetimi): o zaman bölüm sekmelidir,
 * ilk sekme "Ayarlar" (form). Çekirdek hiçbir eklentiyi adıyla bilmez; her şey sunucudan ve kancalardan gelir.
 */
qx.Class.define("ankamon.ui.ExtensionsSettings", {
  extend: qx.ui.container.Composite,

  /** @param user {Map?} oturumdaki kullanıcı (açık bölümleri hatırlamak için; yoksa hatırlanmaz) */
  construct(user) {
    super(new qx.ui.layout.Grow());
    this.__user = user || null;
    this.__list = new qx.ui.container.Composite(new qx.ui.layout.VBox(8)).set({ paddingRight: 8 });
    this.add(new qx.ui.container.Scroll(this.__list));
    // Her görünüşte yeniden yüklenir: değerler ve "settings.extensionHidden" kancasının kararı (eklentinin
    // kendi durumuna bağlı olabilir) güncel olsun.
    this.addListener("appear", this._load, this);
  },

  statics: {
    /** Açık bölümlerin tercih anahtarı (eklenti adları dizisi). */
    PREF_OPEN: "settings.extOpen"
  },

  members: {
    __user: null,
    __list: null,

    async _load() {
      this.__list.removeAll().forEach(widget => widget.dispose());
      let extensions;
      try {
        extensions = (await ankamon.io.Api.get("/extensions")).extensions || [];
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      if (!extensions.length) {
        this.__list.add(new qx.ui.basic.Label(
          "Yüklü eklenti yok. Eklentiler sunucuda <code>ext/&lt;ad&gt;/</code> altına kurulur " +
          "(bkz. ext/README.md); kurulumdan sonra burada listelenir."
        ).set({ rich: true, wrap: true, textColor: "app-muted" }));
        return;
      }
      // Bir eklenti kendi bölümünü gizleyebilir (kanca "settings.extensionHidden", bkz. ankamon.ext.Extensions).
      extensions = extensions.filter(ext => !ankamon.ext.Extensions.handle("settings.extensionHidden", ext.name));
      if (!extensions.length) {
        this.__list.add(new qx.ui.basic.Label("Gösterilecek eklenti ayarı yok.").set({ textColor: "app-muted" }));
        return;
      }
      this.__list.add(new qx.ui.basic.Label("Ayrıntılarını görmek ya da ayarlamak için eklentinin başlığına tıklayın.")
        .set({ textColor: "app-muted" }));
      extensions.forEach(ext => this.__list.add(this.__section(ext)));
    },

    __openSet() {
      const saved = this.__user && (this.__user.ui_prefs || {})[ankamon.ui.ExtensionsSettings.PREF_OPEN];
      return new Set(Array.isArray(saved) ? saved : []);
    },

    __remember(name, open) {
      if (!this.__user) {
        return;
      }
      const set = this.__openSet();
      if (open) {
        set.add(name);
      } else {
        set.delete(name);
      }
      ankamon.page.Base.savePref(this.__user, ankamon.ui.ExtensionsSettings.PREF_OPEN, set.size ? Array.from(set) : null);
    },

    /** Tek eklenti bölümü: tıklanır başlık (▸/▾ + ad + sürüm + durum) + katlanır gövde (açıklama, form/sekmeler). */
    __section(ext) {
      const esc = v => qx.bom.String.escape(String(v == null ? "" : v));
      const tabs = ankamon.ext.Extensions.settingsTabs(ext.name);
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(8)).set({
        padding: [10, 16], maxWidth: 660, backgroundColor: "surface",
        decorator: new qx.ui.decoration.Decorator().set({ radius: 8, width: 1, color: "app-border" })
      });

      const hasEnabled = (ext.settings || []).some(p => p.key === "enabled");
      const on = hasEnabled && ext.values && (ext.values.enabled === true || ext.values.enabled === "1" || ext.values.enabled === "true");
      const state = hasEnabled
        ? ` <span style="font-weight:normal;font-size:11px;padding:1px 7px;border-radius:9px;margin-left:6px;` +
          `background:${on ? "rgba(46,139,46,.18)" : "rgba(128,128,128,.18)"}">${on ? "Etkin" : "Kapalı"}</span>` : "";
      const version = ext.version ? `  <span style="opacity:.6;font-weight:normal">v${esc(ext.version)}</span>` : "";
      const arrow = new qx.ui.basic.Label("▸").set({ width: 14, textColor: "app-muted" });
      const title = new qx.ui.basic.Label(esc(ext.title) + version + state).set({ rich: true, font: "bold" });
      const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" })).set({ cursor: "pointer" });
      head.add(arrow);
      head.add(title, { flex: 1 });
      head.setToolTipText("Aç / kapat");
      box.add(head);

      const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(8)).set({ visibility: "excluded" });
      box.add(body, { flex: 1 });
      let built = false;
      const setOpen = (open, remember) => {
        if (open && !built) {
          built = true;
          this.__fillBody(body, ext, tabs);
        }
        body.setVisibility(open ? "visible" : "excluded");
        // Ek sekmeli (geniş içerikli) bölüm yalnız açıkken genişler; kapalı başlıklar aynı hizada durur.
        box.setMaxWidth(open && tabs.length ? 1100 : 660);
        arrow.setValue(open ? "▾" : "▸");
        if (remember) {
          this.__remember(ext.name, open);
        }
      };
      head.addListener("tap", () => setOpen(body.getVisibility() !== "visible", true));
      if (this.__openSet().has(ext.name)) {
        setOpen(true, false);
      }
      return box;
    },

    /** Bölüm gövdesi (ilk açılışta bir kez kurulur): açıklama + form ya da sekmeler. */
    __fillBody(body, ext, tabs) {
      const esc = v => qx.bom.String.escape(String(v == null ? "" : v));
      if (ext.description) {
        body.add(new qx.ui.basic.Label(esc(ext.description)).set({ rich: true, wrap: true, textColor: "app-muted", maxWidth: 1060 }));
      }
      const settingsPane = this.__settingsPane(ext);
      if (!tabs.length) {
        body.add(settingsPane);
        return;
      }
      const view = new qx.ui.tabview.TabView().set({ contentPadding: [10, 4, 4, 4] });
      const first = new qx.ui.tabview.Page("Ayarlar");
      first.setLayout(new qx.ui.layout.VBox(8));
      first.add(settingsPane);
      view.add(first);
      tabs.forEach(spec => {
        const page = new qx.ui.tabview.Page(spec.label);
        page.setLayout(new qx.ui.layout.Grow());
        page.setUserData("key", spec.key);
        // İçerik ilk seçilişte kurulur: açılmayan sekme sunucuya istek atmaz.
        page.addListenerOnce("appear", () => {
          try {
            page.add(spec.create());
          } catch (e) {
            page.add(new qx.ui.basic.Label("Sekme kurulamadı: " + esc(e && e.message)).set({ rich: true }));
          }
        });
        view.add(page);
      });
      body.add(view, { flex: 1 });
    },

    /** Şema formu + Kaydet (şeması yoksa bilgi satırı). */
    __settingsPane(ext) {
      const pane = new qx.ui.container.Composite(new qx.ui.layout.VBox(8)).set({ maxWidth: 620 });
      if (!ext.settings || !ext.settings.length) {
        pane.add(new qx.ui.basic.Label("Bu eklentinin ayarı yok.").set({ textColor: "app-muted" }));
        return pane;
      }
      const form = this.__buildForm(ext);
      pane.add(form);
      const save = new qx.ui.form.Button("Kaydet").set({ allowGrowX: false });
      save.addListener("execute", async () => {
        try {
          await ankamon.io.Api.put("/extensions/settings", { name: ext.name, values: form.values() });
          ankamon.ui.Dialog.alert("Eklenti ayarları kaydedildi.");
          this._load(); // parolaları yeniden maskeleyip saklı değerleri tazeler
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
      });
      pane.add(save);
      return pane;
    },

    /** Şemadan (ext.settings) alanları olan ankamon.ui.Form. Değerler ext.values'tan yüklenir. */
    __buildForm(ext) {
      const form = new ankamon.ui.Form();
      ext.settings.forEach(param => {
        const key = param.key;
        const label = param.label || key;
        const value = ext.values ? ext.values[key] : undefined;
        const type = param.type || "text";
        if (type === "select") {
          const options = (param.options || []).map(o => ({ value: o.value, label: o.label }));
          form.select(key, label, options, value != null ? value : param.default);
        } else if (type === "checkbox") {
          form.check(key, label, value === true || value === "1" || value === "true");
        } else if (type === "password") {
          const field = new qx.ui.form.PasswordField().set({
            placeholder: value === "***" ? "kayıtlı — değiştirmek için yazın" : (param.placeholder || "")
          });
          if (value === "***") {
            field.setValue("***"); // dokunulmazsa sunucu mevcut parolayı korur
          }
          form.addField(key, label, field);
        } else { // text, number (sayı denetimi sunucuda)
          const field = new qx.ui.form.TextField(value != null ? String(value) : "").set({
            placeholder: param.placeholder || ""
          });
          if (param.default_from) {
            // Sunucu boş ayarı çekirdek ayarından doldurur (ExtensionsApi default_from); aynı değer kalırsa izlemeyi sürdürür.
            field.setToolTipText("Ayarlar ▸ Kuruluş'tan otomatik dolar; değiştirmezseniz oradaki değişikliği izler.");
          }
          form.addField(key, label, field);
        }
      });
      return form;
    }
  }
});
