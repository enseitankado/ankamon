/**
 * Küçültülebilir pencereler ve onları geri getiren şerit (kullanıcı isteği): bir "bağlam" (ör. Tahtalar ▸
 * Ekranlar sekmesi, bkz. page.Boards) GÖRÜNÜRKEN açılan her pencereye simge durumuna küçültme düğmesi eklenir.
 * qooxdoo'da küçültülen pencere yalnız gizlenir (görev çubuğu yoktur); bu yüzden küçültülen pencereler alt
 * çubukta (bkz. ui.StatusBar) başlıklarıyla düğme olarak durur, tıklanınca geri açılır. Kalıcı (modal)
 * pencere küçültülünce arkasındaki engel de kalkar (qx kökü yalnız görünür modal pencereyi sayar).
 *
 * Yeni pencereler kökün "changeActiveWindow" olayından yakalanır (Window.open() pencereyi etkinleştirir) —
 * pencereleri açan kodlara (Dialog.window, BoardOps, Jobs…) tek tek dokunmak gerekmez.
 */
qx.Class.define("tihamon.ui.WindowDock", {
  extend: qx.ui.container.Composite,

  statics: {
    __contexts: [],

    /** Görünürken açılan pencereleri küçültülebilir yapacak bağlamı (widget) kaydeder. */
    addContext(widget) {
      this.__contexts.push(widget);
    },

    /** Kayıtlı bağlamlardan biri şu an görünür mü. */
    inContext() {
      return this.__contexts.some(w => !w.isDisposed() && w.isSeeable());
    }
  },

  construct() {
    super(new qx.ui.layout.HBox(4).set({ alignY: "middle" }));
    this.__buttons = new Map();
    const root = qx.core.Init.getApplication().getRoot();
    root.addListener("changeActiveWindow", e => {
      const win = e.getData();
      if (win && !win.getUserData("tihamon.dock") && tihamon.ui.WindowDock.inContext()) {
        this.__adopt(win);
      }
    });
  },

  members: {
    __buttons: null,

    /** Pencereye küçültme düğmesi ekler; küçültülünce şeride, geri açılınca/kapanınca şeritten. */
    __adopt(win) {
      win.setUserData("tihamon.dock", true);
      win.set({ showMinimize: true, allowMinimize: true });
      win.addListener("minimize", () => this.__add(win));
      win.addListener("appear", () => this.__remove(win));
      win.addListener("close", () => this.__remove(win));
    },

    __add(win) {
      if (this.__buttons.has(win)) {
        return;
      }
      const caption = String(win.getCaption() || "Pencere");
      const button = new qx.ui.form.Button("▣ " + (caption.length > 32 ? caption.slice(0, 31) + "…" : caption)).set({
        toolTipText: caption + " — geri açmak için tıklayın", padding: [0, 6], allowGrowY: false, maxHeight: 20
      });
      button.addListener("execute", () => win.restore()); // gizliyse açar, eski konumuna koyar
      this.__buttons.set(win, button);
      this.add(button);
    },

    __remove(win) {
      const button = this.__buttons.get(win);
      if (button) {
        this.__buttons.delete(win);
        button.destroy();
      }
    }
  }
});
