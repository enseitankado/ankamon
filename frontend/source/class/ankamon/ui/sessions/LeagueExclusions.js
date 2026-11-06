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
 * Lig dışı bırakılanlar (Şampiyonlar Ligi ve Teneffüs Ligi ortak): görev gereği sürekli açık / sürekli oturumlu kalan
 * tahtalar ve kullanıcılar listenin başını hep tuttuğundan ligin dışında bırakılabilir. Liste her lig için ayrı tutulur
 * (backend LeagueExclusionsApi, /league-exclusions) ve her zaman düzenlenebilir; veri silinmez. Lig görünümleri
 * varsayılan olarak lig dışılarını saymaz; "Lig dışındakileri de göster" kutusuyla onlar da (soluk ve "lig dışı"
 * etiketli) sıralamaya katılır.
 *
 * toolbar(): lig sekmesinin düğme satırına kutuyu ve (leagues.exclude yetkisiyle) "Lig dışı…" düğmesini ekler.
 * attachRowMenu(): kart satırlarında sağ tık "Lig dışı bırak" / "Lige geri al" (pencerenin kısayolu).
 * open(): seçim penceresi — bu eğitim-öğretim yılında ligde süresi olanlar (yıl toplamı çoktan aza) ve Tahtalar'daki
 * bütün tahtalar onay kutusuyla listelenir; arama kutusu ad/kullanıcı adı/bilgisayar adında arar.
 */
qx.Class.define("ankamon.ui.sessions.LeagueExclusions", {
  type: "static",

  statics: {
    /** Lig (league, kind) → pencere başlığı ve aday türünün adı. */
    LEAGUE_EXCLUSION_TEXTS: {
      "session/user": { title: "Şampiyonlar Ligi — lig dışı kullanıcılar", noun: "kullanıcı" },
      "session/board": { title: "Şampiyonlar Ligi — lig dışı tahtalar", noun: "tahta" },
      "break/board": { title: "Teneffüs Ligi — lig dışı tahtalar", noun: "tahta" },
      "break/user": { title: "Teneffüs Ligi — lig dışı kullanıcılar", noun: "kullanıcı" }
    },

    /**
     * Düğme satırına kontrolleri ekler. opts: league ('session' | 'break'), kind() → 'user' | 'board' (o anki
     * görünüm), onChange() (görünüm yeniden yüklenmeli), page (yetki: _can). Dönen nesnenin withExcluded() o anki
     * kutu değerini, setInfo(excluded) düğme etiketini (dışlanan sayısı) verir.
     */
    toolbar(bar, opts) {
      const check = new qx.ui.form.CheckBox("Lig dışındakileri de göster").set({ alignY: "middle", marginLeft: 8, allowShrinkX: false });
      check.setToolTipText("Lig dışı bırakılan tahta/kullanıcılar varsayılan olarak sıralamaya ve toplamlara girmez; " +
        "işaretlenince onlar da soluk ve \"lig dışı\" etiketiyle katılır.");
      check.addListener("changeValue", () => opts.onChange());
      bar.add(check);
      let button = null;
      if (opts.page && opts.page._can("leagues.exclude")) {
        button = new qx.ui.form.Button("Lig dışı…").set({ alignY: "middle", allowShrinkX: false });
        button.setToolTipText("Görev gereği sürekli açık kalan tahtaları / kullanıcıları ligin dışında bırak " +
          "(her zaman düzenlenebilir; veri silinmez)");
        button.addListener("execute", () =>
          ankamon.ui.sessions.LeagueExclusions.open(opts.league, opts.kind(), opts.onChange));
        bar.add(button);
      }
      return {
        withExcluded: () => check.getValue(),
        setInfo(excluded) {
          if (button) {
            button.setLabel(excluded && excluded.length ? `Lig dışı (${excluded.length})…` : "Lig dışı…");
          }
        }
      };
    },

    /**
     * Lig kartındaki satırın (kürsü basamağı ya da çubuk satırı) sağ menü kimliği: HTML öznitelikleri. attachRowMenu()
     * sağ tıklanan öğeden yukarı çıkarak bu öznitelikleri arar. @param kind {String} 'user' | 'board'
     * @param value {String} kullanıcı adı / tahta host adı (league_exclusions.value) @param name {String} görünen ad
     */
    rowAttrs(kind, value, name, excluded) {
      if (!value) {
        return "";
      }
      const esc = qx.bom.String.escape;
      return ` data-lg-kind="${esc(kind)}" data-lg-value="${esc(String(value))}" data-lg-name="${esc(String(name || value))}"` +
        (excluded ? ' data-lg-out="1"' : "");
    },

    /**
     * Lig kartlarının (qx.ui.embed.Html) sağ tık menüsü: "Lig dışı bırak" ya da — lig dışı satırda ("Lig
     * dışındakileri de göster" açıkken) — "Lige geri al"; ayrıca "Lig dışındakiler…" penceresi. leagues.exclude yetkisi
     * yoksa maddeler pasiftir. opts: league ('session' | 'break'), page (_can), onChange() (lig yeniden yüklenir).
     */
    attachRowMenu(html, opts) {
      const Ex = ankamon.ui.sessions.LeagueExclusions;
      html.addListener("contextmenu", e => {
        const root = html.getContentElement().getDomElement();
        let el = e.getOriginalTarget();
        while (el && el !== root && !(el.getAttribute && el.getAttribute("data-lg-value"))) {
          el = el.parentNode;
        }
        if (!el || el === root || !el.getAttribute) {
          return; // satır dışı: tarayıcının kendi menüsü (metin kopyalama)
        }
        e.preventDefault();
        const kind = el.getAttribute("data-lg-kind");
        const value = el.getAttribute("data-lg-value");
        const name = el.getAttribute("data-lg-name") || value;
        const isOut = el.getAttribute("data-lg-out") === "1";
        const allowed = !!(opts.page && opts.page._can("leagues.exclude"));
        const ops = ankamon.ui.BoardOps;
        const menu = new qx.ui.menu.Menu();
        const toggle = ops.menuButton(isOut ? "↺" : "⊘", isOut ? `Lige geri al: ${name}` : `Lig dışı bırak: ${name}`,
          () => Ex.setExcluded(opts.league, kind, value, !isOut).then(() => opts.onChange(),
            err => ankamon.ui.Dialog.error(err)));
        const manage = ops.menuButton("☰", "Lig dışındakiler…", () => Ex.open(opts.league, kind, opts.onChange));
        if (!allowed) {
          toggle.setEnabled(false);
          manage.setEnabled(false);
          toggle.setToolTipText("Lig dışı bırakma yetkiniz yok (leagues.exclude).");
        }
        menu.add(toggle);
        menu.add(manage);
        menu.addListenerOnce("disappear", () => qx.event.Timer.once(() => menu.destroy(), null, 0));
        menu.openAtPoint({ left: e.getDocumentLeft(), top: e.getDocumentTop() });
      });
    },

    /**
     * Tek kaydı lig dışı bırakır ya da lige geri alır. PUT tam liste yazdığından güncel liste okunup değiştirilir.
     * @return {Promise}
     */
    async setExcluded(league, kind, value, exclude) {
      const data = await ankamon.io.Api.get(
        `/league-exclusions?league=${encodeURIComponent(league)}&kind=${encodeURIComponent(kind)}`);
      const values = new Set(data.excluded || []);
      const v = kind === "user" ? String(value).toLowerCase() : String(value);
      if (exclude) {
        values.add(v);
      } else {
        values.delete(v);
      }
      await ankamon.io.Api.put("/league-exclusions", { league, kind, values: [...values] });
    },

    /** Seçim penceresi; kaydedilince onSaved() çağrılır. */
    async open(league, kind, onSaved) {
      const F = ankamon.util.Format;
      const texts = ankamon.ui.sessions.LeagueExclusions.LEAGUE_EXCLUSION_TEXTS[`${league}/${kind}`];
      const win = ankamon.ui.Dialog.window(texts.title, 560, { maximizable: true });
      win.add(new qx.ui.basic.Label(
        `İşaretlenen ${texts.noun}lar bu ligin sıralamasında ve toplamlarında sayılmaz (kayıtlar silinmez; ` +
        "\"Lig dışındakileri de göster\" ile yine görülebilir). Seçim herkes için geçerlidir, istendiğinde değiştirilebilir. " +
        "Yanındaki süre bu eğitim-öğretim yılının toplamıdır."
      ).set({ rich: true, wrap: true, textColor: "app-muted" }));
      const search = new qx.ui.form.TextField().set({ placeholder: "Ara…", liveUpdate: true });
      win.add(search);
      const listBox = new qx.ui.container.Composite(new qx.ui.layout.VBox(2));
      const scroll = new qx.ui.container.Scroll(listBox).set({ height: 360 });
      win.add(scroll, { flex: 1 });
      const status = new qx.ui.basic.Label("Yükleniyor…").set({ textColor: "app-muted" });
      win.add(status);

      const boxes = [];
      const countSelected = () => {
        const n = boxes.filter(b => b.box.getValue()).length;
        status.setValue(`${n} ${texts.noun} lig dışı seçili · ${boxes.length} ${texts.noun} listeleniyor`);
      };
      const save = new qx.ui.form.Button("Kaydet").set({ enabled: false });
      const cancel = new qx.ui.form.Button("İptal");
      cancel.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [save, cancel]);
      win.open();

      let data;
      try {
        data = await ankamon.io.Api.get(`/league-exclusions?league=${encodeURIComponent(league)}&kind=${encodeURIComponent(kind)}`);
      } catch (e) {
        status.setValue(qx.bom.String.escape(e.message || String(e)));
        return;
      }
      const excluded = new Set(data.excluded || []);
      const candidates = data.candidates || [];
      // Lig dışı olup adaylarda bulunmayan (bu yıl süresi olmayan, Tahtalar'dan silinmiş) değerler de listelenir.
      excluded.forEach(v => {
        if (!candidates.some(c => c.value === v)) {
          candidates.push({ value: v, label: null, seconds: 0 });
        }
      });
      // Lig dışı olanlar üstte, sonra yıl toplamı çoktan aza (API sırası).
      candidates.sort((a, b) => Number(excluded.has(b.value)) - Number(excluded.has(a.value)));
      candidates.forEach(c => {
        const name = c.label ? `${c.label} (${c.value})` : c.value;
        const box = new qx.ui.form.CheckBox(`${name} — ${c.seconds ? F.duration(c.seconds) : "bu yıl süresi yok"}`)
          .set({ value: excluded.has(c.value) });
        box.addListener("changeValue", countSelected);
        listBox.add(box);
        boxes.push({ box, value: c.value, text: `${c.label || ""} ${c.value}`.toLocaleLowerCase("tr-TR") });
      });
      if (!boxes.length) {
        listBox.add(new qx.ui.basic.Label(`Henüz ligde ${texts.noun} yok.`).set({ textColor: "app-muted" }));
      }
      search.addListener("changeValue", e => {
        const q = (e.getData() || "").trim().toLocaleLowerCase("tr-TR");
        boxes.forEach(b => b.box.setVisibility(!q || b.text.includes(q) ? "visible" : "excluded"));
      });
      countSelected();
      save.setEnabled(true);
      save.addListener("execute", async () => {
        save.setEnabled(false);
        try {
          await ankamon.io.Api.put("/league-exclusions", {
            league, kind, values: boxes.filter(b => b.box.getValue()).map(b => b.value)
          });
          win.close();
          onSaved && onSaved();
        } catch (e) {
          save.setEnabled(true);
          ankamon.ui.Dialog.error(e);
        }
      });
    }
  }
});
