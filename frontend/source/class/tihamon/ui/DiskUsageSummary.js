/**
 * Disk kullanımı sayfasının (bkz. page.DiskUsage) "Özet" sekmesi: her veri sekmesinin diskte
 * kapladığı alan bir daire grafikte (dilim = sekme) ve yanındaki listede. Dilime ya da liste
 * satırına tıklamak o sekmeyi açar. Boyutlar her sekmenin kendi uç noktasının toplamıdır
 * (spec.size(), bkz. ui.DiskUsage); sekme her göründüğünde tazelenir.
 */
qx.Class.define("tihamon.ui.DiskUsageSummary", {
  extend: qx.ui.tabview.Page,

  /**
   * @param specs {Array} ui.DiskUsage.specs() — sekmelerle aynı sırada
   * @param onSelect {Function} mode => o sekmeyi seç
   */
  construct(specs, onSelect) {
    super("Özet");
    this.__specs = specs;
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    const refresh = new qx.ui.form.Button("Tazele");
    refresh.addListener("execute", () => this.load());
    bar.add(refresh);
    this.__status = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    bar.add(this.__status, { flex: 1 });
    this.add(bar);

    this.__html = new qx.ui.embed.Html("").set({ overflowY: "auto" });
    this.add(this.__html, { flex: 1 });
    // Dilim/satır tıklaması: Html içeriği her çizimde yeniden yazıldığından olay kapsayıcıya bağlanır.
    this.__html.addListenerOnce("appear", () => {
      this.__html.getContentElement().getDomElement().addEventListener("click", e => {
        const hit = e.target.closest && e.target.closest("[data-mode]");
        if (hit) {
          onSelect(hit.getAttribute("data-mode"));
        }
      });
    });
    this.addListener("appear", () => this.load());
  },

  statics: {
    // Sekme sırasıyla dilim renkleri (açık ve koyu temada okunur, birbirinden ayrışan tonlar).
    COLORS: ["#1f77b4", "#ff7f0e", "#9467bd", "#2ca02c", "#8c564b", "#d62728", "#17becf", "#bcbd22"]
  },

  members: {
    __specs: null,
    __status: null,
    __html: null,
    __loading: false,

    async load() {
      if (this.__loading) {
        return;
      }
      this.__loading = true;
      this.__status.setValue("Yükleniyor…");
      try {
        // Biri hata verirse diğerleri yine gösterilir (dilimi olmaz, listede "—").
        const results = await Promise.all(this.__specs.map(spec => spec.size().catch(e => ({ error: e }))));
        const items = this.__specs.map((spec, i) => ({
          mode: spec.mode, label: spec.label, color: tihamon.ui.DiskUsageSummary.COLORS[i % 8],
          bytes: results[i].error ? null : results[i].bytes, error: results[i].error
        }));
        const disk = (results.find(r => r.disk) || {}).disk;
        this.__render(items, disk);
        const F = tihamon.util.Format;
        const total = items.reduce((sum, it) => sum + (it.bytes || 0), 0);
        this.__status.setValue(`Toplam ${F.bytes(total)}` + (disk && disk.total != null && disk.free != null
          ? ` · Disk (/data): toplam ${F.bytes(disk.total)}, boş ${F.bytes(disk.free)}` : "") +
          " · bir dilime ya da satıra tıklayınca o sekme açılır");
      } catch (e) {
        this.__status.setValue("");
        tihamon.ui.Dialog.error(e);
      } finally {
        this.__loading = false;
      }
    },

    __render(items, disk) {
      const F = tihamon.util.Format;
      const esc = qx.bom.String.escape;
      const total = items.reduce((sum, it) => sum + (it.bytes || 0), 0);
      const R = 120, C = 130;
      let svg;
      const shown = items.filter(it => it.bytes > 0);
      if (!total) {
        svg = `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2"/>` +
          `<text x="${C}" y="${C}" text-anchor="middle" dominant-baseline="middle" fill="currentColor" opacity=".6">Veri yok</text>`;
      } else if (shown.length === 1) {
        const it = shown[0];
        svg = `<circle data-mode="${it.mode}" cx="${C}" cy="${C}" r="${R}" fill="${it.color}" style="cursor:pointer">` +
          `<title>${esc(it.label)}: ${F.bytes(it.bytes)} (%100)</title></circle>`;
      } else {
        let angle = -Math.PI / 2; // saat 12'den, saat yönünde
        svg = shown.map(it => {
          const share = it.bytes / total;
          const a0 = angle, a1 = angle + share * 2 * Math.PI;
          angle = a1;
          const p = a => `${(C + R * Math.cos(a)).toFixed(2)} ${(C + R * Math.sin(a)).toFixed(2)}`;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          return `<path data-mode="${it.mode}" class="slice" d="M ${C} ${C} L ${p(a0)} A ${R} ${R} 0 ${large} 1 ${p(a1)} Z" ` +
            `fill="${it.color}" stroke="#fff" stroke-width="1.5" style="cursor:pointer">` +
            `<title>${esc(it.label)}: ${F.bytes(it.bytes)} (%${(share * 100).toFixed(1)})</title></path>`;
        }).join("");
      }
      const pct = it => it.bytes == null || !total ? "" : "%" + (it.bytes / total * 100).toFixed(1);
      const rows = items.map(it =>
        `<tr data-mode="${it.mode}" style="cursor:pointer">` +
        `<td style="padding:5px 8px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;` +
        `background:${it.color};vertical-align:middle;margin-right:8px"></span>${esc(it.label)}</td>` +
        `<td style="padding:5px 8px;text-align:right;white-space:nowrap">${it.error ? "—" : F.bytes(it.bytes)}</td>` +
        `<td style="padding:5px 8px;text-align:right;opacity:.7">${pct(it)}</td></tr>`).join("");
      this.__html.setHtml(
        `<style>.tm-du .slice:hover{opacity:.8}.tm-du tr[data-mode]:hover{background:rgba(127,127,127,.15)}</style>` +
        `<div class="tm-du" style="display:flex;flex-wrap:wrap;gap:32px;align-items:center;padding:12px">` +
        `<svg width="${2 * C}" height="${2 * C}" viewBox="0 0 ${2 * C} ${2 * C}" role="img" aria-label="Disk kullanımı dağılımı">${svg}</svg>` +
        `<table style="border-collapse:collapse;font-size:14px;min-width:300px">` +
        `<tr style="opacity:.7"><th style="text-align:left;padding:5px 8px">Veri</th><th style="text-align:right;padding:5px 8px">Boyut</th>` +
        `<th style="text-align:right;padding:5px 8px">Pay</th></tr>${rows}` +
        `<tr style="border-top:1px solid rgba(127,127,127,.4);font-weight:600"><td style="padding:5px 8px">Toplam</td>` +
        `<td style="padding:5px 8px;text-align:right">${F.bytes(total)}</td><td></td></tr></table></div>`);
    }
  }
});
