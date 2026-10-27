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
 * Oturumlar: tahtalarda greeter (lightdm) ile oturum açan gerçek kullanıcıların açma/kapama
 * kayıtları — worker/ankamon/tasks/board_sessions.py'nin logs'tan çıkardığı veri (bkz.
 * db/migrations/007_board_sessions.sql) — ve Ankamon üzerinden tahtalara açılan web terminal
 * oturumları (kullanıcı adı orada Ankamon kullanıcısıdır — bkz. db/migrations/011_webshell_sessions.sql).
 * Ankamon'un kendi arayüz kullanıcılarıyla (page.Users, sol menüdeki "Kullanıcılar") KARIŞTIRILMASIN
 * diye ağaçta "Oturumlar" adıyla ayrı bir yaprak — bkz. ui.Shell.PAGES.
 *
 * İki sekme, tek veri: sayfa /board-sessions'ı kısa aralıkla çeker ve iki sekmeye de verir.
 *  - "Oturumlar" (ui.sessions.List): tüm kayıtların süzülebilir grid'i.
 *  - "Zaman çizelgesi" (ui.sessions.Users): kullanıcı/tahta bazında zaman çizelgesi ve özet. Grid'de
 *    sağ tık → "Oturum geçmişi" buraya, o kullanıcı seçili olarak geçer (showUserHistory).
 *
 * Oturum kapanışı her zaman güvenilir biçimde loglanmaz (elektrik kesintisi, fiziksel güç
 * düğmesiyle zorla kapatma, çok hızlı "Kapat"); bkz. util.Format.SESSION_END_REASON ve worker
 * tarafındaki ayrıntılı gerekçe.
 */
qx.Class.define("ankamon.page.Sessions", {
  extend: ankamon.page.Base,

  construct(user) {
    // Başlık yok (kullanıcı isteği): ilk sekmenin adı zaten "Oturumlar"; Yenile de sekmenin içinde.
    super(user, null);
    this._actions.exclude();

    this.__tabs = new qx.ui.tabview.TabView();
    this.__list = new ankamon.ui.sessions.List(this);
    this.__users = new ankamon.ui.sessions.Users(this);
    this.__tabs.add(this.__list);
    this.__tabs.add(this.__users);
    this._rememberTab(this.__tabs, "sessions"); // son seçili sekme (bkz. Base._rememberTab)
    this.add(this.__tabs, { flex: 1 });

    // Oturum açma/kapama worker'da "anında" (hızlı döngü) işlendiğinden, sayfa da kısa aralıkla
    // kendiliğinden tazelenir — bkz. page.Boards'taki aynı desen.
    this.__timer = new qx.event.Timer(ankamon.page.Sessions.REFRESH_MS);
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
      const data = await ankamon.io.Api.get("/board-sessions");
      this.__list.setData(data.sessions);
      this.__users.setData(data.sessions);
    },

    /**
     * Shell.OPEN_PAGE {page: "sessions", board: {id, name}} — Tahtalar/Ekranlar sağ menüsü "Oturum geçmişi":
     * Kullanıcılar sekmesi (zaman çizelgesi) o tahtaya süzülmüş açılır (kullanıcı isteği).
     */
    openWith(data) {
      if (data && data.board) {
        this.__tabs.setSelection([this.__users]);
        this.__users.showBoard(data.board);
      }
    },

    /** Kullanıcılar sekmesine geçip o kullanıcının oturum geçmişini gösterir (grid sağ menüsü). */
    showUserHistory(username, kind) {
      this.__tabs.setSelection([this.__users]);
      this.__users.showUser(username, kind);
    }
  }
});
