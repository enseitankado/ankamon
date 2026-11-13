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
 * Sistem ▸ Zamanlanmış işler'in "Görevler" ve "Sonuçlar" bölümleri (kullanıcı isteği 2026-11-13; API SchedulesApi,
 * worker tasks/user_schedules.py):
 *   - Görevler: kullanıcı tanımlı zamanlamalar — Yeni / Düzenle (çift tık) / Şimdi çalıştır / Etkinleştir-Durdur / Sil.
 *   - Sonuçlar: zamanlanmış görevlerin her çalıştırması ve Ankamon'un kendi otomatik görevleri (ör. haftalık otomatik
 *     SSH denetimi) — cihaz başına başarılı/hatalı/ulaşılamadı sayıları; çift tık görev çıktısını açar (ui.Jobs),
 *     SSH denetimi ve anomali taraması sonuçları ayrıca Sağlık ▸ Denetle'de (sağ menü) — olağan yerlerine de yansır.
 */
qx.Class.define("ankamon.ui.system.UserSchedules", {
  extend: qx.core.Object,

  /** @param page {ankamon.page.Base} tablo yardımcıları */
  construct(page) {
    super();
    this.__page = page;
    this.tasks = this.__buildTasks();
    this.results = this.__buildResults();
  },

  members: {
    /** @type {qx.ui.container.Composite} Görevler bölmesi */
    tasks: null,
    /** @type {qx.ui.container.Composite} Sonuçlar bölmesi */
    results: null,
    __page: null,
    __table: null,
    __runs: null,
    __schedules: null,
    __runsData: null,
    __types: null,
    __buttons: null,
    __timer: null,

    __buildTasks() {
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
      const B = (label, fn, tip) => {
        const b = new qx.ui.form.Button(label).set({ padding: [3, 10], toolTipText: tip || null });
        b.addListener("execute", fn, this);
        bar.add(b);
        return b;
      };
      this.__buttons = {
        add: B("＋ Yeni görev", () => this.__edit(null), "Hazır işlem, komut, SSH denetimi, anomali taraması… zamanla"),
        edit: B("Düzenle", () => this.__edit(this.__selected())),
        run: B("▸ Şimdi çalıştır", () => this.__runNow(), "Zamanlamaya dokunmadan bir kez çalıştırır"),
        toggle: B("Durdur", () => this.__toggle()),
        del: B("Sil", () => this.__delete())
      };
      box.add(bar);
      this.__table = this.__page._createTable([
        { id: "name", label: "Görev", width: 210 },
        { id: "type", label: "Tür", width: 150 },
        { id: "what", label: "Ayrıntı", width: 220 },
        { id: "target", label: "Hedef", width: 200 },
        { id: "when", label: "Zaman", width: 210 },
        { id: "next", label: "Sonraki", width: 140 },
        { id: "last", label: "Son çalışma", width: 140 },
        { id: "result", label: "Son sonuç", width: 170 },
        { id: "state", label: "Durum", width: 80 }
      ], { prefsKey: "system.userSchedules.columns", filterable: true });
      this.__table.getSelectionModel().addListener("changeSelection", () => this.__sync());
      this.__table.addListener("cellDbltap", () => this.__edit(this.__selected()));
      box.add(this.__table, { flex: 1 });
      this.__sync();
      return box;
    },

    __buildResults() {
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
      box.add(new qx.ui.basic.Label("Zamanlanmış görevlerin ve Ankamon'un otomatik görevlerinin son 30 günlük çalıştırmaları. " +
        "Çift tık: görev çıktısı. SSH denetimi ve anomali taraması sonuçları Sağlık ekranlarına da yansır (sağ menü ▸ Sağlık ▸ Denetle).")
        .set({ rich: true, wrap: true, textColor: "app-muted" }));
      this.__runs = this.__page._createTable([
        { id: "time", label: "Zaman", width: 140 },
        { id: "name", label: "Görev", width: 230 },
        { id: "source", label: "Kaynak", width: 150 },
        { id: "type", label: "Tür", width: 140 },
        { id: "status", label: "Durum", width: 100 },
        { id: "devices", label: "Cihaz", width: 60 },
        { id: "ok", label: "Başarılı", width: 70 },
        { id: "bad", label: "Hatalı", width: 60 },
        { id: "unreach", label: "Ulaşılamadı", width: 85 },
        { id: "summary", label: "Özet" }
      ], { prefsKey: "system.scheduleRuns.columns", filterable: true });
      this.__runs.addListener("cellDbltap", () => this.__openRun(this.__selectedRun()));
      this.__runs.addListener("cellContextmenu", e => this.__runMenu(e.getRow()));
      box.add(this.__runs, { flex: 1 });
      return box;
    },

    async load() {
      const d = await ankamon.io.Api.get("/schedules");
      this.__types = d.types;
      this.__schedules = d.schedules;
      this.__runsData = d.runs;
      const F = ankamon.util.Format;
      const at = sec => (sec ? F.dateTime(sec * 1000) : "");
      this.__table.getTableModel().setData(d.schedules.map((s, i) => [
        i, s.name, d.types[s.job_type] || s.job_type, this.__what(s),
        s.target_mode === "all_online" ? "Çevrimiçi bütün cihazlar" : `${s.device_ids.length} cihaz: ${s.device_names || ""}`,
        this.__when(s), s.run_requested ? "şimdi (elle)…" : s.enabled ? (s.next_run_at ? at(s.next_run_at) : "hesaplanıyor…") : "—",
        at(s.last_run_at), s.last_status ? F.jobStatus(s.last_status) + (s.last_summary ? " · " + s.last_summary : "") : "",
        s.enabled ? "Etkin" : "Durdu"
      ]));
      const typeName = t => d.types[t] || { diagnose: "SSH denetimi (tam)", anomaly_scan: "Anomali taraması" }[t] || t || "";
      this.__runs.getTableModel().setData(d.runs.map((r, i) => [
        i, at(r.fired_at), r.source === "auto" ? r.title : r.name,
        r.source === "auto" ? "Ankamon (otomatik)" : r.manual ? "Zamanlanmış (elle)" : "Zamanlanmış",
        typeName(r.type), r.job_id ? F.jobStatus(r.status) : "çalışmadı",
        r.job_id ? Number(r.targets) : 0, Number(r.ok || 0), Number(r.failed || 0), Number(r.unreachable || 0),
        r.note || r.summary || ""
      ]));
      this.__sync();
      // Bekleyen hesap/elle çalıştırma varsa kısa süre sonra yeniden okunur (worker ≤10 sn).
      const pending = d.schedules.some(s => s.run_requested || (s.enabled && !s.next_run_at));
      if (pending && !this.__timer) {
        this.__timer = qx.event.Timer.once(() => {
          this.__timer = null;
          if (this.tasks.isSeeable() || this.results.isSeeable()) {
            this.load().catch(() => {});
          }
        }, this, 4000);
      }
    },

    /** Kısa ayrıntı: hazır işlemin adı, komutun ilk satırı, anomali türü sayısı. */
    __what(s) {
      const r = s.job_request || {};
      if (s.job_type === "action") {
        return s.job_title;
      }
      if (s.job_type === "command") {
        const c = r.commands || {};
        return (c.linux || c.windows || c.macos || r.command || "").split("\n")[0].slice(0, 80);
      }
      if (s.job_type === "anomaly_scan") {
        return `${(r.kinds || []).length} denetim`;
      }
      return "";
    },

    __when(s) {
      const D = ankamon.ui.system.ScheduleEditor.DAYS;
      if (s.repeat === "once") {
        return "Bir kez: " + ankamon.util.Format.dateTime(s.run_at * 1000);
      }
      if (s.repeat === "interval") {
        const m = s.interval_minutes;
        return "Her " + (m % 1440 === 0 ? `${m / 1440} gün` : m % 60 === 0 ? `${m / 60} saat` : `${m} dk`);
      }
      const w = s.weekdays || [];
      const days = w.length === 7 ? "Her gün" : w.join() === "1,2,3,4,5" ? "Hafta içi" : w.join() === "6,7" ? "Hafta sonu"
        : w.map(d => D[d - 1]).join(", ");
      return `${days} ${s.time_of_day}`;
    },

    __selected() {
      const sel = this.__table.getSelectionModel();
      if (sel.isSelectionEmpty()) {
        return null;
      }
      return this.__schedules[this.__table.getTableModel().getValue(0, sel.getLeadSelectionIndex())] || null;
    },

    __selectedRun() {
      const sel = this.__runs.getSelectionModel();
      if (sel.isSelectionEmpty()) {
        return null;
      }
      return this.__runsData[this.__runs.getTableModel().getValue(0, sel.getLeadSelectionIndex())] || null;
    },

    __sync() {
      const s = this.__selected();
      const b = this.__buttons;
      ["edit", "run", "toggle", "del"].forEach(k => b[k].setEnabled(!!s));
      b.toggle.setLabel(s && !s.enabled ? "Etkinleştir" : "Durdur");
    },

    __edit(s) {
      if (!this.__types) {
        return;
      }
      ankamon.ui.system.ScheduleEditor.open(s, this.__types, () => this.load().catch(e => ankamon.ui.Dialog.error(e)));
    },

    async __runNow() {
      const s = this.__selected();
      if (!s) {
        return;
      }
      const ok = await ankamon.ui.Dialog.confirm(`<b>${qx.bom.String.escape(s.name)}</b> şimdi bir kez çalıştırılacak ` +
        "(zamanlaması değişmez). Sonuç birkaç saniye içinde Sonuçlar'da görünür.", "Çalıştır");
      if (!ok) {
        return;
      }
      try {
        await ankamon.io.Api.post(`/schedules/${s.id}/run`, {});
        await this.load();
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async __toggle() {
      const s = this.__selected();
      if (!s) {
        return;
      }
      try {
        await ankamon.io.Api.put(`/schedules/${s.id}/enabled`, { enabled: !s.enabled });
        await this.load();
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async __delete() {
      const s = this.__selected();
      if (!s) {
        return;
      }
      const ok = await ankamon.ui.Dialog.confirm(`<b>${qx.bom.String.escape(s.name)}</b> zamanlanmış görevi silinsin mi? ` +
        "Geçmiş çalıştırmaları Sonuçlar'da kalır.", "Sil");
      if (!ok) {
        return;
      }
      try {
        await ankamon.io.Api.del(`/schedules/${s.id}`);
        await this.load();
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    __openRun(r) {
      if (r && r.job_id) {
        ankamon.ui.Jobs.show(r.job_id, `Görev çıktısı — ${r.source === "auto" ? r.title : r.name}`);
      }
    },

    /** Sonuçlar satırı sağ menüsü (Dashboard'daki kalıp: satır seçilir, tablonun kendi bağlam menüsü kurulur). */
    __runMenu(row) {
      const table = this.__runs;
      const old = table.getContextMenu();
      if (old) {
        qx.event.Timer.once(() => old.destroy(), null, 0);
      }
      if (row === null || row === undefined || row < 0) {
        table.setContextMenu(null);
        return;
      }
      table.getSelectionModel().setSelectionInterval(row, row);
      const r = this.__selectedRun();
      if (!r) {
        table.setContextMenu(null);
        return;
      }
      const menu = new qx.ui.menu.Menu();
      const item = (label, fn, enabled = true) => {
        const b = new qx.ui.menu.Button(label).set({ enabled });
        b.addListener("execute", fn);
        menu.add(b);
      };
      item("Görev çıktısını aç", () => this.__openRun(r), !!r.job_id);
      if (r.type === "diagnose" || r.type === "anomaly_scan") {
        item("Sağlık ▸ Denetle'de göster", () => qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_PAGE,
          { page: "anomalies", tab: "reports" }));
      }
      if (r.schedule_id) {
        const s = (this.__schedules || []).find(x => x.id === r.schedule_id);
        item("Zamanlanmış görevi düzenle", () => this.__edit(s), !!s);
      }
      table.setContextMenu(menu);
    }
  }
});
