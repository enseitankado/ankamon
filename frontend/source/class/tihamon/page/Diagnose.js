/**
 * Bakım (menüdeki adı; eski adı "Sorun tespiti"): YALNIZ tespit raporu (kullanıcı isteği — Tahtalar grid'i, Ekranlar vb. yok).
 *
 * Taramalar "diagnose" görevleridir (bkz. worker/tihamon/executor/diagnose.py): "Şimdi tara" o an
 * çevrimiçi TÜM tahtaları sırayla denetler; ayrıca worker kaynaklar müsaitken her tahtayı haftada en az
 * bir kez kendiliğinden tarar (bkz. worker/tihamon/tasks/diagnose_schedule.py). Raporlar /api/diagnose'dan
 * gelir (bkz. backend DiagnoseApi); "Rapor" seçicisinden önceki taramalar da açılabilir.
 *
 * Rapor tek tablodur: her tahta bir özet satırı, bulguları satıra tıklayınca hemen altında açılır
 * (varsayılan kapalı; başlıktaki ok tümünü açar/kapatır). Süzgeç (düzey + tahta) ikisine de uygulanır;
 * sunucuya gitmeden son rapor verisinden yeniden çizilir (bkz. __render).
 */
qx.Class.define("tihamon.page.Diagnose", {
  extend: tihamon.page.Base,

  construct(user) {
    // Başlık yok; düğmeler, rapor seçici, başlatılma bilgisi ve ilerleme tek satırda (kullanıcı isteği).
    super(user, null);
    this._actions.exclude();
    const top = new qx.ui.container.Composite(new qx.ui.layout.HBox(10).set({ alignY: "middle" }));
    const button = (label, handler) => {
      const b = new qx.ui.form.Button(label);
      b.addListener("execute", handler);
      top.add(b);
      return b;
    };
    button("Yenile", () => this.refresh());
    if (this._can("diagnose")) {
      button("Şimdi tara", () => this.__start())
        .set({ toolTipText: "O an çevrimiçi olan tüm tahtaları sırayla denetler" });
    }
    top.add(new qx.ui.basic.Label("Rapor:").set({ marginLeft: 8 }));
    this.__runBox = new qx.ui.form.SelectBox().set({ width: 380 });
    this.__runBox.addListener("changeSelection", () => {
      const it = this.__runBox.getSelection()[0];
      if (it && !this.__silent) {
        this.__follow(it.getModel());
      }
    });
    top.add(this.__runBox);
    this.__started = new qx.ui.basic.Label("").set({ rich: true });
    top.add(this.__started);
    this.__progress = new qx.ui.indicator.ProgressBar(0, 1).set({ width: 220, height: 14, visibility: "excluded" });
    top.add(this.__progress);
    this.__status = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    top.add(this.__status, { flex: 1 });
    this.add(top);

    this.__info = new qx.ui.basic.Label("").set({ rich: true, wrap: true });
    this.add(this.__info);
    this.add(this.__createReportFilter());

    this.__html = new qx.ui.embed.Html("").set({
      overflowX: "auto", overflowY: "auto", textColor: "text-primary-on-surface", backgroundColor: "surface",
      // "text" Tangible/Modern renk temalarında tanımlı değil (yazı siyah kalıyordu); bu ad tüm temalarda var.
      decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 4 })
    });
    this.add(this.__html, { flex: 1 });
    // Özet satırına (ya da başlıktaki tümü okuna) tıklama: o tahtanın ayrıntılarını aç/kapat (bkz. __render).
    this.__expanded = new Set();
    this.__html.addListener("tap", e => {
      const el = e.getOriginalTarget();
      const row = el && el.closest ? el.closest("[data-toggle]") : null;
      if (!row) {
        return;
      }
      const key = row.getAttribute("data-toggle");
      if (key === "*") {
        const all = this.__shownKeys || [];
        const open = all.some(k => !this.__expanded.has(k));
        all.forEach(k => (open ? this.__expanded.add(k) : this.__expanded.delete(k)));
      } else if (this.__expanded.has(key)) {
        this.__expanded.delete(key);
      } else {
        this.__expanded.add(key);
      }
      this.__render();
    });
  },

  statics: {
    LEVEL: {
      bad: { text: "Acil", color: "#c5221f" },
      warn: { text: "Dikkat", color: "#e37400" },
      info: { text: "Bilgi", color: "#1a73e8" },
      ok: { text: "Sorun yok", color: "#1e8e3e" }
    },
    ORDER: ["bad", "warn", "info", "ok"]
  },

  members: {
    __expanded: null,
    __shownKeys: null,
    __runBox: null,
    __progress: null,
    __status: null,
    __info: null,
    __started: null,
    __html: null,
    __levelBoxes: null,
    __boardBox: null,
    __jobId: null,
    __job: null,
    __schedule: null,
    __silent: false,

    /** Sayfa her açıldığında: rapor listesi + en son rapor (ya da seçili olan). */
    async _refresh() {
      const data = await tihamon.io.Api.get("/diagnose");
      this.__schedule = data.schedule;
      this.__fillRuns(data.runs);
      const sel = this.__runBox.getSelection()[0];
      if (sel) {
        this.__follow(sel.getModel());
      } else {
        this.__job = null;
        this.__render();
      }
    },

    __fillRuns(runs) {
      const F = tihamon.util.Format;
      const keep = this.__jobId;
      this.__silent = true;
      this.__runBox.removeAll().forEach(it => it.dispose());
      runs.forEach(r => {
        const who = r.auto ? "otomatik" : (r.created_by || "—");
        const state = ["queued", "running"].includes(r.status) ? " · sürüyor" : "";
        this.__runBox.add(new qx.ui.form.ListItem(`${F.dateTime(r.created_at * 1000)} · ${who} · ${r.targets} tahta${state}`, null, r.id));
      });
      const items = this.__runBox.getChildren();
      const pick = items.find(it => it.getModel() === keep) || items[0];
      if (pick) {
        this.__runBox.setSelection([pick]);
      }
      this.__silent = false;
    },

    async __start() {
      let res;
      try {
        res = await tihamon.io.Api.post("/jobs", { type: "diagnose", all_online: true });
      } catch (e) {
        tihamon.ui.Dialog.error(e);
        return;
      }
      this.__jobId = res.id;
      this.refresh(); // listeye yeni taramayı al ve izle
    },

    async __follow(jobId) {
      this.__jobId = jobId;
      let res;
      try {
        res = await tihamon.io.Api.get(`/diagnose/${jobId}`);
      } catch (e) {
        this.__status.setValue("Rapor alınamadı: " + qx.bom.String.escape(e.message || String(e)));
        return;
      }
      if (this.__jobId !== jobId || this.isDisposed()) {
        return;
      }
      this.__job = res.job;
      const targets = res.job.targets;
      const done = targets.filter(t => !["queued", "running"].includes(t.status)).length;
      const running = ["queued", "running"].includes(res.job.status);
      this.__progress.set({ maximum: Math.max(1, targets.length), value: done, visibility: running ? "visible" : "excluded" });
      this.__status.setValue(running ? `Denetleniyor: ${done} / ${targets.length} tahta tamamlandı…` : "");
      this.__updateBoardFilter(targets);
      this.__render();
      if (running) {
        qx.event.Timer.once(() => this.__follow(jobId), this, 1000);
      } else if (this.__wasRunning === jobId) {
        this.__wasRunning = null;
        this.refresh(); // bitti: listedeki "sürüyor" etiketi ve takvim güncellensin
      }
      if (running) {
        this.__wasRunning = jobId;
      }
    },

    __wasRunning: null,

    /**
     * Rapor seçicinin sağı: denetimin nasıl başlatıldığı (tarih zaten seçicide yazıyor — kullanıcı
     * isteği: zaman/aralık tekrarlanmaz).
     */
    __startedHtml() {
      const j = this.__job;
      if (!j) {
        return "Henüz tarama yapılmadı.";
      }
      return j.auto ? "Otomatik tarama (kaynaklar müsaitken)"
        : `Elle başlatan: <b>${qx.bom.String.escape(String(j.created_by || "—"))}</b>`;
    },

    /** Otomatik tarama takvimi. */
    __infoHtml() {
      const F = tihamon.util.Format;
      const esc = s => qx.bom.String.escape(String(s ?? ""));
      let s = "";
      const sc = this.__schedule;
      if (sc) {
        s += `<span style="opacity:.75">Otomatik tarama: her tahta en az ${sc.interval_days} günde bir, sunucu yükü ve ağ ` +
          "trafiği düşükken; tahta yalnız açıkken taranabilir.";
        if (sc.never_scanned) {
          s += ` Hiç taranmamış ${sc.never_scanned} tahta ilk uygun anda taranacak.`;
        } else if (sc.next_from) {
          s += ` Sıradaki: ${esc(F.dateTime(sc.next_from * 1000))} sonrasında uygun ilk an, en geç ${esc(F.dateTime(sc.next_by * 1000))}.`;
        }
        s += "</span>";
      }
      return s;
    },

    /** Süzgeç satırı: düzey (çoklu) + tahta. Değişince yalnız yeniden çizilir (sunucuya gidilmez). */
    __createReportFilter() {
      const L = tihamon.page.Diagnose.LEVEL;
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(12).set({ alignY: "middle" }));
      row.add(new qx.ui.basic.Label("Göster:"));
      this.__levelBoxes = {};
      tihamon.page.Diagnose.ORDER.forEach(level => {
        const box = new qx.ui.form.CheckBox(L[level].text).set({ value: true });
        box.addListener("changeValue", this.__render, this);
        this.__levelBoxes[level] = box;
        row.add(box);
      });
      row.add(new qx.ui.core.Spacer(12));
      row.add(new qx.ui.basic.Label("Tahta:"));
      this.__boardBox = new qx.ui.form.SelectBox().set({ width: 220 });
      this.__boardBox.add(new qx.ui.form.ListItem("Tüm tahtalar", null, null));
      this.__boardBox.addListener("changeSelection", this.__render, this);
      row.add(this.__boardBox);
      return row;
    },

    /** Tahta süzgecinin seçeneklerini rapordaki tahtalarla eşitler (seçim korunur). */
    __updateBoardFilter(targets) {
      const box = this.__boardBox;
      const current = box.getSelection()[0] ? box.getSelection()[0].getModel() : null;
      const have = box.getChildren().slice(1).map(it => it.getModel());
      const want = targets.slice().sort((a, b) => String(a.board).localeCompare(String(b.board), "tr"));
      if (have.length === want.length && want.every((t, i) => t.board_id === have[i])) {
        return;
      }
      box.removeListener("changeSelection", this.__render, this);
      box.getChildren().slice(1).forEach(it => {
        box.remove(it);
        it.dispose();
      });
      want.forEach(t => box.add(new qx.ui.form.ListItem(t.board, null, t.board_id)));
      const keep = box.getChildren().find(it => it.getModel() === current) || box.getChildren()[0];
      box.setSelection([keep]);
      box.addListener("changeSelection", this.__render, this);
    },

    __parse(t) {
      if (t.status !== "ok") {
        return null;
      }
      try {
        return JSON.parse(t.output || "{}");
      } catch (e) {
        return null;
      }
    },

    __render() {
      this.__started.setValue(this.__startedHtml());
      this.__info.setValue(this.__infoHtml());
      const targets = this.__job ? this.__job.targets : [];
      const F = tihamon.util.Format;
      const esc = s => qx.bom.String.escape(String(s ?? ""));
      const L = tihamon.page.Diagnose.LEVEL;
      const ORDER = tihamon.page.Diagnose.ORDER;
      const badge = level => `<span style="display:inline-block;min-width:68px;padding:1px 8px;border-radius:10px;` +
        `background:${L[level].color};color:#fff;font-weight:600;text-align:center">${L[level].text}</span>`;
      // Yalnız görev SÜRERKEN "Denetleniyor/Sırada": görev bittiyse (ör. yürütücü yeniden başladı) hâlâ
      // queued/running duran satır yarıda kalmıştır — sonsuza dek "Denetleniyor…" görünmesin.
      const jobRunning = !!this.__job && ["queued", "running"].includes(this.__job.status);
      const halted = t => !jobRunning && ["queued", "running"].includes(t.status);
      const pending = t => jobRunning && ["queued", "running"].includes(t.status);
      const rank = t => {
        if (pending(t)) {
          return 9;
        }
        const r = this.__parse(t);
        return r ? ORDER.indexOf(r.level) : -1; // bağlanılamayanlar en üstte
      };

      // Süzgeç: düzey + tahta. Bağlanılamayan = "Acil"; sürmekte/sırada olan her zaman görünür.
      const levels = new Set(ORDER.filter(l => this.__levelBoxes[l].getValue()));
      const boardSel = this.__boardBox.getSelection()[0];
      const boardId = boardSel ? boardSel.getModel() : null;
      const visibleChecks = t => {
        const r = this.__parse(t);
        return r ? r.checks.filter(c => levels.has(c.level)) : [];
      };
      const shown = t => {
        if (boardId !== null && t.board_id !== boardId) {
          return false;
        }
        if (pending(t)) {
          return true;
        }
        const r = this.__parse(t);
        if (!r) {
          return levels.has("bad");
        }
        return levels.has(r.level) || visibleChecks(t).length > 0;
      };
      const rows = targets.filter(shown)
        .sort((a, b) => rank(a) - rank(b) || String(a.board).localeCompare(String(b.board), "tr"));

      const css = "font:13px/1.45 sans-serif;padding:8px 10px 16px";
      const th = "text-align:left;padding:4px 8px;border-bottom:2px solid rgba(128,128,128,.4);white-space:nowrap";
      const td = "padding:4px 8px;border-bottom:1px solid rgba(128,128,128,.25);vertical-align:top";
      const when = t => {
        const r = this.__parse(t);
        const ts = (r && r.collected_at) || t.finished_at;
        return ts ? esc(F.dateTime(ts * 1000)) : "";
      };
      let h = `<div style="${css}">`;

      if (!targets.length) {
        h += "<p style=\"opacity:.7\">Rapor boş.</p></div>";
        this.__html.setHtml(h);
        return;
      }
      if (!rows.length) {
        h += "<p style=\"opacity:.7\">Seçili süzgece uyan tahta yok.</p></div>";
        this.__html.setHtml(h);
        return;
      }

      // Tek tablo: her tahta bir özet satırı; ayrıntılar (yalnız seçili düzeylerdeki bulgular) satırın hemen
      // altında, varsayılan KAPALI — satıra tıklayınca açılır (kullanıcı isteği). Açık olanlar __expanded'da
      // (tahta kimliği) tutulur; rapor tazelense, süzgeç değişse de korunur.
      const keyOf = t => String(t.board_id ?? t.board);
      const canOpen = t => !pending(t) && !!this.__parse(t);
      this.__shownKeys = rows.filter(canOpen).map(keyOf);
      const allOpen = this.__shownKeys.length && this.__shownKeys.every(k => this.__expanded.has(k));
      const arrow = open => `<span style="display:inline-block;width:14px;opacity:.7">${open ? "▾" : "▸"}</span>`;
      h += `<table style="border-collapse:collapse;width:100%"><tr>` +
        `<th style="${th};cursor:pointer;user-select:none" data-toggle="*" title="Tümünü aç/kapat">${arrow(allOpen)}Tahta</th>` +
        `<th style="${th}">Genel durum</th><th style="${th}">Acil</th>` +
        `<th style="${th}">Dikkat</th><th style="${th}">Bilgi</th><th style="${th}">Başlıca bulgu</th>` +
        `<th style="${th}">Denetim zamanı</th></tr>`;
      rows.forEach(t => {
        const r = this.__parse(t);
        const key = keyOf(t);
        const open = canOpen(t) && this.__expanded.has(key);
        let state, counts = ["", "", ""], top = "";
        if (pending(t)) {
          state = `<i style="opacity:.7">${t.status === "running" ? "Denetleniyor…" : "Sırada"}</i>`;
        } else if (halted(t)) {
          state = badge("warn") + " <span style=\"opacity:.8\">yarıda kaldı</span>";
          top = "Görev bu tahtada tamamlanamadan kesildi (ör. Tiha-Mon yeniden başlatıldı); denetimi yeniden çalıştırın.";
        } else if (!r) {
          state = badge("bad") + " <span style=\"opacity:.8\">bağlanılamadı</span>";
          top = esc(t.output || "");
        } else {
          state = badge(r.level);
          counts = ["bad", "warn", "info"].map(l => r.checks.filter(c => c.level === l).length || "");
          const worst = r.checks.find(c => c.level === r.level && r.level !== "ok");
          top = worst ? esc(`${worst.title}: ${worst.detail}`) : "";
        }
        const toggle = canOpen(t) ? ` data-toggle="${esc(key)}" style="cursor:pointer"` : "";
        h += `<tr${toggle}><td style="${td};font-weight:600;white-space:nowrap">` +
          `${canOpen(t) ? arrow(open) : "<span style=\"display:inline-block;width:14px\"></span>"}${esc(t.board)}` +
          `<div style="font-weight:normal;opacity:.65;padding-left:14px">${esc(t.ip || "")}</div></td><td style="${td}">${state}</td>` +
          counts.map(c => `<td style="${td};text-align:center">${c}</td>`).join("") +
          `<td style="${td}">${top}</td><td style="${td};white-space:nowrap">${when(t)}</td></tr>`;
        if (!open) {
          return;
        }
        // Ayrıntı satırı: tahtanın bulguları, girintili iç tablo.
        h += `<tr><td colspan="7" style="padding:2px 8px 12px 30px;border-bottom:1px solid rgba(128,128,128,.25)">` +
          `<table style="border-collapse:collapse;width:100%"><tr><th style="${th}">Düzey</th>` +
          `<th style="${th}">Denetim</th><th style="${th}">Bulgu</th><th style="${th}">Öneri</th></tr>`;
        const checks = visibleChecks(t);
        if (!checks.length) {
          h += `<tr><td colspan="4" style="${td};opacity:.7">Seçili düzeylerde bulgu yok.</td></tr>`;
        }
        let lastGroup = null;
        checks.forEach(c => {
          const group = c.group !== lastGroup ? `<div style="opacity:.65;font-size:12px">${esc(c.group)}</div>` : "";
          lastGroup = c.group;
          h += `<tr><td style="${td}">${badge(c.level)}</td><td style="${td}">${group}${esc(c.title)}</td>` +
            `<td style="${td}">${esc(c.detail)}</td><td style="${td}">${esc(c.advice || "")}</td></tr>`;
        });
        h += "</table></td></tr>";
      });
      h += "</table>";
      this.__html.setHtml(h + "</div>");
    }
  }
});
