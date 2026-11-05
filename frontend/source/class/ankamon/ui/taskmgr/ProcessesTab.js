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
 * İşlemler (Windows Görev Yöneticisi'nin ilk sekmesi): gruplar — Uygulamalar (penceresi olan süreçler; alt
 * süreçleri ve pencere başlıkları altında açılır), Arka plan işlemleri (oturum kullanıcısının penceresiz
 * süreçleri), Sistem işlemleri (sistem kullanıcıları). Çekirdek iş parçacıkları burada gösterilmez (Ayrıntılar'da
 * var). Sütunlar: Ad, Durum, CPU, Bellek, Disk, Ağ, Güç kullanımı; başlıklarda toplamlar; değer arttıkça
 * koyulaşan "ısı" hücreleri. Sıralama grupların İÇİNDE yapılır (ui.table.GroupModel).
 *
 * Çok tahta: gruplar bütün tahtaların süreçlerini birlikte içerir, her satırda "Bilgisayar" sütunu (Bilgisayar
 * süzgeci ve arama ile daraltılır); başlıklardaki toplamlar gösterilen tahtaların ortalamasıdır.
 */
qx.Class.define("ankamon.ui.taskmgr.ProcessesTab", {
  extend: ankamon.ui.taskmgr.Tab,

  statics: {
    GROUPS: [["apps", "Uygulamalar"], ["bg", "Arka plan işlemleri"], ["sys", "Sistem işlemleri"]],
    COL: { name: 1, status: 2, cpu: 3, mem: 4, disk: 5, net: 6, power: 7, pid: 8, proc: 9, user: 10, cmd: 11, board: 12 }
  },

  construct(win) {
    super(win, "İşlemler", "processes");
    const F = ankamon.ui.taskmgr.Fmt;
    this.__expanded = new Set(["g:apps", "g:bg", "g:sys"]);
    this.__sort = null;
    // Bellek ölçeği/yüzdesi satırın tahtasının belleğine göre (çok tahtada tahtaların belleği farklı olabilir).
    const memTotalOf = rowData => {
      const parsed = rowData && this._parseId(rowData[0]);
      return (parsed && parsed.link.getModel().memTotal) || this.__maxMem();
    };
    const memMax = () => this.__maxMem() * 0.25;
    const memFmt = (v, rowData) => (this._win.getSettings().memPct ? F.pct((100 * v) / (memTotalOf(rowData) || 1)) : F.memKb(v));
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
      this.update();
    });
    this.__table = this._table(this.__columns, "taskmgr.processes", this.__tm);
    this.__table.setDataRowRenderer(new ankamon.ui.table.GroupRowRenderer(row => /^\d+:[cw]:/.test(row[0])));
    // Ad hücresine (ok) tıklama ya da satıra çift tıklama: aç/kapa.
    this.__table.addListener("cellTap", e => {
      const id = this.__tm.getValue(0, e.getRow());
      if (e.getColumn() === 1 && this.__toggleable(id)) {
        this.__toggle(id);
      }
    });
    this.__table.addListener("cellDbltap", e => {
      const id = this.__tm.getValue(0, e.getRow());
      if (this.__toggleable(id)) {
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

    __maxMem() {
      return Math.max(1, ...this._win.getLinks().map(l => l.getModel().memTotal || 0));
    },

    /** Açılıp kapanabilen satır: grup ("g:apps") ya da uygulama ("<tahta>:a:<pid>"). */
    __toggleable(id) {
      return !!id && (/^g:/.test(id) || /^\d+:a:/.test(id));
    },

    __toggle(id) {
      if (this.__expanded.has(id)) {
        this.__expanded.delete(id);
      } else {
        this.__expanded.add(id);
      }
      this.update();
    },

    /** Süreç satırının tahtası ve PID'i ({link, pid, kind}) ya da null. */
    __proc(id) {
      const parsed = this._parseId(id);
      const m = parsed && /^([acp]):(\d+)$/.exec(parsed.id);
      return m ? { link: parsed.link, pid: Number(m[2]), kind: m[1] } : null;
    },

    /** Seçili satırın süreci: {link, pid, tree, name} ya da null. */
    selected() {
      const s = this.__proc(this._selectedId(this.__table));
      const p = s && s.link.getModel().procs.get(s.pid);
      // Windows "Görevi sonlandır": uygulamada kök süreç kapatılır (alt süreçleri onunla biter); ağaç Ayrıntılar'da.
      return p ? { link: s.link, pid: s.pid, tree: false, name: p.name } : null;
    },

    endSelected() {
      const s = this.selected();
      if (s) {
        this._win.endTask(s.link, s.pid, s.tree, s.name);
      }
    },

    /** Ayrıntılar'dan / dışarıdan: süreci (gerekirse grubunu açarak) seçer. */
    reveal(link, pid) {
      const m = link.getModel();
      const root = m.appOf.get(pid);
      if (root !== undefined && root !== pid) {
        this.__expanded.add(this._rowId(link, "a:" + root));
      }
      this.update();
      const ids = ["a:", "p:", "c:"].map(k => this._rowId(link, k + pid));
      const idx = (this.__rows || []).findIndex(r => ids.includes(r[0]));
      if (idx >= 0) {
        this.__table.getSelectionModel().setSelectionInterval(idx, idx);
        this.__table.scrollCellVisible(1, idx);
      }
    },

    __menu(id) {
      const s = this.__proc(id);
      const p = s && s.link.getModel().procs.get(s.pid);
      if (!p) {
        return null;
      }
      const { link, pid } = s;
      const tree = s.kind === "a";
      const menu = new qx.ui.menu.Menu();
      if (tree) {
        this._item(menu, this.__expanded.has(id) ? "Daralt" : "Genişlet", () => this.__toggle(id));
        menu.add(new qx.ui.menu.Separator());
      }
      this._item(menu, "Görevi sonlandır", () => this._win.endTask(link, pid, false, p.name));
      const eco = new qx.ui.menu.CheckBox("Verimlilik modu").set({ value: !!p.eco });
      eco.addListener("execute", () => this._win.efficiency(link, pid, !p.eco, p.name));
      menu.add(eco);
      const values = new qx.ui.menu.Menu();
      const mem = new qx.ui.menu.Menu();
      const settings = this._win.getSettings();
      [["Değerler", false], ["Yüzdeler", true]].forEach(([label, pct]) => {
        const b = new qx.ui.menu.RadioButton(label).set({ value: !!settings.memPct === pct });
        b.addListener("execute", () => {
          this._win.setSetting("memPct", pct);
          this.update();
        });
        mem.add(b);
      });
      values.add(new qx.ui.menu.Button("Bellek", null, null, mem));
      menu.add(new qx.ui.menu.Button("Kaynak değerleri", null, null, values));
      menu.add(new qx.ui.menu.Separator());
      this._item(menu, "Ayrıntılara git", () => this._win.goToDetails(link, pid));
      this._item(menu, "Dosya konumunu aç", () => this._win.showLocation(link, pid));
      this._item(menu, "Çevrimiçi ara", () => window.open("https://www.google.com/search?q=" + encodeURIComponent(p.name + " linux process"), "_blank"));
      this._item(menu, "Özellikler", () => this._win.showProps(link, pid));
      return menu;
    },

    // overridden
    update() {
      const links = this._links();
      if (!links.length) {
        if (this.__rows && this.__rows.length) {
          this.__rows = [];
          this._setRows(this.__table, []);
        }
        return;
      }
      const F = ankamon.ui.taskmgr.Fmt;
      const S = ankamon.ui.taskmgr.ProcessesTab;
      const q = this._win.getFilter();
      // Gruplar: apps = pencere sahibi kökler; ağaçları (alt süreçler) uygulamaya aittir. Bütün tahtalar birlikte.
      const groups = { apps: [], bg: [], sys: [] };
      links.forEach(link => {
        const m = link.getModel();
        const whole = this._win.boardMatches(link, q);
        const match = p => whole || !q || p.name.toLowerCase().includes(q) || String(p.pid) === q ||
          (p.cmd || "").toLowerCase().includes(q) || (m.windows.get(p.pid) || []).some(w => w.title.toLowerCase().includes(q));
        const sessionUid = m.session && m.session.uid;
        const claimed = new Set();
        m.appRoots.forEach(root => {
          const tree = m.descendants(root).filter(pid => !claimed.has(pid));
          tree.forEach(pid => claimed.add(pid));
          groups.apps.push({ link, m, match, root, tree });
        });
        m.procs.forEach(p => {
          if (p.kthread || claimed.has(p.pid)) {
            return;
          }
          (p.uid >= 1000 || (sessionUid && p.uid === sessionUid) ? groups.bg : groups.sys).push({ link, m, match, root: p.pid, tree: [p.pid] });
        });
      });
      const sum = (m, pids, k) => pids.reduce((a, pid) => a + ((m.procs.get(pid) || {})[k] || 0), 0);
      const rowOf = (link, m, key, name, pids, p, depth, expandable) => {
        const cpu = sum(m, pids, "cpu");
        const arrow = expandable ? (this.__expanded.has(key) ? "▾" : "▸") : "";
        const label = `<span style="display:inline-block;width:${14 + depth * 18}px;text-align:right;opacity:.7">${arrow}&nbsp;</span>` +
          F.esc(name) + (expandable && pids.length > 1 ? ` <span style="opacity:.6">(${pids.length})</span>` : "");
        return [key, label, p ? F.state(p.state, p.eco) : "", Math.round(cpu * 10) / 10, sum(m, pids, "mem"),
          sum(m, pids, "disk"), sum(m, pids, "net"), F.power(cpu), p ? p.pid : null, p ? p.name : "", p ? p.user : "", p ? p.cmd : "",
          link.getDisplay()];
      };
      const plain = v => String(v ?? "").replace(/<[^>]+>/g, "");
      const boardCol = S.COL.board;
      const byBoard = (a, b) => String(a[boardCol]).localeCompare(String(b[boardCol]), "tr", { numeric: true });
      const order = (a, b) => {
        if (!this.__sort) {
          return plain(a[1]).localeCompare(plain(b[1]), "tr") || byBoard(a, b);
        }
        const i = this.__sort.col;
        const x = a[i] ?? "";
        const y = b[i] ?? "";
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "tr", { numeric: true });
        return (this.__sort.asc ? c : -c) || (i === boardCol ? plain(a[1]).localeCompare(plain(b[1]), "tr") : byBoard(a, b));
      };
      const rows = [];
      S.GROUPS.forEach(([g, title]) => {
        const items = groups[g].filter(it => it.tree.some(pid => it.match(it.m.procs.get(pid) || { name: "" })));
        if (!items.length) {
          return;
        }
        const gkey = "g:" + g;
        rows.push([gkey, `<b>${this.__expanded.has(gkey) ? "▾" : "▸"} ${F.esc(title)} (${items.length})</b>`, "",
          null, null, null, null, "", null, "", "", "", ""]);
        if (!this.__expanded.has(gkey)) {
          return;
        }
        const entries = items.map(it => {
          const p = it.m.procs.get(it.root);
          const isApp = g === "apps";
          const name = isApp ? it.m.appName(it.root) : p.name;
          return { it, row: rowOf(it.link, it.m, this._rowId(it.link, (isApp ? "a:" : "p:") + it.root), name, it.tree, p, 1, isApp) };
        });
        entries.sort((a, b) => order(a.row, b.row));
        entries.forEach(({ it, row }) => {
          rows.push(row);
          if (g === "apps" && this.__expanded.has(row[0])) {
            const { link, m } = it;
            (m.windows.get(it.root) || []).forEach(w =>
              rows.push([this._rowId(link, "w:" + w.id), `<span style="display:inline-block;width:50px"></span>🗔 ${F.esc(w.title || "(adsız pencere)")}`,
                "", null, null, null, null, "", null, "", "", "", link.getDisplay()]));
            it.tree.map(pid => rowOf(link, m, this._rowId(link, "c:" + pid), m.procs.get(pid).name, [pid], m.procs.get(pid), 2, false))
              .sort(order).forEach(r => rows.push(r));
          }
        });
      });
      this.__rows = rows;
      this._setRows(this.__table, rows);
      // Başlıklarda toplamlar (Windows: "%12 CPU"); çok tahtada gösterilen tahtaların ortalaması.
      const avg = f => links.reduce((a, l) => a + f(l.getModel()), 0) / links.length;
      const names = ["id", "Ad", "Durum", `CPU ${F.pct(avg(m => m.totals.cpu), 0)}`,
        `Bellek ${F.pct(avg(m => (100 * m.totals.memUsed) / (m.memTotal || 1)), 0)}`, `Disk ${F.pct(avg(m => m.totals.diskBusy), 0)}`,
        `Ağ ${F.pct(avg(m => m.totals.netPct), 0)}`, "Güç kullanımı", "PID", "İşlem adı", "Kullanıcı", "Komut satırı",
        ankamon.ui.taskmgr.Tab.BOARD_COLUMN.label];
      const cur = names.map((n, i) => this.__tm.getColumnName(i));
      if (cur.join("|") !== names.join("|")) {
        this.__tm.setColumnNamesByIndex(names);
      }
    }
  }
});
