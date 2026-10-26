/** Sistem → Veritabanı (/api/system/database): boyut, bağlantılar, hypertable'lar (sıkıştırma kazancı), tablolar. */
qx.Class.define("ankamon.ui.system.Database", {
  extend: ankamon.ui.system.Tab,

  construct(page) {
    super(page, "Veritabanı");
    const { label, scroll } = ankamon.ui.system.Html.box();
    this.__label = label;
    this.add(scroll, { flex: 1 });
  },

  members: {
    __label: null,

    async _load() {
      const d = await ankamon.io.Api.get("/system/database");
      const F = ankamon.util.Format;
      const H = ankamon.ui.system.Html;
      const total = d.connections.reduce((sum, c) => sum + Number(c.n), 0);
      const usage = Math.round(100 * total / d.max_connections);
      this.__label.setValue(H.keyValue([
        {
          title: "Genel", rows: [
            ["Sürüm", `PostgreSQL ${d.version}`],
            ["Toplam boyut", F.bytes(d.size)],
            ["Bağlantılar", { html: H.badge(`${total} / ${d.max_connections} (%${usage})`, usage > 80 ? "bad" : usage > 60 ? "warn" : "ok") }]
          ]
        },
        {
          title: "Zaman serisi tabloları (TimescaleDB)", rows: d.hypertables.map(h => [h.name,
            `${F.bytes(h.bytes)} · ${h.chunks} parça` + (h.before && h.after
              ? ` · sıkıştırılan kısım ${F.bytes(h.before)} → ${F.bytes(h.after)} (×${(h.before / h.after).toFixed(1)})`
              : h.compression ? " · henüz sıkıştırılmış parça yok" : "")])
        },
        { title: "En büyük tablolar", rows: d.tables.map(t => [t.name, `${F.bytes(t.bytes)} · ~${t.rows} satır`]) },
        { title: "Bağlantılar (kullanıcı · uygulama · durum)", rows: d.connections.map(c => [`${c.user} · ${c.application}`, `${c.state}: ${c.n}`]) }
      ]));
    }
  }
});
