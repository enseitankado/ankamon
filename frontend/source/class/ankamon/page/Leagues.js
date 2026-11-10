/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Ligler (sol menüde Ağ'ın altında):
 *  - "Kullanım sıralaması" (ui.sessions.ChampionsLeague; eski adı "Şampiyonlar Ligi"): tahtalarda en uzun süre oturum
 *    açık tutan kullanıcılar / tahtalar.
 *  - "Teneffüsler" (ui.sessions.BreakLeague; eski adları "Teneffüs Ligi", "Ders arası sıralaması"): ders aralarında açık
 *    kalan tahtalar / bunu yapan kullanıcılar.
 * Her sıralama kullanıcılar ve bilgisayarlar için ayrı sekme (kullanıcı isteği 2026-11-10: sayfadaki "Kullanıcılar /
 * Tahtalar" seçim listesi kalktı; sol menüde Ligler ▸ <sıralama> ▸ Kullanıcılar / Bilgisayarlar — bkz. TABS, ui.Shell
 * tab.group). Sekme kimlikleri eski tek sekmenin varsayılanını korur ("league" = kullanıcılar, "breakLeague" =
 * bilgisayarlar): hatırlanan sekme ve eski {page: "sessions", tab: "league"|"breakLeague"} bağlantıları
 * (ui.Shell.__openPage) çalışmaya devam eder. Yetki Oturumlar'la aynı ("logs").
 */
qx.Class.define("ankamon.page.Leagues", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, null);
    this._actions.exclude();
    this.__tabs = new qx.ui.tabview.TabView();
    ankamon.page.Leagues.TABS.forEach(tab => {
      const league = tab.league === "session"
        ? new ankamon.ui.sessions.ChampionsLeague(this, tab.by)
        : new ankamon.ui.sessions.BreakLeague(this, tab.by);
      league.setLabel(`${tab.group}: ${tab.label}`);
      league.setUserData("key", tab.key);
      this.__tabs.add(league);
    });
    this._rememberTab(this.__tabs, "leagues");
    this.add(this.__tabs, { flex: 1 });
  },

  statics: {
    /** Sekmeler (sol menü yaprakları da — bkz. ui.Shell PAGES "leagues"); group = sol menüdeki ara düğüm. */
    TABS: [
      { key: "league", league: "session", by: "users", group: "Kullanım sıralaması", label: "Kullanıcılar" },
      { key: "league.boards", league: "session", by: "boards", group: "Kullanım sıralaması", label: "Bilgisayarlar" },
      { key: "breakLeague.users", league: "break", by: "users", group: "Teneffüsler", label: "Kullanıcılar" },
      { key: "breakLeague", league: "break", by: "boards", group: "Teneffüsler", label: "Bilgisayarlar" }
    ]
  },

  members: {
    __tabs: null,

    async _refresh() {
      // Sekmeler kendi verisini kendisi çeker (bkz. o sınıflar).
    }
  }
});
