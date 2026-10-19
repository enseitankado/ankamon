/**
 * Ayrıntılar (Windows Görev Yöneticisi gibi): her süreç bir satır — Ad, PID, Durum, Kullanıcı adı, CPU, Bellek,
 * Açıklama (komut satırı); isteğe bağlı sütunlar (sütun menüsü): Öncelik, İş parçacıkları, Disk, Ağ, Üst PID,
 * CPU süresi, Görüntü yolu. Sağ menü: Görevi sonlandır, İşlem ağacını sonlandır, Önceliği ayarla, Benzeşimi
 * ayarla, Verimlilik modu, Hizmetlere git, Dosya konumunu aç, Çevrimiçi ara, Özellikler.
 */
qx.Class.define("tihamon.ui.taskmgr.DetailsTab", {
  extend: tihamon.ui.taskmgr.Tab,

  construct(win) {
    super(win, "Ayrıntılar", "details");
    const F = tihamon.ui.taskmgr.Fmt;
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__kthreads = new qx.ui.form.CheckBox("Çekirdek iş parçacıklarını göster");
    this.__kthreads.addListener("changeValue", () => this.update(this._win.getModel()));
    bar.add(this.__kthreads);
    bar.add(new qx.ui.core.Spacer(), { flex: 1 });
    bar.add(this._button("Görevi sonlandır", () => this.endSelected()));
    this.add(bar);
    const num = new qx.ui.table.cellrenderer.Number();
    const right = fmt => new tihamon.ui.taskmgr.HeatRenderer(fmt, Infinity);
    this.__table = this._table([
      { id: "name", label: "Ad", width: 170 },
      { id: "pid", label: "PID", width: 70, renderer: num },
      { id: "status", label: "Durum", width: 110 },
      { id: "user", label: "Kullanıcı adı", width: 130 },
      { id: "cpu", label: "CPU", width: 60, renderer: right(v => F.num(v, 0).padStart(2, "0")) },
      { id: "mem", label: "Bellek (etkin özel çalışma kümesi)", hint: "Bellek", width: 130, renderer: right(v => F.num(v, 0) + " K") },
      { id: "desc", label: "Açıklama", width: 380 },
      { id: "prio", label: "Öncelik", width: 120, hidden: true },
      { id: "threads", label: "İş parçacıkları", width: 90, hidden: true, renderer: num },
      { id: "disk", label: "Disk", width: 100, hidden: true, renderer: right(v => F.bytesRate(v)) },
      { id: "net", label: "Ağ", width: 90, hidden: true, renderer: right(v => F.bits(v)) },
      { id: "ppid", label: "Üst PID", width: 70, hidden: true, renderer: num },
      { id: "cputime", label: "CPU süresi", width: 90, hidden: true },
      { id: "path", label: "Görüntü yolu adı", width: 260, hidden: true }
    ], "taskmgr.details");
    this.__table.addListener("keypress", e => {
      if (e.getKeyIdentifier() === "Delete") {
        this.endSelected();
      }
    });
    this._rowMenu(this.__table, pid => this.__menu(pid));
    this.add(this.__table, { flex: 1 });
  },

  members: {
    __table: null,
    __kthreads: null,
    __rows: null,

    selected() {
      const pid = this._selectedId(this.__table);
      const p = pid === null ? null : this._win.getModel().procs.get(pid);
      return p ? { pid, tree: false, name: p.name } : null;
    },

    endSelected() {
      const s = this.selected();
      if (s) {
        this._win.endTask(s.pid, false, s.name);
      }
    },

    reveal(pid) {
      const p = this._win.getModel().procs.get(pid);
      if (p && p.kthread) {
        this.__kthreads.setValue(true);
      }
      this.update(this._win.getModel());
      const idx = (this.__rows || []).findIndex(r => r[0] === pid);
      if (idx >= 0) {
        this.__table.getSelectionModel().setSelectionInterval(idx, idx);
        this.__table.scrollCellVisible(1, idx);
      }
    },

    __menu(pid) {
      const m = this._win.getModel();
      const p = m.procs.get(pid);
      if (!p) {
        return null;
      }
      const F = tihamon.ui.taskmgr.Fmt;
      const menu = new qx.ui.menu.Menu();
      this._item(menu, "Görevi sonlandır", () => this._win.endTask(pid, false, p.name));
      this._item(menu, "İşlem ağacını sonlandır", () => this._win.endTask(pid, true, p.name));
      menu.add(new qx.ui.menu.Separator());
      const prio = new qx.ui.menu.Menu();
      const cur = F.priority(p.nice);
      F.PRIORITIES.forEach(([label, nice]) => {
        const b = new qx.ui.menu.RadioButton(label).set({ value: label === cur });
        b.addListener("execute", () => this._win.setPriority(pid, nice, p.name, label));
        prio.add(b);
      });
      menu.add(new qx.ui.menu.Button("Önceliği ayarla", null, null, prio));
      this._item(menu, "Benzeşimi ayarla", () => this._win.setAffinity(pid, p.name));
      const eco = new qx.ui.menu.CheckBox("Verimlilik modu").set({ value: !!p.eco });
      eco.addListener("execute", () => this._win.efficiency(pid, !p.eco, p.name));
      menu.add(eco);
      menu.add(new qx.ui.menu.Separator());
      const svc = (m.services || []).filter(s => s.pid === pid);
      this._item(menu, "Hizmetlere git", () => this._win.goToServices(svc.map(s => s.name)), svc.length > 0 || !m.services);
      this._item(menu, "Dosya konumunu aç", () => this._win.showLocation(pid));
      this._item(menu, "Çevrimiçi ara", () => window.open("https://www.google.com/search?q=" + encodeURIComponent(p.name + " linux process"), "_blank"));
      this._item(menu, "Özellikler", () => this._win.showProps(pid));
      return menu;
    },

    // overridden
    update(m) {
      if (!m.snap || !this.isSeeable()) {
        return;
      }
      const F = tihamon.ui.taskmgr.Fmt;
      const q = this._win.getFilter();
      const all = this.__kthreads.getValue();
      const rows = [];
      m.procs.forEach(p => {
        if ((p.kthread && !all) || (q && !p.name.toLowerCase().includes(q) && String(p.pid) !== q &&
          !(p.cmd || "").toLowerCase().includes(q) && !p.user.toLowerCase().includes(q))) {
          return;
        }
        rows.push([p.pid, p.name, p.pid, F.state(p.state, p.eco), p.user, Math.round(p.cpu), p.mem, p.cmd || `[${p.name}]`,
          F.priority(p.nice) + ` (nice ${p.nice})`, p.threads, p.disk, p.net, p.ppid,
          F.cpuTime(p.ticks / (m.hz || 100)), p.exe || ""]);
      });
      // İlk açılışta ada göre (Windows varsayılanı); sonra kullanıcının seçtiği sütun sıralaması korunur.
      const tm = this.__table.getTableModel();
      if (!this.__rows && tm.getSortColumnIndex() < 0) {
        rows.sort((a, b) => a[1].localeCompare(b[1], "tr"));
      }
      this.__rows = rows;
      this._setRows(this.__table, rows);
    }
  }
});
