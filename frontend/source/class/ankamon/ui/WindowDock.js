/**
 * Küçültülebilir pencereler ve onları geri getiren şerit (kullanıcı isteği): Ankamon'da açılan HER pencere
 * (web terminal, dosya yöneticisi, ekran, komut çıktısı, formlar, onay soruları — eklentilerinkiler dahil)
 * simge durumuna küçültülebilir ve kalıcı (modal) değildir: önde dururken arkadaki sayfa, menüler ve öteki
 * pencereler kullanılabilir.
 * qooxdoo'da küçültülen pencere yalnız gizlenir (görev çubuğu yoktur); bu yüzden küçültülen pencereler alt
 * çubukta (bkz. ui.StatusBar) başlıklarıyla düğme olarak durur, tıklanınca geri açılır (büyütülmüş açılan
 * pencere yine büyütülmüş).
 *
 * Yeni pencereler kökün "changeActiveWindow" olayından yakalanır (Window.open() pencereyi etkinleştirir) —
 * pencereleri açan kodlara (Dialog.window, BoardOps, Jobs…) tek tek dokunmak gerekmez.
 *
 * İçinde iframe olan pencereler (terminal, dosya yöneticisi, ekran): iframe'e tıklama olayı qooxdoo'ya
 * ulaşmaz, pencere öne gelmezdi; kipsiz pencereler üst üste binebildiğinden iframe'e tıklanınca da
 * pencere etkinleştirilir (__watchIframes).
 */
qx.Class.define("ankamon.ui.WindowDock", {
  extend: qx.ui.container.Composite,

  construct() {
    super(new qx.ui.layout.HBox(4).set({ alignY: "middle" }));
    this.__buttons = new Map();
    const root = qx.core.Init.getApplication().getRoot();
    root.addListener("changeActiveWindow", e => {
      const win = e.getData();
      if (win && !win.getUserData("ankamon.dock")) {
        this.__adopt(win);
      }
    });
    // Odak bir iframe'e geçince (içine tıklandı) ana belge "blur" alır; odaktaki iframe'in penceresi öne.
    // Kaynağı başka köken olan ya da iç içe çerçevelerde de çalışır (bkz. __watchIframes — aynı kökende
    // iframe'ler arası geçişte ana belge ikinci kez blur almaz, onu oradaki dinleyici karşılar).
    window.addEventListener("blur", () => setTimeout(() => {
      const el = document.activeElement;
      if (el && el.tagName === "IFRAME") {
        this.__activateFor(el);
      }
    }, 0));
  },

  members: {
    __buttons: null,

    /** Pencereye küçültme düğmesi ekler, kipliliği kaldırır; küçültülünce şeride, geri açılınca/kapanınca şeritten. */
    __adopt(win) {
      win.setUserData("ankamon.dock", true);
      win.set({ showMinimize: true, allowMinimize: true, modal: false });
      // qx minimize() büyütülmüş durumu atar (restore() normal boyuta, 0,0'a döner): geri açarken yeniden büyütülür.
      win.addListener("beforeMinimize", () => win.setUserData("ankamon.dock.maximized", win.isMaximized()));
      win.addListener("minimize", () => this.__add(win));
      win.addListener("appear", () => {
        this.__remove(win);
        this.__watchIframes(win);
      });
      win.addListener("close", () => this.__remove(win));
      if (win.isSeeable()) {
        this.__watchIframes(win);
      }
    },

    __add(win) {
      if (this.__buttons.has(win)) {
        return;
      }
      const caption = String(win.getCaption() || "Pencere");
      const button = new qx.ui.form.Button("▣ " + (caption.length > 32 ? caption.slice(0, 31) + "…" : caption)).set({
        toolTipText: caption + " — geri açmak için tıklayın", padding: [0, 6], allowGrowY: false, maxHeight: 20
      });
      button.addListener("execute", () => {
        win.restore(); // gizliyse açar, eski konumuna koyar
        if (win.getUserData("ankamon.dock.maximized")) {
          win.maximize();
        }
      });
      this.__buttons.set(win, button);
      this.add(button);
    },

    __remove(win) {
      const button = this.__buttons.get(win);
      if (button) {
        this.__buttons.delete(win);
        button.destroy();
      }
    },

    /**
     * Penceredeki (aynı kökenli) iframe'lerin belgesine tıklanınca pencereyi etkinleştirir. Belge her
     * yüklemede yenilendiğinden dinleyici "load"da yeniden eklenir; başka kökenli belgelere erişilemez
     * (onları kurucudaki "blur" dinleyicisi karşılar).
     */
    __watchIframes(win) {
      const el = win.getContentElement().getDomElement();
      if (!el) {
        return;
      }
      el.querySelectorAll("iframe").forEach(frame => {
        if (frame.__ankamonDock) {
          return;
        }
        frame.__ankamonDock = true;
        const hook = () => {
          try {
            frame.contentWindow.document.addEventListener("pointerdown", () => this.__activateFor(frame), true);
          } catch (e) {
            // başka kökenli belge — "blur" yolu yeter
          }
        };
        frame.addEventListener("load", hook);
        hook();
      });
    },

    /** Bir DOM öğesini (iframe) içeren qx penceresini etkinleştirir (öne getirir; odağı iframe'den almaz). */
    __activateFor(el) {
      let widget = qx.ui.core.Widget.getWidgetByElement(el);
      while (widget && !(widget instanceof qx.ui.window.Window)) {
        widget = widget.getLayoutParent();
      }
      if (widget && !widget.isActive()) {
        widget.setActive(true);
      }
    }
  }
});
