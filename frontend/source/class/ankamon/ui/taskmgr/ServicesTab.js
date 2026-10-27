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
 * (ajan "want": services).
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
    this._rowMenu(this.__table, name => {
      const s = (this._win.getModel().services || []).find(x => x.name === name);
      if (!s) {
        return null;
      }
      const menu = new qx.ui.menu.Menu();
      const on = s.active === "active";
      this._item(menu, "Başlat", () => this.__act(name, "start"), !on);
      this._item(menu, "Durdur", () => this.__act(name, "stop"), on);
      this._item(menu, "Yeniden başlat", () => this.__act(name, "restart"), on);
      menu.add(new qx.ui.menu.Separator());
      this._item(menu, "Ayrıntılara git", () => this._win.goToDetails(s.pid), s.pid > 0);
      return menu;
    });
    this.add(this.__table, { flex: 1 });
  },

  members: {
    __table: null,
    __info: null,
    __shown: null,
    __msgAt: 0,

    async __act(name, action) {
      if (!name) {
        return;
      }
      const verb = { start: "başlatılsın", stop: "durdurulsun", restart: "yeniden başlatılsın" }[action];
      if (action !== "start" && !(await ankamon.ui.Dialog.confirm(
        `<b>${ankamon.ui.taskmgr.Fmt.esc(name)}</b> hizmeti ${verb} mı?<br><br>Tahtadaki bağımlı işlevler etkilenebilir.`, "Evet"))) {
        return;
      }
      this.__msgAt = Date.now();
      this.__info.setValue(`${name}: işlem sürüyor…`);
      try {
        await this._win.getConn().send("svc", { name, action });
        this.__msgAt = Date.now();
        this.__info.setValue(`${name}: tamam.`);
      } catch (e) {
        this.__msgAt = Date.now();
        this.__info.setValue(`${name}: ${e.message}`);
        ankamon.ui.Dialog.error(e);
      }
    },

    /** Belirtilen hizmetleri seçer (Ayrıntılar ▸ Hizmetlere git). */
    reveal(names) {
      this.__shown = names;
      this.update(this._win.getModel());
      const tm = this.__table.getTableModel();
      const sel = this.__table.getSelectionModel();
      sel.resetSelection();
      for (let i = 0; i < tm.getRowCount(); i++) {
        if (names.includes(tm.getValue(0, i))) {
          sel.addSelectionInterval(i, i);
          this.__table.scrollCellVisible(1, i);
        }
      }
    },

    // overridden
    update(m) {
      if (!m.services) {
        return;
      }
      const S = ankamon.ui.taskmgr.ServicesTab;
      const q = this._win.getFilter();
      const rows = m.services.filter(s => !q || s.name.toLowerCase().includes(q) || (s.desc || "").toLowerCase().includes(q) || String(s.pid) === q)
        .map(s => [s.name, s.name.replace(/\.service$/, ""), s.pid || "", s.desc || "", S.STATE[s.active] || s.active,
          S.START[s.file_state] ?? s.file_state, s.sub || ""]);
      // İşlem iletisi (__act) 6 sn görünür, sonra özet.
      if (!this.__msgAt || Date.now() - this.__msgAt > 6000) {
        const running = m.services.filter(s => s.active === "active").length;
        this.__info.setValue(`${m.services.length} hizmet · ${running} çalışıyor`);
      }
      this._setRows(this.__table, rows);
    }
  }
});
