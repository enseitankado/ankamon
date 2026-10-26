/** Giriş ekranı. Başarılı girişte "login" olayı yayınlar. */
qx.Class.define("ankamon.ui.Login", {
  extend: qx.ui.container.Composite,

  events: {
    login: "qx.event.type.Event"
  },

  construct() {
    super(new qx.ui.layout.VBox().set({ alignX: "center", alignY: "middle" }));
    this.setBackgroundColor("app-background");

    const card = new qx.ui.container.Composite(new qx.ui.layout.VBox(12)).set({
      width: 370,
      allowGrowX: false,
      allowGrowY: false,
      padding: 28,
      backgroundColor: "surface",
      decorator: new qx.ui.decoration.Decorator().set({ radius: 10, width: 1, color: "app-border" })
    });

    card.add(new qx.ui.basic.Label("Ankamon").set({ font: "headline", textColor: "primary" }));
    card.add(new qx.ui.basic.Label("Akıllı tahta izleme ve yönetim merkezi").set({ textColor: "app-muted" }));
    // Oturum açmadan görülen durum satırı: çevrim içi / çevrim dışı tahta ve son otomatik taramalarda
    // acil sorunlu tahta sayısı (yalnız sayılar — bkz. backend LoginStatusApi).
    this.__status = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true, visibility: "excluded" });
    card.add(this.__status);

    this.__username = new qx.ui.form.TextField().set({ placeholder: "Kullanıcı adı" });
    this.__password = new qx.ui.form.PasswordField().set({ placeholder: "Parola" });
    this.__message = new qx.ui.basic.Label("").set({ textColor: "error", rich: true, wrap: true, visibility: "excluded" });
    this.__button = new qx.ui.form.Button("Giriş yap");

    card.add(this.__username);
    card.add(this.__password);
    card.add(this.__message);
    card.add(this.__button);
    this.add(card);

    this.__button.addListener("execute", this.__submit, this);
    [this.__username, this.__password].forEach(field => {
      field.addListener("keypress", e => {
        if (e.getKeyIdentifier() === "Enter") {
          this.__submit();
        }
      });
    });
    this.addListenerOnce("appear", () => this.__username.focus());
    // Giriş ekranı açık kaldıkça dakikada bir tazelenir.
    this.__timer = new qx.event.Timer(60000);
    this.__timer.addListener("interval", this.__loadStatus, this);
    this.addListener("appear", () => {
      this.__loadStatus();
      this.__timer.start();
    });
    this.addListener("disappear", () => this.__timer.stop());
  },

  destruct() {
    this._disposeObjects("__timer");
  },

  statics: {
    /** Durum maddelerinin simgeleri (24×24 çizgi SVG, rengi kutunun currentColor'ından). */
    ICON: {
      online: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M8.5 10l2.5 2.5 4.5-5"/>',
      offline: '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
      urgent: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".6" fill="currentColor"/>',
      ok: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'
    },

    /**
     * Giriş ekranı durum maddesi (alt alta, belirgin): renkli zeminde simge + büyük sayı + açıklama,
     * isteğe bağlı küçük alt satır. count null ise sayı gösterilmez (ör. "Acil sorun yok"). Renkler yarı saydam zemin + temadan gelen yazı rengiyle açık/koyu
     * temalarda okunur kalır.
     */
    statusItem(color, icon, count, label, sub, title) {
      const esc = qx.bom.String.escape;
      return `<div title="${esc(title)}" style="display:flex;align-items:center;gap:12px;padding:8px 12px;` +
        `margin:0 0 8px;border-radius:8px;background:${color}14;border:1px solid ${color}40">` +
        `<span style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;` +
        `height:34px;border-radius:8px;background:${color};color:#fff">` +
        `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
        `stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span>` +
        `<span style="line-height:1.25">` +
        (count === null ? "" : `<b style="font-size:20px;color:${color};margin-right:6px">${count}</b>`) +
        `<span style="font-size:14px${count === null ? `;font-weight:bold;color:${color}` : ""}">${esc(label)}</span>` +
        (sub ? `<br><span style="font-size:11px;opacity:.7">${esc(sub)}</span>` : "") +
        "</span></div>";
    }
  },

  members: {
    __username: null,
    __password: null,
    __message: null,
    __button: null,
    __status: null,
    __timer: null,

    async __loadStatus() {
      let d;
      try {
        d = await ankamon.io.Api.get("/login-status");
      } catch (e) {
        this.__status.exclude(); // durum satırı girişi engellemez; sunucu yanıt vermezse gizlenir
        return;
      }
      const S = ankamon.ui.Login;
      const when = d.scanned_at ? "son otomatik tarama: " + ankamon.util.Format.dateTime(d.scanned_at * 1000) : "";
      const urgent = d.urgent > 0;
      this.__status.setValue(
        S.statusItem("#1e8e3e", S.ICON.online, d.online, "tahta çevrim içi", "", "Şu an açık ve yanıt veren tahtalar") +
        S.statusItem("#80868b", S.ICON.offline, d.offline, "tahta çevrim dışı", "", "Kapalı ya da yanıt vermeyen tahtalar") +
        S.statusItem(urgent ? "#d93025" : "#1e8e3e", urgent ? S.ICON.urgent : S.ICON.ok, urgent ? d.urgent : null,
          urgent ? "tahtada acil sorun" : "Acil sorun yok", when,
          "Son otomatik sorun tespiti taramasında acil sorun bulunan tahta sayısı")
      );
      this.__status.show();
    },

    async __submit() {
      this.__button.setEnabled(false);
      this.__message.exclude();
      try {
        await ankamon.io.Api.post("/auth/login", {
          username: this.__username.getValue() || "",
          password: this.__password.getValue() || ""
        });
        this.fireEvent("login");
      } catch (e) {
        this.__message.setValue(qx.bom.String.escape(e.message));
        this.__message.show();
        this.__password.setValue("");
        this.__password.focus();
      } finally {
        this.__button.setEnabled(true);
      }
    }
  }
});
