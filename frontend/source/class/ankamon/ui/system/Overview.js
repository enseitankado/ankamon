/** Sistem → Genel: konteyner, kaynaklar ve bileşen sürümleri (/api/system/overview). */
qx.Class.define("ankamon.ui.system.Overview", {
  extend: ankamon.ui.system.Tab,

  construct(page) {
    super(page, "Genel");
    const { label, scroll } = ankamon.ui.system.Html.box();
    this.__label = label;
    this.add(scroll, { flex: 1 });
  },

  members: {
    __label: null,

    async _load() {
      const d = await ankamon.io.Api.get("/system/overview");
      const F = ankamon.util.Format;
      const H = ankamon.ui.system.Html;
      const pct = (part, total) => (part !== null && total ? Math.round(100 * part / total) : null);
      const freeDisk = pct(d.disk.free, d.disk.total);
      const freeMem = pct(d.mem_available, d.mem_total);
      const uptime = d.container_started_at ? Math.floor((Date.now() - d.container_started_at) / 1000) : null;
      const days = uptime !== null ? Math.floor(uptime / 86400) : 0;
      this.__label.setValue(H.keyValue([
        {
          title: "Konteyner", rows: [
            ["Ana makine", d.hostname],
            ["Çalışma süresi", uptime !== null ? (days ? `${days} gün ` : "") + F.duration(uptime % 86400) : null],
            ["Başlatıldı", F.dateTime(d.container_started_at)],
            ["Arayüz derlemesi", F.dateTime(d.build_at)]
          ]
        },
        {
          title: "Kaynaklar", rows: [
            ["İşlemci", d.cpus ? `${d.cpus} çekirdek` + (d.load ? ` · yük ${d.load.map(v => v.toFixed(2)).join(" / ")} (1/5/15 dk)` : "") : null],
            ["Bellek (ana makine)", d.mem_total ? { html: H.badge(`${F.bytes(d.mem_available)} boş / ${F.bytes(d.mem_total)} (%${freeMem})`,
              freeMem < 10 ? "bad" : freeMem < 20 ? "warn" : "ok") } : null],
            ["Veri diski (/data)", d.disk.total ? { html: H.badge(`${F.bytes(d.disk.free)} boş / ${F.bytes(d.disk.total)} (%${freeDisk})`,
              freeDisk < 10 ? "bad" : freeDisk < 20 ? "warn" : "ok") } : null],
            ["Veritabanı boyutu", F.bytes(d.db_size)]
          ]
        },
        { title: "Bileşen sürümleri", rows: d.versions.map(v => [v.name, v.version]) }
      ]));
    }
  }
});
