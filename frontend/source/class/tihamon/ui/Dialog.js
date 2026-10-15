/** Kalıcı pencereler: bilgi, hata, onay ve form pencereleri için ortak yardımcılar. */
qx.Class.define("tihamon.ui.Dialog", {
  type: "static",

  statics: {
    /**
     * Ortalanmış, kalıcı (modal) boş pencere açar.
     * @param opts {Map?} {maximizable: true} verilirse pencere büyüt düğmesi kazanır (kullanıcı
     *   elle büyütmedikçe GENE normal/ortalı boyutta açılır — yalnız büyütme İMKANI eklenir).
     *   Varsayılan (verilmezse) önceki davranış: büyütülemez, sabit boyutlu pencere.
     */
    window(caption, width, opts = {}) {
      const win = new qx.ui.window.Window(caption).set({
        modal: true,
        showMinimize: false,
        showMaximize: !!opts.maximizable,
        allowMaximize: !!opts.maximizable,
        width: width || 420,
        contentPadding: 16,
        layout: new qx.ui.layout.VBox(12)
      });
      // destroy ertelenir: "close" olayında hemen destroy edilirse pencerenin dinleyicileri atılır ve
      // SONRA eklenen "close" dinleyicileri (ör. confirm()'in Promise'i çözen dinleyicisi) hiç
      // çalışmaz — onay penceresi kapanıyor ama arkasındaki işlem (log silme vb.) hiç başlamıyordu.
      win.addListener("close", () => qx.event.Timer.once(() => win.destroy(), null, 0));
      win.addListenerOnce("appear", () => win.center());
      qx.core.Init.getApplication().getRoot().add(win);
      return win;
    },

    /** Pencerenin altına sağa yaslı düğme sırası ekler. */
    buttons(win, buttons) {
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8, "right"));
      buttons.forEach(button => row.add(button));
      win.add(row);
      return row;
    },

    alert(message, caption, opts) {
      const win = this.window(caption || "Bilgi", undefined, opts);
      win.add(new qx.ui.basic.Label(message).set({ rich: true, wrap: true, selectable: true }));
      const ok = new qx.ui.form.Button("Tamam");
      ok.addListener("execute", () => win.close());
      this.buttons(win, [ok]);
      win.open();
    },

    error(error) {
      this.alert(qx.bom.String.escape(error && error.message ? error.message : String(error)), "Hata");
    },

    /**
     * Tek satırlık metin ister (ad değiştirme, yeni klasör adı…).
     * @return {Promise<String|null>} girilen (kırpılmış) metin; vazgeçilir ya da boş bırakılırsa null
     */
    prompt(message, value, okLabel, caption) {
      return new Promise(resolve => {
        const win = this.window(caption || "Gir", 420);
        let answer = null;
        win.add(new qx.ui.basic.Label(message).set({ rich: true, wrap: true }));
        const field = new qx.ui.form.TextField(value || "");
        win.add(field);
        const cancel = new qx.ui.form.Button("Vazgeç");
        const ok = new qx.ui.form.Button(okLabel || "Tamam");
        const accept = () => {
          answer = field.getValue() ? field.getValue().trim() || null : null;
          win.close();
        };
        cancel.addListener("execute", () => win.close());
        ok.addListener("execute", accept);
        field.addListener("keypress", e => {
          if (e.getKeyIdentifier() === "Enter") {
            accept();
          }
        });
        win.addListener("close", () => resolve(answer));
        this.buttons(win, [cancel, ok]);
        win.open();
        win.addListenerOnce("appear", () => {
          field.focus();
          field.selectAllText();
        });
      });
    },

    /** @return {Promise<Boolean>} */
    confirm(message, okLabel, opts) {
      return new Promise(resolve => {
        const win = this.window("Onay", undefined, opts);
        let answer = false;
        win.add(new qx.ui.basic.Label(message).set({ rich: true, wrap: true }));
        const cancel = new qx.ui.form.Button("Vazgeç");
        const ok = new qx.ui.form.Button(okLabel || "Evet");
        cancel.addListener("execute", () => win.close());
        ok.addListener("execute", () => {
          answer = true;
          win.close();
        });
        win.addListener("close", () => resolve(answer));
        this.buttons(win, [cancel, ok]);
        win.open();
      });
    }
  }
});
