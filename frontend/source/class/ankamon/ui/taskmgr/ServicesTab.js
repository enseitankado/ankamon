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
 * Hizmetler (Windows Görev Yöneticisi gibi): systemd hizmetleri — Ad, PID, Açıklama, Durum, Başlangıç türü.
 * Sağ menü: Başlat, Durdur, Yeniden başlat, Ayrıntılara git. Liste yalnız sekme görünürken 5 sn'de bir gelir
 * (ajan "want": services). Çok tahtada bütün tahtaların hizmetleri tek tabloda ("Bilgisayar" sütunu); işlem
 * satırın tahtasına gider.
 */
qx.Class.define("ankamon.ui.taskmgr.ServicesTab", {
  extend: ankamon.ui.taskmgr.Tab,

  statics: {
    STATE: { active: "Çalışıyor", inactive: "Durduruldu", failed: "Başarısız", activating: "Başlatılıyor", deactivating: "Durduruluyor", reloading: "Yeniden yükleniyor" },
    START: { enabled: "Otomatik", "enabled-runtime": "Otomatik (geçici)", disabled: "Devre dışı", static: "Statik (başka bir birim başlatır)",
      masked: "Engellenmiş (masked)", indirect: "Dolaylı", generated: "Üretilmiş", alias: "Takma ad", "": "—" }
  },

  construct(win) {
    super(win, "Hizmetler", "services");
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__info = new qx.ui.basic.Label("Hizmetler yükleniyor…").set({ textColor: "app-muted" });
    bar.add(this.__info, { flex: 1 });
    [["Başlat", "start"], ["Durdur", "stop"], ["Yeniden başlat", "restart"]].forEach(([l, a]) =>
      bar.add(this._button(l, () => this.__act(this._selectedId(this.__table), a))));
    this.add(bar);
    this.__table = this._table([
      { id: "name", label: "Ad", width: 260 },
      { id: "pid", label: "PID", width: 70 },
      { id: "desc", label: "Açıklama", width: 320 },
      { id: "state", label: "Durum", width: 110 },
      { id: "start", label: "Başlangıç türü", width: 170 },
      { id: "sub", label: "Alt durum", width: 100 }
    ], "taskmgr.services");
    this._rowMenu(this.__table, id => {
      const it = this.__service(id);
      if (!it) {
        return null;
      }
      const { link, s } = it;
      const menu = new qx.ui.menu.Menu();
      const on = s.active === "active";
      this._item(menu, "Başlat", () => this.__act(id, "start"), !on);
      this._item(menu, "Durdur", () => this.__act(id, "stop"), on);
      this._item(menu, "Yeniden başlat", () => this.__act(id, "restart"), on);
      menu.add(new qx.ui.menu.Separator());
      this._item(menu, "Ayrıntılara git", () => this._win.goToDetails(link, s.pid), s.pid > 0);
      return menu;
    });
    this.add(this.__table, { flex: 1 });
  },

  members: {
    __table: null,
    __info: null,
    __msgAt: 0,

    /** Satır kimliğinden ({link, s}) ya da null. */
    __service(id) {
      const parsed = this._parseId(id);
      const s = parsed && (parsed.link.getModel().services || []).find(x => x.name === parsed.id);
      return s ? { link: parsed.link, s } : null;
    },

    async __act(id, action) {
      const it = this.__service(id);
      if (!it) {
        return;
      }
      const { link } = it;
      const name = it.s.name;
      const where = this._win.isMulti() ? ` (${link.getDisplay()})` : "";
      const verb = { start: "başlatılsın", stop: "durdurulsun", restart: "yeniden başlatılsın" }[action];
      if (action !== "start" && !(await ankamon.ui.Dialog.confirm(
        `<b>${ankamon.ui.taskmgr.Fmt.esc(name)}</b> hizmeti${ankamon.ui.taskmgr.Fmt.esc(where)} ${verb} mı?<br><br>Tahtadaki bağımlı işlevler etkilenebilir.`, "Evet"))) {
        return;
      }
      this.__msgAt = Date.now();
      this.__info.setValue(`${name}${where}: işlem sürüyor…`);
      try {
        await link.send("svc", { name, action });
        this.__msgAt = Date.now();
        this.__info.setValue(`${name}${where}: tamam.`);
      } catch (e) {
        this.__msgAt = Date.now();
        this.__info.setValue(`${name}${where}: ${e.message}`);
        ankamon.ui.Dialog.error(e);
      }
    },

    /** Belirtilen tahtanın belirtilen hizmetlerini seçer (Ayrıntılar ▸ Hizmetlere git). */
    reveal(link, names) {
      this.update();
      const ids = names.map(n => this._rowId(link, n));
      const tm = this.__table.getTableModel();
      const sel = this.__table.getSelectionModel();
      sel.resetSelection();
      for (let i = 0; i < tm.getRowCount(); i++) {
        if (ids.includes(tm.getValue(0, i))) {
          sel.addSelectionInterval(i, i);
          this.__table.scrollCellVisible(1, i);
        }
      }
    },

    // overridden
    update() {
      const links = this._links("services");
      if (!links.length) {
        return;
      }
      const S = ankamon.ui.taskmgr.ServicesTab;
      const q = this._win.getFilter();
      const rows = [];
      let total = 0;
      let running = 0;
      links.forEach(link => {
        const items = link.getModel().services;
        const whole = this._win.boardMatches(link, q);
        const board = link.getDisplay();
        total += items.length;
        running += items.filter(s => s.active === "active").length;
        items.filter(s => whole || !q || s.name.toLowerCase().includes(q) || (s.desc || "").toLowerCase().includes(q) || String(s.pid) === q)
          .forEach(s => rows.push([this._rowId(link, s.name), s.name.replace(/\.service$/, ""), s.pid || "", s.desc || "",
            S.STATE[s.active] || s.active, S.START[s.file_state] ?? s.file_state, s.sub || "", board]));
      });
      // İşlem iletisi (__act) 6 sn görünür, sonra özet.
      if (!this.__msgAt || Date.now() - this.__msgAt > 6000) {
        this.__info.setValue(`${total} hizmet · ${running} çalışıyor` + (this._win.isMulti() ? ` · ${links.length} tahta` : ""));
      }
      this._setRows(this.__table, rows);
    }
  }
});
