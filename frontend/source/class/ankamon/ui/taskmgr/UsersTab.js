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
 * Kullanıcılar (Windows Görev Yöneticisi gibi): tahtadaki oturumlar (loginctl) — Kullanıcı, Durum, Oturum,
 * CPU/Bellek/Disk/Ağ toplamı (o kullanıcının süreçleri). Satır açılınca kullanıcının en çok kaynak kullanan
 * süreçleri görünür. Eylemler: Bağlantıyı kes (oturumu kilitle — ETAP kilit ekranı), Oturumu kapat.
 */
qx.Class.define("ankamon.ui.taskmgr.UsersTab", {
  extend: ankamon.ui.taskmgr.Tab,

  construct(win) {
    super(win, "Kullanıcılar", "users");
    const F = ankamon.ui.taskmgr.Fmt;
    this.__expanded = new Set();
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__info = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
    bar.add(this.__info, { flex: 1 });
    bar.add(this._button("Bağlantıyı kes", () => this.__session("lock")));
    bar.add(this._button("Oturumu kapat", () => this.__session("logout")));
    this.add(bar);
    const memMax = () => (this._win.getModel().memTotal || 1) * 0.5;
    this.__tm = new ankamon.ui.table.GroupModel(() => this.update(this._win.getModel()));
    this.__table = this._table([
      { id: "name", label: "Kullanıcı", width: 260, renderer: new qx.ui.table.cellrenderer.Html() },
      { id: "state", label: "Durum", width: 110 },
      { id: "session", label: "Oturum", width: 170 },
      { id: "cpu", label: "CPU", width: 80, renderer: new ankamon.ui.taskmgr.HeatRenderer(v => F.pct(v), 50) },
      { id: "mem", label: "Bellek", width: 100, renderer: new ankamon.ui.taskmgr.HeatRenderer(v => F.memKb(v), memMax) },
      { id: "disk", label: "Disk", width: 100, renderer: new ankamon.ui.taskmgr.HeatRenderer(v => F.diskRate(v), 5 * 1048576) },
      { id: "net", label: "Ağ", width: 90, renderer: new ankamon.ui.taskmgr.HeatRenderer(v => F.netRate(v), 250000) }
    ], "taskmgr.users", this.__tm);
    this.__table.setDataRowRenderer(new ankamon.ui.table.GroupRowRenderer(row => String(row[0]).startsWith("p:")));
    this.__table.addListener("cellDbltap", e => this.__toggle(this.__tm.getValue(0, e.getRow())));
    this.__table.addListener("cellTap", e => {
      if (e.getColumn() === 1) {
        this.__toggle(this.__tm.getValue(0, e.getRow()));
      }
    });
    this._rowMenu(this.__table, id => {
      if (!String(id).startsWith("s:")) {
        return null;
      }
      const menu = new qx.ui.menu.Menu();
      this._item(menu, this.__expanded.has(id) ? "Daralt" : "Genişlet", () => this.__toggle(id));
      menu.add(new qx.ui.menu.Separator());
      this._item(menu, "Bağlantıyı kes", () => this.__session("lock"));
      this._item(menu, "Oturumu kapat", () => this.__session("logout"));
      return menu;
    });
    this.add(this.__table, { flex: 1 });
  },

  members: {
    __table: null,
    __tm: null,
    __info: null,
    __expanded: null,

    __toggle(id) {
      if (!id || !String(id).startsWith("s:")) {
        return;
      }
      if (this.__expanded.has(id)) {
        this.__expanded.delete(id);
      } else {
        this.__expanded.add(id);
      }
      this.update(this._win.getModel());
    },

    async __session(op) {
      const id = this._selectedId(this.__table);
      const s = id && String(id).startsWith("s:") ? (this._win.getModel().users || []).find(u => "s:" + u.id === id) : null;
      if (!s) {
        ankamon.ui.Dialog.alert("Önce listeden bir kullanıcı oturumu seçin.");
        return;
      }
      const F = ankamon.ui.taskmgr.Fmt;
      if (s.self) {
        ankamon.ui.Dialog.alert("Bu, görev yöneticisinin tahtaya kendi bağlantısı. Kapatmak için pencereyi kapatın.");
        return;
      }
      const text = op === "logout"
        ? `<b>${F.esc(s.user)}</b> kullanıcısının oturumu kapatılsın mı?<br><br>Kaydedilmemiş veriler kaybolabilir.`
        : `<b>${F.esc(s.user)}</b> kullanıcısının bağlantısı kesilsin (ekran kilitlensin) mi?<br>Oturum açık kalır; tahtada parola ile açılır.`;
      if (!(await ankamon.ui.Dialog.confirm(text, op === "logout" ? "Oturumu kapat" : "Bağlantıyı kes"))) {
        return;
      }
      try {
        await this._win.getConn().send(op, { session: s.id });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    // overridden
    update(m) {
      if (!m.snap || !m.users) {
        return;
      }
      const F = ankamon.ui.taskmgr.Fmt;
      const rows = [];
      const byUid = new Map();
      m.procs.forEach(p => {
        if (!byUid.has(p.uid)) {
          byUid.set(p.uid, []);
        }
        byUid.get(p.uid).push(p);
      });
      const sum = (list, k) => list.reduce((a, p) => a + (p[k] || 0), 0);
      const STATE = { active: "Etkin", online: "Bağlı (arka planda)", closing: "Kapanıyor" };
      m.users.forEach(u => {
        const list = byUid.get(u.uid) || [];
        const key = "s:" + u.id;
        const open = this.__expanded.has(key);
        const label = `<span style="display:inline-block;width:16px;opacity:.7">${list.length ? (open ? "▾" : "▸") : ""}</span>👤 ` +
          `<b>${F.esc(u.user)}</b> <span style="opacity:.6">(${list.length})</span>`;
        const where = u.self ? "Ankamon bağlantısı (bu pencere)"
          : [u.type === "x11" ? "Masaüstü" : u.type, u.display || u.tty, u.remote ? "uzak: " + u.host : ""].filter(Boolean).join(" · ");
        rows.push([key, label, STATE[u.state] || u.state, `#${u.id} ${where}`, Math.round(sum(list, "cpu") * 10) / 10,
          sum(list, "mem"), sum(list, "disk"), sum(list, "net")]);
        if (open) {
          list.slice().sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).slice(0, 60).forEach(p =>
            rows.push(["p:" + u.id + ":" + p.pid, `<span style="display:inline-block;width:40px"></span>${F.esc(p.name)} <span style="opacity:.6">${p.pid}</span>`,
              F.state(p.state, p.eco), "", p.cpu, p.mem, p.disk, p.net]));
        }
      });
      this.__info.setValue(`${m.users.length} oturum`);
      this._setRows(this.__table, rows);
    }
  }
});
