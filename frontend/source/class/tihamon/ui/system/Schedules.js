/**
 * Sistem → Zamanlanmış işler (/api/system/jobs): TimescaleDB politikaları (sıkıştırma, saklama, özet
 * yenileme — son çalışma, durum, sonraki), rutin yedekleme ve arka plan görevlerinin ilerleme kayıtları.
 * Seçili bir politika "Şimdi çalıştır" ile hemen tetiklenebilir.
 */
qx.Class.define("tihamon.ui.system.Schedules", {
  extend: tihamon.ui.system.Tab,

  construct(page) {
    super(page, "Zamanlanmış işler");
    this.__run = new qx.ui.form.Button("▸ Şimdi çalıştır").set({ enabled: false });
    this.__run.addListener("execute", () => this.__runNow());
    this._bar.addAt(this.__run, 0);

    this.__table = page._createTable([
      { id: "kind", label: "İş", width: 170 },
      { id: "table", label: "Tablo", width: 130 },
      { id: "config", label: "Ayar", width: 190 },
      { id: "schedule", label: "Aralık", width: 90 },
      { id: "last", label: "Son çalışma", width: 150 },
      { id: "status", label: "Durum", width: 110 },
      { id: "next", label: "Sonraki", width: 150 },
      { id: "runs", label: "Çalışma / hata", width: 110 }
    ]);
    this.__table.getSelectionModel().addListener("changeSelection", () => {
      const p = this.__selected();
      this.__run.setEnabled(!!p && p.runnable);
    });
    this.add(this.__table, { flex: 1 });

    const { label, scroll } = tihamon.ui.system.Html.box();
    this.__info = label;
    scroll.setHeight(190);
    this.add(scroll);
  },

  members: {
    __table: null,
    __run: null,
    __info: null,
    __policies: null,

    async _load() {
      const d = await tihamon.io.Api.get("/system/jobs");
      const F = tihamon.util.Format;
      const H = tihamon.ui.system.Html;
      this.__policies = d.policies;
      this.__table.getTableModel().setData(d.policies.map((p, i) => [
        i, p.kind, p.hypertable || "—", tihamon.ui.system.Schedules.configText(p.config), p.schedule,
        F.dateTime(p.last_run), !p.scheduled ? "Kapalı" : p.last_run_status === "Failed" ? "Hatalı" : p.last_run_status === "Success" ? "Başarılı" : (p.job_status || "—"),
        F.dateTime(p.next_start), `${p.total_runs ?? 0} / ${p.total_failures ?? 0}`
      ]));

      const b = d.backup;
      const kinds = { full: "Tam yedek", config: "Yapılandırma yedeği", grafana: "Grafana yedeği" };
      const sections = [{
        title: "Rutin yedekleme (backup servisi)", rows: b ? [
          ["Plan", `yapılandırma ${b.config_every_hours} saatte bir, tam yedek her gün ${b.full_at} · saklanan: ${b.keep_config} yapılandırma, ${b.keep_full} tam`],
          ...Object.keys(kinds).map(k => [kinds[k], b.latest[k] ? `${F.dateTime(b.latest[k].mtime)} · ${F.bytes(b.latest[k].bytes)}` : { html: H.badge("hiç yok", "warn") }]),
          ["Özet güncellendi", F.dateTime(b.updated)]
        ] : [["Durum", { html: H.badge("yedek özeti yok — backup servisi çalışmıyor olabilir", "bad") }]]
      }, {
        title: "Arka plan görevleri (worker)", rows: [
          ["Son etkinlik", d.last_activity ? `${F.dateTime(d.last_activity.time)} — ${d.last_activity.message}` : "—"],
          ...d.cursors.map(c => [`İlerleme: ${c.name}`, `${F.dateTime(c.value)} (güncellendi ${F.dateTime(c.updated_at)})`])
        ]
      }];
      this.__info.setValue(H.keyValue(sections));
    },

    _statusText() {
      const failed = (this.__policies || []).filter(p => p.last_run_status === "Failed").length;
      return (failed ? tihamon.ui.system.Html.badge(`${failed} iş son çalışmada hata verdi`, "bad") + " · " : "") +
        "TimescaleDB politikaları veritabanının kendi zamanlayıcısıyla çalışır";
    },

    __selected() {
      const sel = this.__table.getSelectionModel();
      if (sel.isSelectionEmpty()) {
        return null;
      }
      return this.__policies[this.__table.getTableModel().getValue(0, sel.getLeadSelectionIndex())] || null;
    },

    async __runNow() {
      const p = this.__selected();
      if (!p || !p.runnable) {
        return;
      }
      const ok = await tihamon.ui.Dialog.confirm(
        `<b>${qx.bom.String.escape(p.kind)}</b> (${qx.bom.String.escape(p.hypertable || "—")}) şimdi çalıştırılacak. ` +
        "Büyük tablolarda birkaç dakika sürebilir ve veritabanına yük bindirir.", "Çalıştır");
      if (!ok) {
        return;
      }
      this.__run.setEnabled(false);
      this._status.setValue("Çalışıyor…");
      try {
        const res = await tihamon.io.Api.post("/system/jobs/run", { job_id: p.job_id });
        await this.load();
        this._status.setValue(`✓ ${qx.bom.String.escape(p.kind)} tamamlandı (${res.seconds} sn)`);
      } catch (e) {
        tihamon.ui.Dialog.error(e);
        await this.load();
      }
    }
  },

  statics: {
    /** Politika ayarının okunur özeti (ör. "7 days sonra sıkıştır"). */
    configText(c) {
      if (!c) {
        return "";
      }
      if (c.drop_after) {
        return `${c.drop_after} sonra sil`;
      }
      if (c.compress_after) {
        return `${c.compress_after} sonra sıkıştır`;
      }
      if (c.start_offset !== undefined) {
        return `son ${c.start_offset} … ${c.end_offset} arası`;
      }
      return "";
    }
  }
});
