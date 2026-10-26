/** Giriş ekranı. Başarılı girişte "login" olayı yayınlar. */
qx.Class.define("ankamon.ui.Login", {
  extend: qx.ui.container.Composite,

  events: {
    login: "qx.event.type.Event"
  },

  construct() {
    super(new qx.ui.layout.HBox(20).set({ alignX: "center", alignY: "middle" }));
    this.setBackgroundColor("app-background");

    const card = new qx.ui.container.Composite(new qx.ui.layout.VBox(12)).set({
      width: 370,
      allowGrowX: false,
      allowGrowY: false,
      padding: 28,
      backgroundColor: "surface",
      decorator: new qx.ui.decoration.Decorator().set({ radius: 10, width: 1, color: "app-border" })
    });

    card.add(new qx.ui.basic.Label(ankamon.ui.Logo.svg(60)).set({ rich: true, textColor: "text", alignX: "center" }));
    card.add(new qx.ui.basic.Label(ankamon.ui.Login.SLOGAN).set({ textColor: "app-muted", alignX: "center" }));
    // Oturum açmadan görülen durum şeridi: çevrim içi / çevrim dışı tahta ve son otomatik taramalarda
    // acil sorunlu tahta sayısı (yalnız sayılar — bkz. backend LoginStatusApi).
    this.__status = new qx.ui.basic.Label("").set({
      rich: true, wrap: true, allowGrowX: true, visibility: "excluded", textColor: "text", marginBottom: 6
    });
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
    /** Giriş ekranındaki slogan (logonun altında). */
    SLOGAN: "Pardus İzleme ve Yönetim Merkezi",

    /** Sorun hücresinin ince çizgi simgeleri (24×24, rengi currentColor'dan). */
    ICON: {
      ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      urgent: '<path d="M12 4.5L3 19.5h18z"/><path d="M12 10.5v4"/><path d="M12 17.2v.1"/>'
    },

    /**
     * Durum şeridinin bir hücresi: üstte küçük renk noktası (ya da ince simge) + sayı, altta soluk küçük
     * açıklama. Yazı temanın rengini alır; renk yalnız nokta/simgede (ve acil sorunda sayıda) — narin
     * görünüm, açık/koyu temalarda okunur.
     */
    statusCell(color, count, label, title, icon) {
      const esc = qx.bom.String.escape;
      const mark = icon
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" ` +
          `stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`
        : `<span style="width:7px;height:7px;border-radius:50%;background:${color};box-shadow:0 0 0 3px ${color}26"></span>`;
      return `<div title="${esc(title)}" style="flex:1 1 0;min-width:0;padding:9px 6px;text-align:center">` +
        `<div style="display:flex;align-items:center;justify-content:center;gap:7px;height:22px">${mark}` +
        (count === null ? "" : `<span style="font-size:19px;font-weight:500;line-height:1;` +
          `font-variant-numeric:tabular-nums${icon ? `;color:${color}` : ""}">${count}</span>`) +
        `</div><div style="font-size:11px;opacity:.6;margin-top:3px;white-space:nowrap">${esc(label)}</div></div>`;
    },

    /** Hücreleri ince çerçeveli tek şeritte, aralarında saç çizgisiyle; altında isteğe bağlı dipnot. */
    statusStrip(cells, note) {
      const line = "rgba(128,128,128,.22)";
      return `<div style="display:flex;border:1px solid ${line};border-radius:10px">` +
        cells.join(`<div style="flex:none;width:1px;margin:10px 0;background:${line}"></div>`) + "</div>" +
        (note ? `<div style="font-size:10.5px;opacity:.5;text-align:center;margin-top:6px">${qx.bom.String.escape(note)}</div>` : "");
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
      this.__status.setValue(S.statusStrip([
        S.statusCell("#1e8e3e", d.online, "çevrim içi tahta", "Şu an açık ve yanıt veren tahtalar"),
        S.statusCell("#9aa0a6", d.offline, "çevrim dışı tahta", "Kapalı ya da yanıt vermeyen tahtalar"),
        S.statusCell(urgent ? "#d93025" : "#1e8e3e", urgent ? d.urgent : null, urgent ? "acil sorunlu tahta" : "acil sorun yok",
          "Son otomatik sorun tespiti taramasında acil sorun bulunan tahta sayısı", urgent ? S.ICON.urgent : S.ICON.ok)
      ], when));
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
