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
 * Başlangıç uygulamaları (Windows Görev Yöneticisi gibi): oturum açılınca kendiliğinden başlayan uygulamalar
 * (XDG autostart: /etc/xdg/autostart + ~/.config/autostart) — Ad, Yayımcı (paket), Durum, Başlangıç etkisi.
 * Etkinleştir / Devre dışı bırak, tahtada OTURUM AÇMIŞ kullanıcıya göre uygulanır (kullanıcının autostart
 * geçersiz kılması; sistem dosyası değişmez). Liste yalnız sekme görünürken 10 sn'de bir gelir. Çok tahtada
 * bütün tahtaların listeleri tek tabloda ("Bilgisayar" sütunu); değişiklik satırın tahtasına uygulanır.
 */
qx.Class.define("ankamon.ui.taskmgr.StartupTab", {
  extend: ankamon.ui.taskmgr.Tab,

  construct(win) {
    super(win, "Başlangıç uygulamaları", "startup");
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__info = new qx.ui.basic.Label("Yükleniyor…").set({ textColor: "app-muted", rich: true });
    bar.add(this.__info, { flex: 1 });
    this.__enable = this._button("Etkinleştir", () => this.__set(true));
    this.__disable = this._button("Devre dışı bırak", () => this.__set(false));
    bar.add(this.__enable);
    bar.add(this.__disable);
    this.add(bar);
    this.__table = this._table([
      { id: "name", label: "Ad", width: 280 },
      { id: "publisher", label: "Yayımcı", width: 200 },
      { id: "status", label: "Durum", width: 100 },
      { id: "impact", label: "Başlangıç etkisi", width: 120 },
      { id: "exec", label: "Komut satırı", width: 300 },
      { id: "comment", label: "Açıklama", width: 300 }
    ], "taskmgr.startup");
    this._rowMenu(this.__table, id => {
      const found = this.__item(id);
      if (!found) {
        return null;
      }
      const it = found.it;
      const menu = new qx.ui.menu.Menu();
      this._item(menu, it.enabled ? "Devre dışı bırak" : "Etkinleştir", () => this.__set(!it.enabled), !!found.st.user);
      this._item(menu, "Çevrimiçi ara", () => window.open("https://www.google.com/search?q=" + encodeURIComponent(it.name + " " + it.publisher), "_blank"));
      return menu;
    });
    this.__table.getSelectionModel().addListener("changeSelection", () => this.__syncButtons());
    this.add(this.__table, { flex: 1 });
  },

  members: {
    __table: null,
    __info: null,
    __enable: null,
    __disable: null,

    /** Satır kimliğinden ({link, st, it}) ya da null. */
    __item(id) {
      const parsed = this._parseId(id);
      const st = parsed && parsed.link.getModel().startup;
      const it = st && st.items.find(x => x.id === parsed.id);
      return it ? { link: parsed.link, st, it } : null;
    },

    /** Düğmeler: tahtada oturum açıksa etkin (çok tahtada seçili satırın tahtasına göre; seçim yoksa etkin). */
    __syncButtons() {
      const found = this.__item(this._selectedId(this.__table));
      let can;
      if (found) {
        can = !!found.st.user;
      } else {
        const links = this._links("startup");
        can = this._win.isMulti() ? true : links.some(l => l.getModel().startup.user);
      }
      this.__enable.setEnabled(can);
      this.__disable.setEnabled(can);
    },

    async __set(enable) {
      const found = this.__item(this._selectedId(this.__table));
      if (!found || found.it.enabled === enable) {
        return;
      }
      const { link, st, it } = found;
      if (!st.user) {
        ankamon.ui.Dialog.alert("Bu tahtada oturum açık değil: değişiklik oturum açılınca yapılabilir.");
        return;
      }
      try {
        const res = await link.send("startup", { id: it.id, enable });
        it.enabled = enable;
        this.update();
        this.__info.setValue(ankamon.ui.taskmgr.Fmt.esc((this._win.isMulti() ? link.getDisplay() + ": " : "") + (res.msg || "Tamam.")));
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    // overridden
    update() {
      const links = this._links("startup");
      if (!links.length) {
        return;
      }
      const F = ankamon.ui.taskmgr.Fmt;
      const q = this._win.getFilter();
      if (!this._win.isMulti()) {
        const st = links[0].getModel().startup;
        this.__info.setValue(st.user
          ? `Ayarlar tahtada oturum açmış <b>${F.esc(st.user)}</b> kullanıcısı için geçerlidir. ${st.items.filter(i => i.enabled).length} etkin / ${st.items.length}`
          : "Tahtada oturum açık değil: liste görüntülenir, değişiklik oturum açılınca yapılabilir.");
      } else {
        const withUser = links.filter(l => l.getModel().startup.user).length;
        this.__info.setValue(`${links.length} tahta · ${withUser} tahtada oturum açık. Ayarlar her tahtada oturum açmış kullanıcı ` +
          "için geçerlidir; oturumu kapalı tahtada değişiklik oturum açılınca yapılabilir.");
      }
      const rows = [];
      links.forEach(link => {
        const st = link.getModel().startup;
        const whole = this._win.boardMatches(link, q);
        const board = link.getDisplay();
        st.items.filter(i => whole || !q || i.name.toLowerCase().includes(q) || (i.publisher || "").toLowerCase().includes(q))
          .forEach(i => rows.push([this._rowId(link, i.id), i.name, i.publisher || "—", i.enabled ? "Etkin" : "Devre dışı",
            "Ölçülmedi", i.exec, i.comment, board]));
      });
      this._setRows(this.__table, rows);
      this.__syncButtons();
    }
  }
});
