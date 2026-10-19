/**
 * Performans (Windows Görev Yöneticisi gibi): solda kaynak listesi (CPU, Bellek, Disk N, Ethernet/Wi-Fi, GPU —
 * her biri küçük grafik + özet), sağda seçili kaynağın 60 sn büyük grafiği ve ayrıntıları. CPU grafiği "Genel
 * kullanım" ya da "Mantıksal işlemciler" (çekirdek başına küçük grafikler) olarak değiştirilebilir.
 */
qx.Class.define("tihamon.ui.taskmgr.PerformanceTab", {
  extend: tihamon.ui.taskmgr.Tab,

  construct(win) {
    super(win, "Performans", "performance");
    this.setLayout(new qx.ui.layout.HBox(10));
    this.__tiles = new Map();
    this.__selected = "cpu";

    this.__list = new qx.ui.container.Composite(new qx.ui.layout.VBox(2));
    const listScroll = new qx.ui.container.Scroll(this.__list).set({ width: 250 });
    this.add(listScroll);

    const right = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
    const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "bottom" }));
    this.__title = new qx.ui.basic.Label("").set({ font: "headline" });
    this.__model = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    head.add(this.__title);
    head.add(new qx.ui.core.Spacer(), { flex: 1 });
    head.add(this.__model);
    right.add(head);
    const scale = new qx.ui.container.Composite(new qx.ui.layout.HBox());
    this.__axisLeft = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
    this.__axisRight = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
    scale.add(this.__axisLeft);
    scale.add(new qx.ui.core.Spacer(), { flex: 1 });
    scale.add(this.__axisRight);
    right.add(scale);
    this.__big = new tihamon.ui.taskmgr.Graph("cpu");
    this.__cores = new qx.ui.container.Composite(new qx.ui.layout.Grid(4, 4)).set({ visibility: "excluded" });
    this.__coreGraphs = [];
    right.add(this.__big, { flex: 1 });
    right.add(this.__cores, { flex: 1 });
    const foot = new qx.ui.container.Composite(new qx.ui.layout.HBox(8));
    this.__axisBottom = new qx.ui.basic.Label("60 saniye").set({ textColor: "app-muted" });
    foot.add(this.__axisBottom);
    foot.add(new qx.ui.core.Spacer(), { flex: 1 });
    this.__coreToggle = new qx.ui.form.SelectBox().set({ width: 210 });
    [["overall", "Grafik: Genel kullanım"], ["cores", "Grafik: Mantıksal işlemciler"]].forEach(([v, l]) =>
      this.__coreToggle.add(new qx.ui.form.ListItem(l, null, v)));
    this.__coreToggle.addListener("changeSelection", () => this.update(this._win.getModel()));
    foot.add(this.__coreToggle);
    right.add(foot);
    this.__composition = new qx.ui.embed.Html("").set({ height: 34, visibility: "excluded" });
    right.add(this.__composition);
    this.__details = new qx.ui.embed.Html("").set({ minHeight: 150, overflowY: "auto" });
    right.add(this.__details);
    this.add(right, { flex: 1 });
  },

  members: {
    __list: null,
    __tiles: null,
    __selected: null,
    __title: null,
    __model: null,
    __axisLeft: null,
    __axisRight: null,
    __axisBottom: null,
    __big: null,
    __cores: null,
    __coreGraphs: null,
    __coreToggle: null,
    __composition: null,
    __details: null,

    /** Sol listedeki kaynaklar: [{key, kind, title, sub, value, series, max}] */
    __resources(m) {
      const F = tihamon.ui.taskmgr.Fmt;
      const s = m.snap;
      const h = m.hist;
      const st = m.static || {};
      const out = [{
        key: "cpu", kind: "cpu", title: "CPU", sub: `${F.pct(s.cpu.total, 0)}  ${s.cpu.mhz ? F.num(s.cpu.mhz / 1000, 2) + " GHz" : ""}`,
        series: [h.cpu], max: 100
      }, {
        key: "mem", kind: "mem", title: "Bellek",
        sub: `${F.sizeKb(m.totals.memUsed)}/${F.sizeKb(m.memTotal)} (${F.pct((100 * m.totals.memUsed) / (m.memTotal || 1), 0)})`,
        series: [h.mem], max: 100
      }];
      (s.disks || []).forEach((d, i) => {
        const info = (st.disks || []).find(x => x.name === d.name) || {};
        out.push({ key: "disk:" + d.name, kind: "disk", title: `Disk ${i} (${d.name})`,
          sub: `${info.ssd ? "SSD" : "HDD"}\n${F.pct(d.busy, 0)}`, series: [(h.disks[d.name] || {}).busy || []], max: 100 });
      });
      (s.nets || []).forEach(n => {
        const info = (st.nets || []).find(x => x.name === n.name) || {};
        const hn = h.nets[n.name] || { rx: [], tx: [] };
        out.push({ key: "net:" + n.name, kind: "net", title: info.wireless ? "Wi-Fi" : "Ethernet",
          sub: `${n.name}\n${n.up ? `G: ${F.bits(n.tx)} A: ${F.bits(n.rx)}` : "Bağlantı yok"}`,
          series: [hn.rx, hn.tx], max: Math.max(1000, ...hn.rx, ...hn.tx) * 1.15 });
      });
      (st.gpus || []).forEach((g, i) => {
        const cur = (s.gpus || [])[i] || {};
        out.push({ key: "gpu:" + i, kind: "gpu", title: `GPU ${i}`,
          sub: `${g.name.replace(/Corporation |Advanced Micro Devices, Inc\. /, "").slice(0, 34)}\n` +
            (cur.busy !== null && cur.busy !== undefined ? F.pct(cur.busy, 0) : (cur.mhz ? cur.mhz + " MHz" : "kullanım ölçülemiyor")),
          series: [(h.gpus[i] || [])], max: cur.busy !== null && cur.busy !== undefined ? 100 : Math.max(1, ...(h.gpus[i] || [1]))});
      });
      return out;
    },

    __tile(r) {
      let t = this.__tiles.get(r.key);
      if (!t) {
        const box = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" })).set({
          padding: 6, cursor: "pointer",
          decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 4 })
        });
        const graph = new tihamon.ui.taskmgr.Graph(r.kind, true).set({ width: 70, height: 44, allowGrowX: false });
        const text = new qx.ui.basic.Label("").set({ rich: true, allowGrowX: true });
        box.add(graph);
        box.add(text, { flex: 1 });
        box.addListener("tap", () => {
          this.__selected = r.key;
          this.update(this._win.getModel());
        });
        this.__list.add(box);
        t = { box, graph, text };
        this.__tiles.set(r.key, t);
      }
      return t;
    },

    // overridden
    update(m) {
      if (!m.snap) {
        return;
      }
      const F = tihamon.ui.taskmgr.Fmt;
      const res = this.__resources(m);
      if (!res.some(r => r.key === this.__selected)) {
        this.__selected = "cpu";
      }
      const keys = new Set(res.map(r => r.key));
      this.__tiles.forEach((t, k) => {
        if (!keys.has(k)) {
          t.box.destroy();
          this.__tiles.delete(k);
        }
      });
      res.forEach(r => {
        const t = this.__tile(r);
        t.graph.setData(r.series, r.max);
        t.text.setValue(`<b>${F.esc(r.title)}</b><br><span style="opacity:.75">${F.esc(r.sub).replace(/\n/g, "<br>")}</span>`);
        // Seçili kaynak: yarı saydam mavi (her temada okunur; temada "seçili kart" rengi yok).
        t.box.setBackgroundColor(r.key === this.__selected ? "rgba(17,125,187,0.18)" : null);
      });
      if (!this.isSeeable()) {
        return;
      }
      const sel = res.find(r => r.key === this.__selected);
      this.__big.setKind(sel.kind);
      this.__big.setData(sel.series, sel.max);
      this.__title.setValue(sel.title);
      this.__coreToggle.setVisibility(sel.kind === "cpu" ? "visible" : "hidden");
      this.__composition.setVisibility(sel.kind === "mem" ? "visible" : "excluded");
      const showCores = sel.kind === "cpu" && this.__coreToggle.getSelection()[0].getModel() === "cores";
      this.__big.setVisibility(showCores ? "excluded" : "visible");
      this.__cores.setVisibility(showCores ? "visible" : "excluded");
      if (showCores) {
        this.__drawCores(m);
      }
      this.__axisBottom.setValue("60 saniye");
      const row = (k, v) => `<tr><td style="opacity:.7;padding:2px 18px 2px 0">${F.esc(k)}</td><td style="font-size:1.15em">${v}</td></tr>`;
      const grid = cols => `<div style="display:flex;gap:40px;flex-wrap:wrap">${cols.map(c => `<table>${c.join("")}</table>`).join("")}</div>`;
      const s = m.snap;
      const st = m.static || {};
      if (sel.kind === "cpu") {
        this.__model.setValue(F.esc(st.cpu_model || ""));
        this.__axisLeft.setValue("% Kullanım");
        this.__axisRight.setValue("%100");
        const procs = s.procs.length;
        const threads = s.procs.reduce((a, r) => a + r[9], 0);
        this.__details.setHtml(grid([
          [row("Kullanım", F.pct(s.cpu.total, 0)), row("Hız", s.cpu.mhz ? F.num(s.cpu.mhz / 1000, 2) + " GHz" : "—"),
            row("İşlemler", procs), row("İş parçacıkları", threads), row("Tanıtıcılar", s.handles), row("Çalışma süresi", F.uptime(s.uptime))],
          [row("Temel hız", st.base_mhz ? F.num(st.base_mhz / 1000, 2) + " GHz" : "—"), row("Yuvalar", st.sockets),
            row("Çekirdekler", st.cores), row("Mantıksal işlemciler", st.ncpu), row("Sanallaştırma", st.virtualization ? "Etkin" : "Desteklenmiyor")]
            .concat(Object.entries(st.caches || {}).map(([k, v]) => row(k + " önbelleği", F.esc(v))))
        ]));
      } else if (sel.kind === "mem") {
        const mm = s.mem;
        const hw = st.mem_hw || {};
        const used = m.totals.memUsed;
        this.__model.setValue(F.sizeKb(mm.total) + " " + (hw.form ? F.esc(hw.form) : ""));
        this.__axisLeft.setValue("Bellek kullanımı");
        this.__axisRight.setValue(F.sizeKb(mm.total));
        const pct = v => ((100 * v) / (mm.total || 1)).toFixed(2);
        const seg = (w, c, title) => `<div title="${title}" style="width:${w}%;background:${c};height:100%"></div>`;
        this.__composition.setHtml(`<div style="opacity:.7;font-size:.9em;margin-bottom:3px">Bellek bileşimi</div>` +
          `<div style="display:flex;height:18px;border:1px solid #8b12ae;box-sizing:border-box">` +
          seg(pct(used - mm.dirty), "rgba(139,18,174,.55)", "Kullanımda") +
          seg(pct(mm.dirty), "rgba(139,18,174,.35)", "Değiştirilmiş (diske yazılmayı bekliyor)") +
          seg(pct(mm.cached + mm.buffers), "rgba(139,18,174,.15)", "Bekleme (önbellek)") +
          seg(pct(mm.free), "transparent", "Boş") + "</div>");
        this.__details.setHtml(grid([
          [row("Kullanımda", F.sizeKb(used)), row("Kullanılabilir", F.sizeKb(mm.avail)),
            row("Kaydedilen", `${F.sizeKb(mm.committed)}/${F.sizeKb(mm.commit_limit)}`),
            row("Önbelleğe alınan", F.sizeKb(mm.cached + mm.buffers)), row("Disk belleği havuzu", F.sizeKb(mm.paged)),
            row("Disk belleği olmayan havuz", F.sizeKb(mm.nonpaged))],
          [row("Hız", hw.speed ? hw.speed + " MT/sn" : "—"), row("Kullanılan yuvalar", hw.slots ? `${hw.used}/${hw.slots}` : "—"),
            row("Form faktörü", F.esc(hw.form || "—")), row("Takas (swap)", mm.swap_total ? `${F.sizeKb(mm.swap_total - mm.swap_free)}/${F.sizeKb(mm.swap_total)}` : "yok"),
            row("Paylaşılan", F.sizeKb(mm.shmem))]
        ]));
      } else if (sel.kind === "disk") {
        const name = sel.key.slice(5);
        const d = s.disks.find(x => x.name === name) || {};
        const info = (st.disks || []).find(x => x.name === name) || {};
        this.__model.setValue(F.esc(info.model || name));
        this.__axisLeft.setValue("Etkin süre");
        this.__axisRight.setValue("%100");
        const hd = m.hist.disks[name] || { r: [], w: [] };
        this.__composition.setVisibility("excluded");
        this.__details.setHtml(grid([
          [row("Etkin süre", F.pct(d.busy, 0)), row("Ortalama yanıt süresi", F.num(d.resp, 1) + " ms"),
            row("Okuma hızı", F.bytesRate(d.r)), row("Yazma hızı", F.bytesRate(d.w)),
            row("Son 60 sn en yüksek", F.bytesRate(Math.max(0, ...hd.r, ...hd.w)))],
          [row("Kapasite", F.sizeB(info.size)), row("Tür", info.ssd ? "SSD" : "HDD"),
            row("Sistem diski", (m.static && m.static.root_disk) === name ? "Evet" : "Hayır")]
        ]));
      } else if (sel.kind === "net") {
        const name = sel.key.slice(4);
        const n = s.nets.find(x => x.name === name) || {};
        const info = (st.nets || []).find(x => x.name === name) || {};
        this.__model.setValue(F.esc(`${name} (${info.driver || ""})`));
        this.__axisLeft.setValue("Aktarım hızı (sürekli: al, kesikli: gönder)");
        this.__axisRight.setValue(F.bits(sel.max));
        this.__details.setHtml(grid([
          [row("Gönder", F.bits(n.tx)), row("Al", F.bits(n.rx))],
          [row("Bağdaştırıcı adı", F.esc(name)), row("Bağlantı türü", info.wireless ? "802.11 (Wi-Fi)" : "Ethernet"),
            row("Durum", n.up ? "Bağlı" : "Bağlı değil"), row("Bağlantı hızı", /^\d+$/.test(n.speed || "") && Number(n.speed) > 0 ? n.speed + " Mbps" : "—"),
            row("Sürücü", F.esc(info.driver || "—"))]
        ]));
      } else {
        const i = Number(sel.key.slice(4));
        const g = (st.gpus || [])[i] || {};
        const cur = (s.gpus || [])[i] || {};
        this.__model.setValue(F.esc(g.name || ""));
        const measured = cur.busy !== null && cur.busy !== undefined;
        this.__axisLeft.setValue(measured ? "% Kullanım" : "Çalışma frekansı (MHz)");
        this.__axisRight.setValue(measured ? "%100" : (sel.max + " MHz"));
        this.__details.setHtml(grid([
          [row("Kullanım", measured ? F.pct(cur.busy, 0) : "Bu sürücüde okunamıyor"),
            row("Frekans", cur.mhz ? cur.mhz + " MHz" : "—"),
            row("Ayrılmış bellek", cur.vram_used ? F.sizeB(cur.vram_used) + (g.vram ? " / " + F.sizeB(g.vram) : "") : "Paylaşılan (sistem belleği)")],
          [row("Sürücü", F.esc(g.driver || "—")), row("Aygıt", F.esc(g.card || "—"))]
        ]));
      }
    },

    __drawCores(m) {
      const n = m.hist.cores.length;
      const cols = Math.ceil(Math.sqrt(n));
      while (this.__coreGraphs.length < n) {
        const i = this.__coreGraphs.length;
        const g = new tihamon.ui.taskmgr.Graph("cpu", true);
        this.__cores.add(g, { row: Math.floor(i / cols), column: i % cols });
        this.__cores.getLayout().setRowFlex(Math.floor(i / cols), 1);
        this.__cores.getLayout().setColumnFlex(i % cols, 1);
        this.__coreGraphs.push(g);
      }
      m.hist.cores.forEach((series, i) => this.__coreGraphs[i].setData([series], 100));
    }
  }
});
