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
 * Oturumlar sayfasının "Şampiyonlar Ligi" sekmesi: tahtalarda en uzun süre oturum açık tutan kullanıcılar — günün,
 * haftanın, ayın, dönemin ve eğitim-öğretim yılının şampiyonları. Her dönem bir kart: üstte ilk üç kürsüde
 * (altın/gümüş/bronz), altta ilk on yatay çubukla (çubuk boyu liderin süresine göre; lider vurgulu). Tahtanın yönetici
 * ve sistem hesabı (etapadmin, root) sıralamaya girmez. Veri /session-league'den (bkz. backend SessionLeagueApi):
 * oturum kayıtları ya da loglar silinse de korunan ayrı tablodan (session_league_parts) gelir. Sekme göründükçe ve
 * görünürken dakikada bir tazelenir. "Sırala" ile kullanıcılar ya da tahtalar (en uzun süre oturumlu kalan tahtalar)
 * sıralanır. Görev gereği sürekli oturumlu kalan kullanıcı/tahtalar lig dışı bırakılabilir (ui.sessions.LeagueExclusions):
 * varsayılan görünümde sayılmazlar, "Lig dışındakileri de göster" ile soluk ve etiketli katılırlar.
 */
qx.Class.define("ankamon.ui.sessions.ChampionsLeague", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Sessions} yetki denetimi (_can) için */
  construct(page) {
    super("Şampiyonlar Ligi");
    this.setUserData("key", "league"); // sekme kimliği (sol menü yaprağı, hatırlanan sekme — bkz. ui.Shell.PAGES)
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    const refresh = new qx.ui.form.Button("Yenile");
    refresh.addListener("execute", () => this.load());
    bar.add(refresh);
    bar.add(new qx.ui.basic.Label("Sırala:").set({ alignY: "middle", marginLeft: 8 }));
    this.__by = new qx.ui.form.SelectBox().set({ width: 130 });
    [["users", "Kullanıcılar"], ["boards", "Tahtalar"]].forEach(([key, label]) => {
      const item = new qx.ui.form.ListItem(label);
      item.setUserData("key", key);
      this.__by.add(item);
    });
    this.__by.addListener("changeSelection", () => this.load());
    bar.add(this.__by);
    this.__out = ankamon.ui.sessions.LeagueExclusions.toolbar(bar, {
      league: "session", page, kind: () => this.__byKey() === "boards" ? "board" : "user", onChange: () => this.load()
    });
    this.__status = new qx.ui.basic.Label("").set({ textColor: "app-muted", alignY: "middle" });
    bar.add(this.__status, { flex: 1 });
    this.add(bar);

    this.__html = new qx.ui.embed.Html("").set({ overflowY: "auto" });
    this.add(this.__html, { flex: 1 });

    this.addListener("appear", () => this.load());
    this.__timer = new qx.event.Timer(ankamon.ui.sessions.ChampionsLeague.LEAGUE_REFRESH_MS);
    this.__timer.addListener("interval", () => this.isSeeable() && this.load());
    this.__timer.start();
  },

  statics: {
    LEAGUE_REFRESH_MS: 60000,
    // Kürsü renkleri (1., 2., 3.): açık ve koyu temada okunur.
    LEAGUE_MEDALS: ["#e0a800", "#9aa4ae", "#c0793a"],

    /** Lig kartlarının ortak görünümü (kürsü, çubuklar) — Teneffüs Ligi de kullanır (bkz. ui.sessions.BreakLeague). */
    leagueCss(medals) {
      return `
.tm-league{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px;padding:6px;font-size:13px}
.tm-league .lg-card{border:1px solid rgba(127,127,127,.3);border-radius:10px;padding:12px 14px;background:rgba(127,127,127,.06)}
.tm-league .lg-head{margin-bottom:8px}
.tm-league .lg-title{font-size:16px;font-weight:600}
.tm-league .lg-sub{opacity:.65;font-size:12px;margin-top:2px}
.tm-league .lg-empty{opacity:.6;padding:24px 0;text-align:center}
.tm-league .lg-podium{display:flex;justify-content:center;align-items:flex-end;gap:8px;margin:6px 0 12px}
.tm-league .lg-step{flex:0 1 32%;text-align:center;min-width:0}
.tm-league .lg-crown{font-size:22px;line-height:1}
.tm-league .lg-pname{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tm-league .lg-step1 .lg-pname{font-size:14px}
.tm-league .lg-ptime{opacity:.75;font-size:12px;margin-bottom:3px}
.tm-league .lg-block{border-radius:6px 6px 0 0;color:#fff;font-weight:700;font-size:18px;display:flex;align-items:flex-start;justify-content:center;padding-top:4px;text-shadow:0 1px 2px rgba(0,0,0,.35)}
.tm-league .lg-step1 .lg-block{height:64px}
.tm-league .lg-step2 .lg-block{height:44px}
.tm-league .lg-step3 .lg-block{height:30px}
.tm-league .lg-row{display:grid;grid-template-columns:24px minmax(0,40%) 1fr auto;align-items:center;gap:8px;padding:3px 4px;border-radius:6px}
.tm-league .lg-row:hover{background:rgba(127,127,127,.14)}
.tm-league .lg-lead{background:rgba(224,168,0,.16);font-weight:600}
.tm-league .lg-rank{display:inline-flex;width:22px;height:22px;border-radius:50%;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:rgba(127,127,127,.18)}
.tm-league .lg-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tm-league .lg-name small{display:block;opacity:.6;font-weight:400;font-size:11px;overflow:hidden;text-overflow:ellipsis}
.tm-league .lg-track{height:10px;border-radius:5px;background:rgba(127,127,127,.15);overflow:hidden}
.tm-league .lg-bar{display:block;height:100%;border-radius:5px;background:#3b82c4}
.tm-league .lg-lead .lg-bar{background:${medals[0]}}
.tm-league .lg-time{white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right;min-width:74px}
.tm-league .lg-out{opacity:.5}
.tm-league .lg-outtag{display:inline-block;margin-right:5px;padding:0 5px;border-radius:4px;font-size:10px;font-weight:600;vertical-align:middle;border:1px solid rgba(127,127,127,.5)}
.tm-league .lg-foot{opacity:.6;font-size:12px;margin-top:8px;border-top:1px solid rgba(127,127,127,.25);padding-top:6px}
`;
    }
  },

  destruct() {
    this.__timer.stop();
    this.__timer.dispose();
  },

  members: {
    __status: null,
    __html: null,
    __by: null,
    __out: null,
    __timer: null,
    __loading: false,
    __reloadAfter: false,

    async load() {
      if (this.__loading) {
        this.__reloadAfter = true; // süren yükleme bitince seçimlerin son haliyle bir kez daha
        return;
      }
      this.__loading = true;
      this.__reloadAfter = false;
      try {
        const by = this.__byKey();
        const data = await ankamon.io.Api.get(`/session-league?by=${by}` + (this.__out.withExcluded() ? "&with_excluded=1" : ""));
        this.__out.setInfo(data.excluded);
        this.__renderLeague(data.periods || [], by === "boards");
        this.__status.setValue("Tahtalarda açık kalınan toplam oturum süresine göre · etapadmin ve root sayılmaz · " +
          "güncelleme: " + new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }));
      } catch (e) {
        this.__status.setValue("Yüklenemedi: " + (e.message || e));
      } finally {
        this.__loading = false;
        if (this.__reloadAfter) {
          this.load();
        }
      }
    },

    __byKey() {
      const item = this.__by.getSelection()[0];
      return item ? item.getUserData("key") : "users";
    },

    /** "2026-11-02" → "2 Kas 2026" */
    __leagueDate(ymd) {
      const [y, m, d] = ymd.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
    },

    /** Dönemin [from, to) aralığı okunur biçimde (to hariç olduğundan son gün bir önceki gündür). */
    __leagueRange(p) {
      const [y, m, d] = p.to.split("-").map(Number);
      const last = new Date(y, m - 1, d - 1);
      const lastYmd = `${last.getFullYear()}-${last.getMonth() + 1}-${last.getDate()}`;
      return p.from === p.to || this.__leagueDate(p.from) === this.__leagueDate(lastYmd)
        ? this.__leagueDate(p.from) : `${this.__leagueDate(p.from)} – ${this.__leagueDate(lastYmd)}`;
    },

    __leaderTip(r, rank, boards) {
      const F = ankamon.util.Format;
      const out = r.excluded ? "\n(lig dışı)" : "";
      if (boards) {
        return `${rank}. ${r.board}` + (r.board !== r.host ? ` (${r.host})` : "") +
          `\nToplam: ${F.duration(r.seconds)}\n${r.days} gün · ${r.sessions} oturum · ${r.users} kullanıcı` +
          (r.top_user ? `\nEn çok kullanan: ${r.top_user}` : "") + out;
      }
      return `${rank}. ${r.full_name || r.username}` + (r.full_name ? ` (${r.username})` : "") +
        `\nToplam: ${F.duration(r.seconds)}\n${r.days} gün · ${r.sessions} oturum · ${r.boards} tahta` +
        (r.board ? `\nEn çok kullandığı tahta: ${r.board}` : "") + out;
    },

    /** Kart altı: dönemde süresi olan lig dışı sayısı (gizliyse "sayılmadı", gösteriliyorsa "dahil"). */
    leagueOutNote(p, shown) {
      return p.excluded_count ? ` · ${p.excluded_count} lig dışı ${shown ? "dahil" : "sayılmadı"}` : "";
    },

    __renderLeague(periods, boards) {
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const medals = ankamon.ui.sessions.ChampionsLeague.LEAGUE_MEDALS;
      const outTag = r => r.excluded ? `<span class="lg-outtag">lig dışı</span>` : "";
      const name = r => esc(boards ? r.board : (r.full_name || r.username));
      const sub = r => boards ? r.top_user : r.board;
      const shown = this.__out.withExcluded();

      const card = p => {
        const rows = p.leaders || [];
        const head = `<div class="lg-head"><div class="lg-title">${esc(p.title)}</div>` +
          `<div class="lg-sub">${esc(p.label)} · ${esc(this.__leagueRange(p))}</div></div>`;
        if (!rows.length) {
          return `<div class="lg-card">${head}<div class="lg-empty">Bu dönemde henüz oturum yok.` +
            (p.excluded_count ? ` (${p.excluded_count} lig dışı sayılmadı)` : "") + `</div></div>`;
        }
        const top = rows[0].seconds || 1;
        // Kürsü: 2. solda, 1. ortada (en yüksek), 3. sağda.
        const podium = [1, 0, 2].filter(i => rows[i]).map(i => {
          const r = rows[i];
          return `<div class="lg-step lg-step${i + 1}${r.excluded ? " lg-out" : ""}" title="${esc(this.__leaderTip(r, i + 1, boards))}">` +
            (i === 0 ? `<div class="lg-crown">🏆</div>` : "") +
            `<div class="lg-pname">${name(r)}</div><div class="lg-ptime">${esc(F.duration(r.seconds))}</div>` +
            `<div class="lg-block" style="background:${medals[i]}">${i + 1}</div></div>`;
        }).join("");
        const bars = rows.map((r, i) =>
          `<div class="lg-row${i === 0 ? " lg-lead" : ""}${r.excluded ? " lg-out" : ""}" title="${esc(this.__leaderTip(r, i + 1, boards))}">` +
          `<span class="lg-rank" ${i < 3 ? `style="background:${medals[i]};color:#fff"` : ""}>${i + 1}</span>` +
          `<span class="lg-name">${name(r)}${sub(r) || r.excluded ? `<small>${outTag(r)}${esc(sub(r) || "")}</small>` : ""}</span>` +
          `<span class="lg-track"><span class="lg-bar" style="width:${Math.max(2, r.seconds / top * 100).toFixed(1)}%"></span></span>` +
          `<span class="lg-time">${esc(F.duration(r.seconds))}</span></div>`).join("");
        const foot = `<div class="lg-foot">${p.participants} ${boards ? "tahta" : "kullanıcı"} · toplam ${esc(F.duration(p.total_seconds))}` +
          (p.participants > rows.length ? ` · ilk ${rows.length} gösteriliyor` : "") + this.leagueOutNote(p, shown) + `</div>`;
        return `<div class="lg-card">${head}<div class="lg-podium">${podium}</div><div class="lg-bars">${bars}</div>${foot}</div>`;
      };

      this.__html.setHtml(
        `<style>${ankamon.ui.sessions.ChampionsLeague.leagueCss(medals)}</style><div class="tm-league">${periods.map(card).join("")}</div>`);
    }
  }
});
