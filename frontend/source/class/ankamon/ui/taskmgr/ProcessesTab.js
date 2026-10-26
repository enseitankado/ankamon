/**
 * İşlemler (Windows Görev Yöneticisi'nin ilk sekmesi): gruplar — Uygulamalar (penceresi olan süreçler; alt
 * süreçleri ve pencere başlıkları altında açılır), Arka plan işlemleri (oturum kullanıcısının penceresiz
 * süreçleri), Sistem işlemleri (sistem kullanıcıları). Çekirdek iş parçacıkları burada gösterilmez (Ayrıntılar'da
 * var). Sütunlar: Ad, Durum, CPU, Bellek, Disk, Ağ, Güç kullanımı; başlıklarda toplamlar; değer arttıkça
 * koyulaşan "ısı" hücreleri. Sıralama grupların İÇİNDE yapılır (ui.table.GroupModel).
 */
qx.Class.define("ankamon.ui.taskmgr.ProcessesTab", {
  extend: ankamon.ui.taskmgr.Tab,

  statics: {
    GROUPS: [["apps", "Uygulamalar"], ["bg", "Arka plan işlemleri"], ["sys", "Sistem işlemleri"]],
    COL: { name: 1, status: 2, cpu: 3, mem: 4, disk: 5, net: 6, power: 7, pid: 8, proc: 9, user: 10, cmd: 11 }
  },

  construct(win) {
    super(win, "İşlemler", "processes");
    const F = ankamon.ui.taskmgr.Fmt;
    this.__expanded = new Set(["g:apps", "g:bg", "g:sys"]);
    this.__sort = null;
    const memMax = () => (this._win.getModel().memTotal || 1) * 0.25;
    const memFmt = v => (this._win.getSettings().memPct
      ? F.pct((100 * v) / (this._win.getModel().memTotal || 1)) : F.memKb(v));
    this.__columns = [
      { id: "name", label: "Ad", width: 300, renderer: new qx.ui.table.cellrenderer.Html() },
      { id: "status", label: "Durum", width: 120 },
      { id: "cpu", label: "CPU", width: 80, renderer: new ankamon.ui.taskmgr.HeatRenderer(v => F.pct(v), 50) },
      { id: "mem", label: "Bellek", width: 100, renderer: new ankamon.ui.taskmgr.HeatRenderer(memFmt, memMax) },
      { id: "disk", label: "Disk", width: 100, renderer: new ankamon.ui.taskmgr.HeatRenderer(v => F.diskRate(v), 5 * 1048576) },
      { id: "net", label: "Ağ", width: 90, renderer: new ankamon.ui.taskmgr.HeatRenderer(v => F.netRate(v), 250000) },
      { id: "power", label: "Güç kullanımı", width: 110 },
      { id: "pid", label: "PID", width: 70 },
      { id: "proc", label: "İşlem adı", width: 140 },
      { id: "user", label: "Kullanıcı", width: 120 },
      { id: "cmd", label: "Komut satırı", width: 400 }
    ];
    this.__tm = new ankamon.ui.table.GroupModel((col, asc) => {
      this.__sort = { col, asc };
      this.update(this._win.getModel());
    });
    this.__table = this._table(this.__columns, "taskmgr.processes", this.__tm);
    this.__table.setDataRowRenderer(new ankamon.ui.table.GroupRowRenderer(row => /^[cw]:/.test(row[0])));
    // Ad hücresine (ok) tıklama ya da satıra çift tıklama: aç/kapa.
    this.__table.addListener("cellTap", e => {
      const id = this.__tm.getValue(0, e.getRow());
      if (e.getColumn() === 1 && id && /^[ga]:/.test(id)) {
        this.__toggle(id);
      }
    });
    this.__table.addListener("cellDbltap", e => {
      const id = this.__tm.getValue(0, e.getRow());
      if (id && /^[ga]:/.test(id)) {
        this.__toggle(id);
      }
    });
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
    __tm: null,
    __columns: null,
    __expanded: null,
    __sort: null,
    __rows: null,

    __toggle(id) {
      if (this.__expanded.has(id)) {
        this.__expanded.delete(id);
      } else {
        this.__expanded.add(id);
      }
      this.update(this._win.getModel());
    },

    /** Seçili satırın süreci: {pid, tree, name} (uygulama satırı → ağaç) ya da null. */
    selected() {
      const id = this._selectedId(this.__table);
      if (!id || !/^[acp]:/.test(id)) {
        return null;
      }
      const pid = Number(id.slice(2));
      const p = this._win.getModel().procs.get(pid);
      // Windows "Görevi sonlandır": uygulamada kök süreç kapatılır (alt süreçleri onunla biter); ağaç Ayrıntılar'da.
      return p ? { pid, tree: false, name: p.name } : null;
    },

    endSelected() {
      const s = this.selected();
      if (s) {
        this._win.endTask(s.pid, s.tree, s.name);
      }
    },

    /** Ayrıntılar'dan / dışarıdan: süreci (gerekirse grubunu açarak) seçer. */
    reveal(pid) {
      const m = this._win.getModel();
      const root = m.appOf.get(pid);
      if (root !== undefined && root !== pid) {
        this.__expanded.add("a:" + root);
      }
      this.update(m);
      const idx = (this.__rows || []).findIndex(r => r[0] === "a:" + pid || r[0] === "p:" + pid || r[0] === "c:" + pid);
      if (idx >= 0) {
        this.__table.getSelectionModel().setSelectionInterval(idx, idx);
        this.__table.scrollCellVisible(1, idx);
      }
    },

    __menu(id) {
      if (!/^[acp]:/.test(id)) {
        return null;
      }
      const pid = Number(id.slice(2));
      const p = this._win.getModel().procs.get(pid);
      if (!p) {
        return null;
      }
      const tree = id[0] === "a";
      const menu = new qx.ui.menu.Menu();
      if (tree) {
        this._item(menu, this.__expanded.has(id) ? "Daralt" : "Genişlet", () => this.__toggle(id));
        menu.add(new qx.ui.menu.Separator());
      }
      this._item(menu, "Görevi sonlandır", () => this._win.endTask(pid, false, p.name));
      const eco = new qx.ui.menu.CheckBox("Verimlilik modu").set({ value: !!p.eco });
      eco.addListener("execute", () => this._win.efficiency(pid, !p.eco, p.name));
      menu.add(eco);
      const values = new qx.ui.menu.Menu();
      const mem = new qx.ui.menu.Menu();
      const settings = this._win.getSettings();
      [["Değerler", false], ["Yüzdeler", true]].forEach(([label, pct]) => {
        const b = new qx.ui.menu.RadioButton(label).set({ value: !!settings.memPct === pct });
        b.addListener("execute", () => {
          this._win.setSetting("memPct", pct);
          this.update(this._win.getModel());
        });
        mem.add(b);
      });
      values.add(new qx.ui.menu.Button("Bellek", null, null, mem));
      menu.add(new qx.ui.menu.Button("Kaynak değerleri", null, null, values));
      menu.add(new qx.ui.menu.Separator());
      this._item(menu, "Ayrıntılara git", () => this._win.goToDetails(pid));
      this._item(menu, "Dosya konumunu aç", () => this._win.showLocation(pid));
      this._item(menu, "Çevrimiçi ara", () => window.open("https://www.google.com/search?q=" + encodeURIComponent(p.name + " linux process"), "_blank"));
      this._item(menu, "Özellikler", () => this._win.showProps(pid));
      return menu;
    },

    // overridden
    update(m) {
      if (!m.snap) {
        return;
      }
      const F = ankamon.ui.taskmgr.Fmt;
      const S = ankamon.ui.taskmgr.ProcessesTab;
      const q = this._win.getFilter();
      const match = p => !q || p.name.toLowerCase().includes(q) || String(p.pid) === q ||
        (p.cmd || "").toLowerCase().includes(q) || (m.windows.get(p.pid) || []).some(w => w.title.toLowerCase().includes(q));
      const sessionUid = m.session && m.session.uid;
      // Gruplar: apps = pencere sahibi kökler; ağaçları (alt süreçler) uygulamaya aittir.
      const groups = { apps: [], bg: [], sys: [] };
      const claimed = new Set();
      m.appRoots.forEach(root => {
        const tree = m.descendants(root).filter(pid => !claimed.has(pid));
        tree.forEach(pid => claimed.add(pid));
        groups.apps.push({ root, tree });
      });
      m.procs.forEach(p => {
        if (p.kthread || claimed.has(p.pid)) {
          return;
        }
        (p.uid >= 1000 || (sessionUid && p.uid === sessionUid) ? groups.bg : groups.sys).push({ root: p.pid, tree: [p.pid] });
      });
      const sum = (pids, k) => pids.reduce((a, pid) => a + ((m.procs.get(pid) || {})[k] || 0), 0);
      const rowOf = (key, name, pids, p, depth, expandable) => {
        const cpu = sum(pids, "cpu");
        const arrow = expandable ? (this.__expanded.has(key) ? "▾" : "▸") : "";
        const label = `<span style="display:inline-block;width:${14 + depth * 18}px;text-align:right;opacity:.7">${arrow}&nbsp;</span>` +
          F.esc(name) + (expandable && pids.length > 1 ? ` <span style="opacity:.6">(${pids.length})</span>` : "");
        return [key, label, p ? F.state(p.state, p.eco) : "", Math.round(cpu * 10) / 10, sum(pids, "mem"),
          sum(pids, "disk"), sum(pids, "net"), F.power(cpu), p ? p.pid : null, p ? p.name : "", p ? p.user : "", p ? p.cmd : ""];
      };
      const sortKey = this.__sort ? this.__columns[this.__sort.col - 1] : null;
      const order = (a, b) => {
        if (!sortKey) {
          return String(a[1]).replace(/<[^>]+>/g, "").localeCompare(String(b[1]).replace(/<[^>]+>/g, ""), "tr");
        }
        const i = this.__sort.col;
        const x = a[i] ?? "";
        const y = b[i] ?? "";
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "tr");
        return this.__sort.asc ? c : -c;
      };
      const rows = [];
      S.GROUPS.forEach(([g, title]) => {
        const items = groups[g].filter(it => it.tree.some(pid => match(m.procs.get(pid) || { name: "" })));
        if (!items.length) {
          return;
        }
        const gkey = "g:" + g;
        const allPids = items.flatMap(it => it.tree);
        const grow = rowOf(gkey, "", allPids, null, 0, true);
        grow[1] = `<b>${this.__expanded.has(gkey) ? "▾" : "▸"} ${F.esc(title)} (${items.length})</b>`;
        grow[3] = grow[4] = grow[5] = grow[6] = null;
        grow[7] = "";
        rows.push(grow);
        if (!this.__expanded.has(gkey)) {
          return;
        }
        const entries = items.map(it => {
          const p = m.procs.get(it.root);
          const isApp = g === "apps";
          const title = isApp ? m.appName(it.root) : p.name;
          return { it, row: rowOf((isApp ? "a:" : "p:") + it.root, title, it.tree, p, 1, isApp) };
        });
        entries.sort((a, b) => order(a.row, b.row));
        entries.forEach(({ it, row }) => {
          rows.push(row);
          if (g === "apps" && this.__expanded.has(row[0])) {
            (m.windows.get(it.root) || []).forEach(w =>
              rows.push(["w:" + w.id, `<span style="display:inline-block;width:50px"></span>🗔 ${F.esc(w.title || "(adsız pencere)")}`,
                "", null, null, null, null, "", null, "", "", ""]));
            it.tree.map(pid => rowOf("c:" + pid, m.procs.get(pid).name, [pid], m.procs.get(pid), 2, false))
              .sort(order).forEach(r => rows.push(r));
          }
        });
      });
      this.__rows = rows;
      this._setRows(this.__table, rows);
      // Başlıklarda toplamlar (Windows: "%12 CPU").
      const t = m.totals;
      const names = ["id", "Ad", "Durum", `CPU ${F.pct(t.cpu, 0)}`,
        `Bellek ${F.pct((100 * t.memUsed) / (m.memTotal || 1), 0)}`, `Disk ${F.pct(t.diskBusy, 0)}`,
        `Ağ ${F.pct(t.netPct, 0)}`, "Güç kullanımı", "PID", "İşlem adı", "Kullanıcı", "Komut satırı"];
      const cur = names.map((n, i) => this.__tm.getColumnName(i));
      if (cur.join("|") !== names.join("|")) {
        this.__tm.setColumnNamesByIndex(names);
      }
    }
  }
});
