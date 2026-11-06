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
 * Oturumlar sayfasının "Teneffüs Ligi" sekmesi: ders aralarında (teneffüsler ve öğle arası — Ayarlar ▸ Ders saatleri'ndeki
 * ardışık dersler arası) en çok açık kalan tahtalar; günün, haftanın, ayın, dönemin ve eğitim-öğretim yılının sıralaması
 * (Şampiyonlar Ligi'nin tahta karşılığı — bkz. ui.sessions.ChampionsLeague, görünümü ortak). Açık kalınan süre ikiye
 * ayrılır: oturum AÇIKKEN (turuncu) ve oturum KAPALIYKEN, giriş ekranında (mavi); çubuk ikisinin toplamı. Sıralama ölçütü
 * seçilebilir (toplam / oturum açık / oturum kapalı). Veri /break-league'den (bkz. backend BreakLeagueApi). Sekme
 * göründükçe ve görünürken dakikada bir tazelenir. Görev gereği sürekli açık kalan tahtalar lig dışı bırakılabilir
 * (ui.sessions.LeagueExclusions): varsayılan görünümde sayılmazlar, "Lig dışındakileri de göster" ile katılırlar;
 * tahta satırına sağ tıklayınca "Lig dışı bırak" / "Lige geri al".
 *
 * "Bazında: Bilgisayar / Kullanıcı adı": aynı üç ölçü (oturum açıkken / kapalıyken / toplam) kullanıcı adı bazında da
 * sıralanır (/break-league?by=users). Kullanıcı bazında oturum kapalı süre, tahtayı o açılışta oturumunu en son kapatıp
 * giriş ekranında açık bırakan kullanıcıya yazılır; açılıştan beri kimse oturum açmadıysa kimseye yazılmaz (kart
 * altında ayrıca gösterilir). etapadmin/root sayılmaz; kullanıcı lig dışı listesi tahta listesinden ayrıdır.
 */
qx.Class.define("ankamon.ui.sessions.BreakLeague", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Sessions} yetki denetimi (_can) için */
  construct(page) {
    super("Teneffüs Ligi");
    this.setUserData("key", "breakLeague"); // sekme kimliği (sol menü yaprağı — bkz. ui.Shell.PAGES)
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    const refresh = new qx.ui.form.Button("Yenile");
    refresh.addListener("execute", () => this.load());
    bar.add(refresh);
    // Bilgisayar (tahta) ya da kullanıcı adı bazında: üç ölçü (oturum açık / kapalı / toplam) ikisinde de.
    bar.add(new qx.ui.basic.Label("Bazında:").set({ alignY: "middle", marginLeft: 8 }));
    this.__by = new qx.ui.form.SelectBox().set({ width: 140 });
    ankamon.ui.sessions.BreakLeague.BREAK_BY.forEach(([key, label]) => {
      const item = new qx.ui.form.ListItem(label);
      item.setUserData("key", key);
      this.__by.add(item);
    });
    this.__by.addListener("changeSelection", () => {
      this.__updateLegend();
      this.load();
    });
    bar.add(this.__by);
    bar.add(new qx.ui.basic.Label("Sırala:").set({ alignY: "middle", marginLeft: 8 }));
    this.__sort = new qx.ui.form.SelectBox().set({ width: 330 });
    ankamon.ui.sessions.BreakLeague.BREAK_SORTS.forEach(([key, label]) => {
      const item = new qx.ui.form.ListItem(label);
      item.setUserData("key", key);
      this.__sort.add(item);
    });
    this.__sort.addListener("changeSelection", () => this.load());
    bar.add(this.__sort);
    this.__out = ankamon.ui.sessions.LeagueExclusions.toolbar(bar, {
      league: "break", page, kind: () => this.__byKey() === "users" ? "user" : "board", onChange: () => this.load()
    });
    this.__legend = new qx.ui.basic.Label("").set({ rich: true, alignY: "middle", marginLeft: 8 });
    this.__updateLegend();
    bar.add(this.__legend);
    this.__status = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    this.add(bar);
    this.add(this.__status); // teneffüs listesi uzun: düğme satırına sığmayınca satırı uzatıyordu

    this.__html = new qx.ui.embed.Html("").set({ overflowY: "auto" });
    this.add(this.__html, { flex: 1 });
    // Tahta satırlarına sağ tık: "Lig dışı bırak" / "Lige geri al" (bkz. LeagueExclusions.attachRowMenu).
    ankamon.ui.sessions.LeagueExclusions.attachRowMenu(this.__html, { league: "break", page, onChange: () => this.load() });

    this.addListener("appear", () => this.load());
    this.__timer = new qx.event.Timer(ankamon.ui.sessions.ChampionsLeague.LEAGUE_REFRESH_MS);
    this.__timer.addListener("interval", () => this.isSeeable() && this.load());
    this.__timer.start();
  },

  statics: {
    BREAK_SORTS: [
      ["total", "Teneffüste açık kaldığı süre (toplam)"],
      ["session", "Teneffüste oturumu açıkken geçen süre"],
      ["nosession", "Teneffüste oturumu kapalı iken geçen süre"]
    ],
    BREAK_BY: [
      ["boards", "Bilgisayar"],
      ["users", "Kullanıcı adı"]
    ],
    BREAK_COLORS: { session: "#e8833a", idle: "#3b82c4" },
    BREAK_LIST_LIMIT: 10 // API'nin varsayılan limit'i (bkz. BreakLeagueApi)
  },

  destruct() {
    this.__timer.stop();
    this.__timer.dispose();
  },

  members: {
    __by: null,
    __legend: null,
    __sort: null,
    __out: null,
    __status: null,
    __html: null,
    __timer: null,
    __loading: false,
    __reloadAfter: false,

    /** "boards" (bilgisayar/tahta bazında) | "users" (kullanıcı adı bazında). */
    __byKey() {
      const item = this.__by.getSelection()[0];
      return item ? item.getUserData("key") : "boards";
    },

    /** Renk açıklaması; kullanıcı bazında mavi kısım kullanıcının giriş ekranında açık bıraktığı süredir. */
    __updateLegend() {
      const C = ankamon.ui.sessions.BreakLeague.BREAK_COLORS;
      const dot = c => `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${c};vertical-align:middle"></span>`;
      const users = this.__byKey() === "users";
      this.__legend.setValue(`${dot(C.session)} oturum açık &nbsp; ${dot(C.idle)} ` +
        (users ? "oturum kapalı (çıkışta açık bıraktığı)" : "oturum kapalı (giriş ekranı)"));
      this.__legend.setToolTipText(users
        ? "Kullanıcı bazında: oturum açık = teneffüste kullanıcının kendi oturumu. Oturum kapalı = tahta giriş " +
          "ekranında açık kalırken, tahtanın o açılışında oturumu en son kapatan kullanıcıya yazılan süre (tahtayı " +
          "kapatmadan çıkan). Açıldığından beri kimsenin oturum açmadığı tahtanın süresi kimseye yazılmaz. " +
          "etapadmin ve root sayılmaz."
        : null);
    },

    __sortKey() {
      const item = this.__sort.getSelection()[0];
      return item ? item.getUserData("key") : "total";
    },

    async load() {
      if (this.__loading) {
        this.__reloadAfter = true; // süren yükleme bitince seçimlerin son haliyle bir kez daha
        return;
      }
      this.__loading = true;
      this.__reloadAfter = false;
      try {
        const sort = this.__sortKey();
        const by = this.__byKey();
        const data = await ankamon.io.Api.get("/break-league?sort=" + encodeURIComponent(sort) + "&by=" + by +
          (this.__out.withExcluded() ? "&with_excluded=1" : ""));
        this.__out.setInfo(data.excluded);
        const breaks = data.breaks || [];
        if (!breaks.length) {
          this.__html.setHtml('<div style="padding:24px;opacity:.75">Ders saatleri tanımlı olmadığından teneffüsler ' +
            "bilinmiyor. Ayarlar ▸ Ders saatleri'nden derslerin başlangıç/bitiş saatlerini girin; ardışık dersler " +
            "arasındaki boşluklar (teneffüsler, öğle arası) burada sayılır.</div>");
        } else {
          this.__renderBreakLeague(data.periods || [], sort, data.boards || 0, data.by === "users");
        }
        this.__status.setValue(`Teneffüsler: ${qx.bom.String.escape(breaks.join(", ") || "—")} · güncelleme: ` +
          new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }));
      } catch (e) {
        this.__status.setValue("Yüklenemedi: " + qx.bom.String.escape(String(e.message || e)));
      } finally {
        this.__loading = false;
        if (this.__reloadAfter) {
          this.load();
        }
      }
    },

    /** Sıralama ölçütünün değeri. */
    __metric(r, sort) {
      return sort === "session" ? r.session_seconds : sort === "nosession" ? r.idle_seconds : r.seconds;
    },

    __breakTip(r, rank, users) {
      const F = ankamon.util.Format;
      if (users) {
        return `${rank}. ${r.full_name || r.username}` + (r.full_name ? ` (${r.username})` : "") +
          `\nTeneffüste: ${F.duration(r.seconds)}` +
          `\n  oturumu açıkken: ${F.duration(r.session_seconds)}` +
          `\n  oturumu kapattıktan sonra tahtayı açık bıraktığı: ${F.duration(r.idle_seconds)}` +
          `\n${r.days} gün · ${r.boards} tahta` + (r.board ? `\nEn çok: ${r.board}` : "") + (r.excluded ? "\n(lig dışı)" : "");
      }
      const share = r.break_seconds ? Math.round(r.seconds / r.break_seconds * 100) : 0;
      return `${rank}. ${r.board}` + (r.board !== r.host ? ` (${r.host})` : "") +
        `\nTeneffüste açık: ${F.duration(r.seconds)} (teneffüs payı %${share})` +
        `\n  oturum açıkken: ${F.duration(r.session_seconds)}\n  oturum kapalıyken: ${F.duration(r.idle_seconds)}` +
        `\n${r.days} gün` + (r.excluded ? "\n(lig dışı)" : "");
    },

    /**
     * Kartlar; users: kullanıcı adı bazında (satır = kullanıcı, alt satırda gün/tahta sayısı ve en çok süre biriktirdiği
     * tahta; mavi kısım oturumunu kapatıp tahtayı açık bıraktığı süre). Görsel dil iki kipte aynı.
     */
    __renderBreakLeague(periods, sort, boardCount, users) {
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const League = ankamon.ui.sessions.ChampionsLeague;
      const medals = League.LEAGUE_MEDALS;
      const C = ankamon.ui.sessions.BreakLeague.BREAK_COLORS;
      const outTag = r => r.excluded ? `<span class="lg-outtag">lig dışı</span>` : "";
      const out = r => r.excluded ? " lg-out" : "";
      const name = r => users ? (r.full_name || r.username) : r.board;
      const menuAttrs = r => users
        ? ankamon.ui.sessions.LeagueExclusions.rowAttrs("user", r.username, name(r), r.excluded)
        : ankamon.ui.sessions.LeagueExclusions.rowAttrs("board", r.host, r.board, r.excluded);
      // "%24'ü/%51'i" ekleri sayıya göre değişir (ses uyumu): eksiz yazılır.
      const sub = r => users
        ? `${r.days} gün · ${r.boards} tahta` + (r.board ? ` · en çok ${r.board}` : "")
        : `${r.days} gün · teneffüs payı %${r.break_seconds ? Math.round(r.seconds / r.break_seconds * 100) : 0}`;
      const tip = (r, rank) => this.__breakTip(r, rank, users);
      // Tarih biçimleri Şampiyonlar Ligi ile aynı (ortak yardımcı yok: o sınıfın üyeleri; küçük kopya).
      const date = ymd => {
        const [y, m, d] = ymd.split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
      };
      const range = p => {
        const [y, m, d] = p.to.split("-").map(Number);
        const last = new Date(y, m - 1, d - 1);
        const lastYmd = `${last.getFullYear()}-${last.getMonth() + 1}-${last.getDate()}`;
        return date(p.from) === date(lastYmd) ? date(p.from) : `${date(p.from)} – ${date(lastYmd)}`;
      };

      const card = p => {
        const rows = p.leaders || [];
        const head = `<div class="lg-head"><div class="lg-title">${esc(p.title)}</div>` +
          `<div class="lg-sub">${esc(p.label)} · ${esc(range(p))}</div></div>`;
        if (!rows.length) {
          return `<div class="lg-card">${head}<div class="lg-empty">` +
            (users ? "Bu dönemde teneffüste süresi olan kullanıcı yok." : "Bu dönemde teneffüste açık kalan tahta yok.") +
            (p.excluded_count ? ` (${p.excluded_count} lig dışı sayılmadı)` : "") + `</div></div>`;
        }
        const scale = Math.max(...rows.map(r => r.seconds), 1);
        const podium = [1, 0, 2].filter(i => rows[i]).map(i => {
          const r = rows[i];
          return `<div class="lg-step lg-step${i + 1}${out(r)}"${menuAttrs(r)} title="${esc(tip(r, i + 1))}">` +
            (i === 0 ? `<div class="lg-crown">🏆</div>` : "") +
            `<div class="lg-pname">${esc(name(r))}</div><div class="lg-ptime">${esc(F.duration(this.__metric(r, sort)))}</div>` +
            `<div class="lg-block" style="background:${medals[i]}">${i + 1}</div></div>`;
        }).join("");
        const bars = rows.map((r, i) =>
          `<div class="lg-row${i === 0 ? " lg-lead" : ""}${out(r)}"${menuAttrs(r)} title="${esc(tip(r, i + 1))}">` +
          `<span class="lg-rank" ${i < 3 ? `style="background:${medals[i]};color:#fff"` : ""}>${i + 1}</span>` +
          `<span class="lg-name">${esc(name(r))}<small>${outTag(r)}${esc(sub(r))}</small></span>` +
          `<span class="lg-track bl-track">` +
          `<span class="bl-seg" style="width:${(r.session_seconds / scale * 100).toFixed(1)}%;background:${C.session}"></span>` +
          `<span class="bl-seg" style="width:${(r.idle_seconds / scale * 100).toFixed(1)}%;background:${C.idle}"></span></span>` +
          `<span class="lg-time">${esc(F.duration(this.__metric(r, sort)))}</span></div>`).join("");
        const idle = p.total_seconds - p.total_session_seconds;
        const foot = `<div class="lg-foot">` +
          (users ? `${p.participants} kullanıcı · ` : `${p.participants}${boardCount ? ` / ${boardCount}` : ""} tahta teneffüste açık kaldı · `) +
          `toplam ${esc(F.duration(p.total_seconds))} (oturum açık ${esc(F.duration(p.total_session_seconds))}, ` +
          `kapalı ${esc(F.duration(idle))})` +
          // Kullanıcı bazında: tahta açıldığından beri kimse oturum açmadıysa oturumsuz süre kimseye yazılamaz.
          (users && p.unassigned_idle_seconds
            ? ` · kimseye yazılamayan oturumsuz süre ${esc(F.duration(p.unassigned_idle_seconds))} (açılıştan beri oturum açılmamış)`
            : "") +
          // Liste yalnız sınırda (API limit 10) kesilmiştir; daha kısaysa ölçütte süresi olanların hepsidir.
          (rows.length >= ankamon.ui.sessions.BreakLeague.BREAK_LIST_LIMIT ? ` · ilk ${rows.length} gösteriliyor` : "") +
          (p.excluded_count ? ` · ${p.excluded_count} lig dışı ${this.__out.withExcluded() ? "dahil" : "sayılmadı"}` : "") + `</div>`;
        return `<div class="lg-card">${head}<div class="lg-podium">${podium}</div><div class="lg-bars">${bars}</div>${foot}</div>`;
      };

      this.__html.setHtml(`<style>${League.leagueCss(medals)}
.tm-league .bl-track{display:flex}
.tm-league .bl-seg{display:block;height:100%}
</style><div class="tm-league">${periods.map(card).join("")}</div>`);
    }
  }
});
