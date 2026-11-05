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
 * Ayrıntılar (Windows Görev Yöneticisi gibi): her süreç bir satır — Ad, PID, Durum, Kullanıcı adı, CPU, Bellek,
 * Açıklama (komut satırı); isteğe bağlı sütunlar (sütun menüsü): Öncelik, İş parçacıkları, Disk, Ağ, Üst PID,
 * CPU süresi, Görüntü yolu. Sağ menü: Görevi sonlandır, İşlem ağacını sonlandır, Önceliği ayarla, Benzeşimi
 * ayarla, Verimlilik modu, Hizmetlere git, Dosya konumunu aç, Çevrimiçi ara, Özellikler. Çok tahtada bütün
 * tahtaların süreçleri tek tabloda ("Bilgisayar" sütunu); işlemler satırın tahtasına gider.
 */
qx.Class.define("ankamon.ui.taskmgr.DetailsTab", {
  extend: ankamon.ui.taskmgr.Tab,

  construct(win) {
    super(win, "Ayrıntılar", "details");
    const F = ankamon.ui.taskmgr.Fmt;
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__kthreads = new qx.ui.form.CheckBox("Çekirdek iş parçacıklarını göster");
    this.__kthreads.addListener("changeValue", () => this.update());
    bar.add(this.__kthreads);
    bar.add(new qx.ui.core.Spacer(), { flex: 1 });
    bar.add(this._button("Görevi sonlandır", () => this.endSelected()));
    this.add(bar);
    const num = new qx.ui.table.cellrenderer.Number();
    const right = fmt => new ankamon.ui.taskmgr.HeatRenderer(fmt, Infinity);
    this.__table = this._table([
      { id: "name", label: "Ad", width: 170 },
      { id: "pid", label: "PID", width: 70, renderer: num },
      { id: "status", label: "Durum", width: 110 },
      { id: "user", label: "Kullanıcı adı", width: 130 },
      { id: "cpu", label: "CPU", width: 60, renderer: right(v => F.num(v, 0).padStart(2, "0")) },
      { id: "mem", label: "Bellek (etkin özel çalışma kümesi)", hint: "Bellek", width: 130, renderer: right(v => F.num(v, 0) + " K") },
      { id: "desc", label: "Açıklama", width: 380 },
      { id: "prio", label: "Öncelik", width: 120 },
      { id: "threads", label: "İş parçacıkları", width: 90, renderer: num },
      { id: "disk", label: "Disk", width: 100, renderer: right(v => F.bytesRate(v)) },
      { id: "net", label: "Ağ", width: 90, renderer: right(v => F.bits(v)) },
      { id: "ppid", label: "Üst PID", width: 70, renderer: num },
      { id: "cputime", label: "CPU süresi", width: 90 },
      { id: "path", label: "Görüntü yolu adı", width: 260 }
    ], "taskmgr.details");
    this.__table.addListener("keypress", e => {
      if (e.getKeyIdentifier() === "Delete") {
        this.endSelected();
      }
    });
    this._rowMenu(this.__table, id => this.__menu(id));
    this.add(this.__table, { flex: 1 });
  },

  members: {
    __table: null,
    __kthreads: null,
    __rows: null,

    /** Satır kimliğinden ({link, pid, p}) ya da null. */
    __proc(id) {
      const parsed = this._parseId(id);
      const pid = parsed ? Number(parsed.id) : NaN;
      const p = parsed && parsed.link.getModel().procs.get(pid);
      return p ? { link: parsed.link, pid, p } : null;
    },

    selected() {
      const s = this.__proc(this._selectedId(this.__table));
      return s ? { link: s.link, pid: s.pid, tree: false, name: s.p.name } : null;
    },

    endSelected() {
      const s = this.selected();
      if (s) {
        this._win.endTask(s.link, s.pid, false, s.name);
      }
    },

    reveal(link, pid) {
      const p = link.getModel().procs.get(pid);
      if (p && p.kthread) {
        this.__kthreads.setValue(true);
      }
      this.update();
      const id = this._rowId(link, pid);
      const idx = (this.__rows || []).findIndex(r => r[0] === id);
      if (idx >= 0) {
        this.__table.getSelectionModel().setSelectionInterval(idx, idx);
        this.__table.scrollCellVisible(1, idx);
      }
    },

    __menu(id) {
      const s = this.__proc(id);
      if (!s) {
        return null;
      }
      const { link, pid, p } = s;
      const m = link.getModel();
      const F = ankamon.ui.taskmgr.Fmt;
      const menu = new qx.ui.menu.Menu();
      this._item(menu, "Görevi sonlandır", () => this._win.endTask(link, pid, false, p.name));
      this._item(menu, "İşlem ağacını sonlandır", () => this._win.endTask(link, pid, true, p.name));
      menu.add(new qx.ui.menu.Separator());
      const prio = new qx.ui.menu.Menu();
      const cur = F.priority(p.nice);
      F.PRIORITIES.forEach(([label, nice]) => {
        const b = new qx.ui.menu.RadioButton(label).set({ value: label === cur });
        b.addListener("execute", () => this._win.setPriority(link, pid, nice, p.name, label));
        prio.add(b);
      });
      menu.add(new qx.ui.menu.Button("Önceliği ayarla", null, null, prio));
      this._item(menu, "Benzeşimi ayarla", () => this._win.setAffinity(link, pid, p.name));
      const eco = new qx.ui.menu.CheckBox("Verimlilik modu").set({ value: !!p.eco });
      eco.addListener("execute", () => this._win.efficiency(link, pid, !p.eco, p.name));
      menu.add(eco);
      menu.add(new qx.ui.menu.Separator());
      const svc = (m.services || []).filter(x => x.pid === pid);
      this._item(menu, "Hizmetlere git", () => this._win.goToServices(link, svc.map(x => x.name)), svc.length > 0 || !m.services);
      this._item(menu, "Dosya konumunu aç", () => this._win.showLocation(link, pid));
      this._item(menu, "Çevrimiçi ara", () => window.open("https://www.google.com/search?q=" + encodeURIComponent(p.name + " linux process"), "_blank"));
      this._item(menu, "Özellikler", () => this._win.showProps(link, pid));
      return menu;
    },

    // overridden
    update() {
      if (!this.isSeeable()) {
        return;
      }
      const F = ankamon.ui.taskmgr.Fmt;
      const q = this._win.getFilter();
      const all = this.__kthreads.getValue();
      const rows = [];
      this._links().forEach(link => {
        const m = link.getModel();
        const whole = this._win.boardMatches(link, q);
        const board = link.getDisplay();
        m.procs.forEach(p => {
          if ((p.kthread && !all) || (q && !whole && !p.name.toLowerCase().includes(q) && String(p.pid) !== q &&
            !(p.cmd || "").toLowerCase().includes(q) && !p.user.toLowerCase().includes(q))) {
            return;
          }
          rows.push([this._rowId(link, p.pid), p.name, p.pid, F.state(p.state, p.eco), p.user, Math.round(p.cpu), p.mem, p.cmd || `[${p.name}]`,
            F.priority(p.nice) + ` (nice ${p.nice})`, p.threads, p.disk, p.net, p.ppid,
            F.cpuTime(p.ticks / (m.hz || 100)), p.exe || "", board]);
        });
      });
      // Kullanıcı sütun başlığından sıralama seçmediyse ada göre (Windows varsayılanı; çok tahtada aynı ad tahtaya
      // göre); seçtiyse o sıralama korunur (tablo modeli uygular).
      const tm = this.__table.getTableModel();
      if (tm.getSortColumnIndex() < 0) {
        const coll = new Intl.Collator("tr", { numeric: true });
        const last = rows.length ? rows[0].length - 1 : 0;
        rows.sort((a, b) => coll.compare(a[1], b[1]) || coll.compare(a[last], b[last]));
      }
      this.__rows = rows;
      this._setRows(this.__table, rows);
    }
  }
});
