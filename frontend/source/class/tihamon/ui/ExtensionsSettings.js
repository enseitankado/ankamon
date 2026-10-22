/**
 * Ayarlar ▸ Eklentiler sekmesinin gövdesi: yüklü eklentileri (GET /extensions) listeler; ayar şeması
 * bildiren her eklenti için şema-güdümlü bir form (tihamon.ui.Form) ve kendi "Kaydet" düğmesi üretir
 * (PUT /extensions/settings {name, values}). Şema action.json "params" biçimindedir (type: text |
 * number | select | password | checkbox). Çekirdek hiçbir eklentiyi adıyla bilmez; her şey sunucudan gelir.
 */
qx.Class.define("tihamon.ui.ExtensionsSettings", {
  extend: qx.ui.container.Composite,

  construct() {
    super(new qx.ui.layout.VBox(12));
    this._load();
  },

  members: {
    async _load() {
      this.removeAll().forEach(widget => widget.dispose());
      let extensions;
      try {
        extensions = (await tihamon.io.Api.get("/extensions")).extensions || [];
      } catch (e) {
        tihamon.ui.Dialog.error(e);
        return;
      }
      if (!extensions.length) {
        this.add(new qx.ui.basic.Label(
          "Yüklü eklenti yok. Eklentiler sunucuda <code>ext/&lt;ad&gt;/</code> altına kurulur " +
          "(bkz. ext/README.md); kurulumdan sonra burada listelenir."
        ).set({ rich: true, wrap: true, textColor: "app-muted" }));
        return;
      }
      extensions.forEach(ext => this.add(this.__section(ext)));
    },

    /** Tek eklenti bölümü: başlık + sürüm + açıklama + (varsa) form ve Kaydet. */
    __section(ext) {
      const esc = v => qx.bom.String.escape(String(v == null ? "" : v));
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(8)).set({
        padding: 16, maxWidth: 620, backgroundColor: "surface",
        decorator: new qx.ui.decoration.Decorator().set({ radius: 8, width: 1, color: "app-border" })
      });
      const head = ext.version ? `${esc(ext.title)}  <span style="opacity:.6">v${esc(ext.version)}</span>` : esc(ext.title);
      box.add(new qx.ui.basic.Label(head).set({ rich: true, font: "bold" }));
      if (ext.description) {
        box.add(new qx.ui.basic.Label(esc(ext.description)).set({ rich: true, wrap: true, textColor: "app-muted" }));
      }
      if (!ext.settings || !ext.settings.length) {
        box.add(new qx.ui.basic.Label("Bu eklentinin ayarı yok.").set({ textColor: "app-muted" }));
        return box;
      }

      const form = this.__buildForm(ext);
      box.add(form);
      const save = new qx.ui.form.Button("Kaydet").set({ allowGrowX: false });
      save.addListener("execute", async () => {
        try {
          await tihamon.io.Api.put("/extensions/settings", { name: ext.name, values: form.values() });
          tihamon.ui.Dialog.alert("Eklenti ayarları kaydedildi.");
          this._load(); // parolaları yeniden maskeleyip saklı değerleri tazeler
        } catch (e) {
          tihamon.ui.Dialog.error(e);
        }
      });
      box.add(save);
      return box;
    },

    /** Şemadan (ext.settings) alanları olan tihamon.ui.Form. Değerler ext.values'tan yüklenir. */
    __buildForm(ext) {
      const form = new tihamon.ui.Form();
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
          form.addField(key, label, field);
        }
      });
      return form;
    }
  }
});
