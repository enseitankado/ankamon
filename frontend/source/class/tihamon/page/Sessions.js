/**
 * Oturumlar: tahtalarda greeter (lightdm) ile oturum açan gerçek kullanıcıların açma/kapama
 * kayıtları — worker/tihamon/tasks/board_sessions.py'nin logs'tan çıkardığı veri (bkz.
 * db/migrations/007_board_sessions.sql) — ve Tiha-Mon üzerinden tahtalara açılan web terminal
 * oturumları (kullanıcı adı orada Tiha-Mon kullanıcısıdır — bkz. db/migrations/011_webshell_sessions.sql).
 * Tiha-Mon'un kendi arayüz kullanıcılarıyla (page.Users, sol menüdeki "Kullanıcılar") KARIŞTIRILMASIN
 * diye ağaçta "Oturumlar" adıyla ayrı bir yaprak — bkz. ui.Shell.PAGES.
 *
 * İki sekme, tek veri: sayfa /board-sessions'ı kısa aralıkla çeker ve iki sekmeye de verir.
 *  - "Oturumlar" (ui.sessions.List): tüm kayıtların süzülebilir grid'i.
 *  - "Kullanıcılar" (ui.sessions.Users): kullanıcı/tahta bazında zaman çizelgesi ve özet. Grid'de
 *    sağ tık → "Oturum geçmişi" buraya, o kullanıcı seçili olarak geçer (showUserHistory).
 *
 * Oturum kapanışı her zaman güvenilir biçimde loglanmaz (elektrik kesintisi, fiziksel güç
 * düğmesiyle zorla kapatma, çok hızlı "Kapat"); bkz. util.Format.SESSION_END_REASON ve worker
 * tarafındaki ayrıntılı gerekçe.
 */
qx.Class.define("tihamon.page.Sessions", {
  extend: tihamon.page.Base,

  construct(user) {
    // Başlık yok (kullanıcı isteği): ilk sekmenin adı zaten "Oturumlar"; Yenile de sekmenin içinde.
    super(user, null);
    this._actions.exclude();

    this.__tabs = new qx.ui.tabview.TabView();
    this.__list = new tihamon.ui.sessions.List(this);
    this.__users = new tihamon.ui.sessions.Users(this);
    this.__tabs.add(this.__list);
    this.__tabs.add(this.__users);
    this._rememberTab(this.__tabs, "sessions"); // son seçili sekme (bkz. Base._rememberTab)
    this.add(this.__tabs, { flex: 1 });

    // Oturum açma/kapama worker'da "anında" (hızlı döngü) işlendiğinden, sayfa da kısa aralıkla
    // kendiliğinden tazelenir — bkz. page.Boards'taki aynı desen.
    this.__timer = new qx.event.Timer(tihamon.page.Sessions.REFRESH_MS);
    this.__timer.addListener("interval", this.refresh, this);
    this.__timer.start();
  },

  statics: {
    REFRESH_MS: 10000
  },

  destruct() {
    if (this.__timer) {
      this.__timer.stop();
      this.__timer.dispose();
    }
  },

  members: {
    __timer: null,
    __tabs: null,
    __list: null,
    __users: null,

    async _refresh() {
      const data = await tihamon.io.Api.get("/board-sessions");
      this.__list.setData(data.sessions);
      this.__users.setData(data.sessions);
    },

    /** Kullanıcılar sekmesine geçip o kullanıcının oturum geçmişini gösterir (grid sağ menüsü). */
    showUserHistory(username, kind) {
      this.__tabs.setSelection([this.__users]);
      this.__users.showUser(username, kind);
    }
  }
});
