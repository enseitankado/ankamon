/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Ligler (sol menüde kökte; kullanıcı isteği 2026-11-06 — eskiden Oturumlar sayfasının sekmeleriydi):
 *  - "Kullanım sıralaması" (ui.sessions.ChampionsLeague; eski adı "Şampiyonlar Ligi", sekme kimliği "league"):
 *    tahtalarda en uzun süre oturum açık tutan kullanıcılar.
 *  - "Ders arası sıralaması" (ui.sessions.BreakLeague; eski adı "Teneffüs Ligi", kimliği "breakLeague"): ders aralarında
 *    açık kalan tahtalar.
 * İkisi de kendi verisini çeker (/session-league, /break-league). Eski {page: "sessions", tab: "league"|"breakLeague"}
 * bağlantıları ui.Shell.__openPage'de buraya yönlenir. Yetki Oturumlar'la aynı ("logs").
 */
qx.Class.define("ankamon.page.Leagues", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, null);
    this._actions.exclude();
    this.__tabs = new qx.ui.tabview.TabView();
    this.__tabs.add(new ankamon.ui.sessions.ChampionsLeague(this));
    this.__tabs.add(new ankamon.ui.sessions.BreakLeague(this));
    this._rememberTab(this.__tabs, "leagues");
    this.add(this.__tabs, { flex: 1 });
  },

  members: {
    __tabs: null,

    async _refresh() {
      // Sekmeler kendi verisini kendisi çeker (bkz. o sınıflar).
    }
  }
});
