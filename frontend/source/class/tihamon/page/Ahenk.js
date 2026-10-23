/**
 * Bakım ▸ Ahenk: tahtaların son "Ahenk kontrol" sonuçları (hazır işlem actions/ahenk-check — araç
 * enseitankado/ahenk-debug, --json --no-send). Her tahta bir satır; hiç kontrol edilmemiş tahta da görünür.
 * Veri /api/ahenk (backend AhenkApi); rapor worker executor/ahenk.py tarafından tahtadan okunup yazılır.
 *
 * "Ahenk kontrol" düğmeleri hazır işlemi işaretli / çevrim içi tüm tahtalarda başlatır (canlı çıktı
 * penceresi açılır); sayfa açıkken 15 sn'de bir tazelenir, sonuçlar geldikçe tabloya düşer. Çift tıklama
 * ya da "Raporu göster": o tahtanın bulguları (tümü) ve ham raporu (seçilebilir, kopyalanabilir).
 */
qx.Class.define("tihamon.page.Ahenk", {
  extend: tihamon.page.Base,

  statics: {
    REFRESH_MS: 15000,
    RESULT: { 0: "✓ Sorun yok", 1: "! Uyarı", 2: "✗ Kritik" }
  },

  construct(user) {
    super(user, null);
    this._addButton("Yenile", () => this.refresh());
    if (this._can("actions")) {
      this._addButton("İşaretlilerde Ahenk kontrol", () => this.__run(false))
        .set({ toolTipText: "İşaretli (çevrim içi) tahtalarda ahenk-debug çalıştırır" });
      this._addButton("Çevrim içi tümünde Ahenk kontrol", () => this.__run(true))
        .set({ toolTipText: "O an çevrim içi bütün tahtalarda ahenk-debug çalıştırır" });
    }
    this.__detail = this._addButton("Raporu göster", () => this.__showReport(this.__selectedRow()));
    this.__note = new qx.ui.basic.Label("").set({ rich: true, textColor: "app-muted" });
    this.add(this.__note);

    this.__table = this._createTable([
      { id: "name", label: "Tahta", width: 190 },
      { id: "checked", label: "Son kontrol", width: 110 },
      { id: "result", label: "Sonuç", width: 105 },
      { id: "problems", label: "Bulgular (kritik/uyarı)", width: 300 },
      { id: "version", label: "Ahenk sürümü", width: 110 },
      { id: "service", label: "Servis", width: 110 },
      { id: "registered", label: "Lider kaydı (yerel)", width: 120 },
      { id: "lider", label: "Lider (sunucu)", width: 120 },
      { id: "live", label: "Canlı bağlantı", width: 105 },
      { id: "probe", label: "Pulsar testi", width: 170 },
      { id: "mac", label: "Kimlik MAC'i", width: 160 },
      { id: "school", label: "Okul (ETA kaydı)", width: 220 },
      { id: "where", label: "İl / ilçe", width: 150 },
      { id: "phase", label: "Faz", width: 70 },
      { id: "online", label: "Durum", width: 90 }
    ], { checkable: true, prefsKey: "ahenk.columns" });
    this.__table.addListener("cellDbltap", e => this.__showReport(this.__rowAt(e.getRow())));
    this.__table.getSelectionModel().addListener("changeSelection", () => this.__detail.setEnabled(!!this.__selectedRow()));
    this.__detail.setEnabled(false);
    this.add(this.__table, { flex: 1 });

    this.__timer = new qx.event.Timer(tihamon.page.Ahenk.REFRESH_MS);
    this.__timer.addListener("interval", () => {
      if (this.isSeeable()) {
        this.refresh();
      }
    });
    this.__timer.start();
  },

  destruct() {
    this.__timer.stop();
    this.__timer.dispose();
  },

  members: {
    __table: null,
    __note: null,
    __detail: null,
    __timer: null,
    __boards: null,

    __rowAt(row) {
      if (row === null || row === undefined || !this.__boards) {
        return null;
      }
      const id = this.__table.getTableModel().getValue(0, row);
      return this.__boards.find(b => b.id === id) || null;
    },

    __selectedRow() {
      let found = null;
      this.__table.getSelectionModel().iterateSelection(row => {
        found = found || this.__rowAt(row);
      });
      return found;
    },

    async _refresh() {
      const data = await tihamon.io.Api.get("/ahenk");
      const R = tihamon.page.Ahenk.RESULT;
      const F = tihamon.util.Format;
      const checked = new Set(this._checkedIds(this.__table));
      this.__boards = data.boards;
      const model = this.__table.getTableModel();
      model.setData(data.boards.map(b => {
        const s = b.summary || {};
        const has = b.checked_at !== null;
        return [
          b.id, checked.has(b.id), b.name,
          has ? F.ago(b.checked_at) : "hiç",
          has ? (R[b.exit_code] || String(b.exit_code)) : "—",
          (s.problems || []).join(" · "),
          s.ahenk_version || (has ? "kurulu değil" : ""),
          has ? `${s.service_active || "—"}${s.service_enabled ? " / " + s.service_enabled : ""}` : "",
          has ? (String(s.registered) === "1" || s.registered === true ? "✓ kayıtlı" : "✗ " + (s.registered ?? "yok")) : "",
          s.lider_server || "",
          has ? (s.live_count > 0 ? `✓ ${s.live_count} TCP` : "✗ yok") : "",
          s.probe || "",
          s.identity_mac ? s.identity_mac + (s.mac_match === false ? " ✗ kayıtlı: " + s.registered_mac : "") : "",
          s.school ? `${s.school}${s.school_code ? " (" + s.school_code + ")" : ""}${s.unit ? " · " + s.unit : ""}` : "",
          [s.city, s.town].filter(Boolean).join(" / "),
          typeof s.phase === "object" && s.phase ? (s.phase.phase || s.phase.name || "") : (s.phase || ""),
          b.online ? "Çevrim içi" : "Çevrim dışı"
        ];
      }));
      const done = data.boards.filter(b => b.checked_at !== null);
      const count = code => done.filter(b => b.exit_code === code).length;
      this.__note.setValue(done.length
        ? `${done.length}/${data.boards.length} tahta kontrol edildi · ${count(0)} sorunsuz · ${count(1)} uyarılı · ` +
          `<span style="color:#c42b1c">${count(2)} kritik</span> · rapor tahtadan alınır, dışarıya gönderilmez`
        : "Henüz Ahenk kontrolü yapılmadı. Tahtaları işaretleyip \"İşaretlilerde Ahenk kontrol\" ya da \"Çevrim içi tümünde\" ile başlatın.");
    },

    __run(all) {
      const boards = (this.__boards || []).filter(b => b.online && (all || this._checkedIds(this.__table).includes(b.id)));
      if (!boards.length) {
        tihamon.ui.Dialog.alert(all ? "Çevrim içi tahta yok." : "Önce çevrim içi bir ya da daha fazla tahta işaretleyin.");
        return;
      }
      tihamon.ui.Jobs.show(tihamon.io.Api.post("/jobs", {
        type: "action", action: "ahenk-check", board_ids: boards.map(b => b.id), values: { KAPSAM: "tam" }
      }).then(res => res.id), `Ahenk kontrol — ${boards.length} tahta`);
    },

    async __showReport(board) {
      if (!board) {
        return;
      }
      if (board.checked_at === null) {
        tihamon.ui.Dialog.alert("Bu tahtada henüz Ahenk kontrolü yapılmadı.");
        return;
      }
      let data;
      try {
        data = await tihamon.io.Api.get("/ahenk/" + board.id);
      } catch (e) {
        tihamon.ui.Dialog.error(e);
        return;
      }
      const esc = qx.bom.String.escape;
      const F = tihamon.util.Format;
      const SEV = { FAIL: ["✗ Kritik", "#c42b1c"], WARN: ["! Uyarı", "#b7791f"], OK: ["✓ Tamam", "#2e7d32"], INFO: ["ℹ Bilgi", ""] };
      const findings = (data.report.findings || []);
      const cell = "padding:4px 8px;border-bottom:1px solid rgba(128,128,128,.25);vertical-align:top;overflow-wrap:anywhere;text-align:left";
      const html = '<table style="border-collapse:collapse;width:100%;table-layout:fixed"><col style="width:90px"><col style="width:34%"><col>' +
        findings.map(f => {
          const [label, color] = SEV[f.severity] || [f.severity, ""];
          return `<tr><td style="${cell};white-space:nowrap${color ? ";color:" + color : ""}">${esc(label)}</td>` +
            `<td style="${cell};font-weight:bold">${esc(String(f.title ?? ""))}</td>` +
            `<td style="${cell};white-space:pre-wrap">${esc(String(f.detail ?? ""))}</td></tr>`;
        }).join("") + "</table>";
      const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
      const win = tihamon.ui.Dialog.window(`Ahenk raporu — ${board.name}`, Math.min(1100, root.width - 40), { maximizable: true });
      win.set({ height: Math.min(760, root.height - 40) });
      win.add(new qx.ui.basic.Label(
        `${esc(tihamon.page.Ahenk.RESULT[data.exit_code] || String(data.exit_code))} · ${esc(F.dateTime(data.checked_at * 1000))}` +
        ` · ahenk-debug ${esc((data.tool_commit || "").slice(0, 7))} · ${findings.length} bulgu`).set({ rich: true, selectable: true }));
      const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
      body.add(new qx.ui.basic.Label(html).set({ rich: true, wrap: true, selectable: true, allowGrowX: true }));
      win.add(new qx.ui.container.Scroll(body), { flex: 1 });
      const json = JSON.stringify(data.report, null, 2);
      const copyJson = new qx.ui.form.Button("Ham raporu (JSON) kopyala");
      copyJson.addListener("execute", () => tihamon.util.Clipboard.copy(json));
      const copyText = new qx.ui.form.Button("Bulguları kopyala");
      copyText.addListener("execute", () => tihamon.util.Clipboard.copy(`Ahenk raporu — ${board.name}\n` +
        findings.map(f => `[${f.severity}] ${f.title}${f.detail ? "\n    " + String(f.detail).replace(/\n/g, "\n    ") : ""}`).join("\n")));
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      tihamon.ui.Dialog.buttons(win, [copyText, copyJson, close]);
      win.open();
    }
  }
});
