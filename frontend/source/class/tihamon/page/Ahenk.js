/**
 * Bakım ▸ Ahenk: tahtaların son "Ahenk kontrol" sonuçları (araç enseitankado/ahenk-debug; görev hazır işlem
 * actions/ahenk-check — "Komut çalıştır" listesinde görünmez, yalnız buradan başlatılır). Tahtalar grid'indeki
 * her tahta bir satır; hiç kontrol edilmemiş tahtanın "Son kontrol"ü "hiç". Veri /api/ahenk (AhenkApi); rapor
 * worker executor/ahenk.py tarafından tahtadan okunup yazılır.
 *
 * Her sütun sıralanabilir (başlığa tıklama) ve süzülebilir (başlıktaki kutu); hangi sütunların görüneceği
 * sağ üstteki sütun menüsünden. Süzgeçler, sıralama, sütun sırası/görünürlüğü kullanıcı başına sunucuda
 * saklanır (users.ui_prefs: ahenk.filters, ahenk.sort, ahenk.columns.*) ve girişte geri yüklenir.
 * Hücre ipuçları: Sonuç / Durum ayrıntılı açıklama, Pulsar testi neden atlandığı. Çift tıklama ya da
 * "Raporu göster": ahenk-debug'ın renkli ham çıktısı. Sayfa açıkken 15 sn'de bir tazelenir.
 */
qx.Class.define("tihamon.page.Ahenk", {
  extend: tihamon.page.Base,

  statics: {
    REFRESH_MS: 15000,
    RESULT: { 0: "✓ Sorun yok", 1: "! Uyarı", 2: "✗ Kritik" },
    RESULT_HINT: {
      0: "Sorun yok: ahenk-debug kritik ya da uyarı düzeyinde bulgu bulmadı.",
      1: "Uyarı: en az bir uyarı var, kritik bulgu yok. Ahenk çalışıyor ama dikkat gerektiren bir durum var.",
      2: "Kritik: en az bir kritik bulgu var. Tahta Lider'de çevrimdışı görünebilir ya da uzak komut kabul etmeyebilir."
    },
    // Sütun tanımları — kimlikler kalıcı tercihlerde (süzgeç/sıralama/görünürlük) anahtardır, değiştirmeyin.
    COLUMNS: [
      // Tahta açık mı (çalışıyor mu) — en başta (kullanıcı isteği); yeşil/gri nokta + ayrıntılı ipucu.
      { id: "online", label: "Durum", hint: "Tahta durumu (açık / kapalı)", width: 105 },
      { id: "name", label: "Tahta", width: 190 },
      { id: "checked", label: "Son kontrol", width: 110 },
      { id: "result", label: "Sonuç", width: 105 },
      { id: "problems", label: "Bulgular", hint: "Bulgular (kritik/uyarı)", width: 300 },
      { id: "version", label: "Ahenk", hint: "Ahenk sürümü", width: 80 },
      { id: "service", label: "Servis", width: 120 },
      { id: "registered", label: "Lider kaydı", hint: "Lider kaydı (yerel veritabanı)", width: 105 },
      { id: "lider", label: "Lider (sunucu)", hint: "Lider kaydı (sunucu tarafı)", width: 125 },
      { id: "live", label: "Canlı bağlantı", width: 110 },
      { id: "probe", label: "Pulsar testi", width: 110 },
      { id: "mac", label: "Kimlik MAC'i", width: 150 },
      { id: "school", label: "Okul", hint: "Okul (ETA kaydı)", width: 240 },
      { id: "where", label: "İl / ilçe", width: 150 },
      { id: "phase", label: "Faz", width: 150 }
    ]
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
    this.__detail = this._addButton("Raporu göster", () => this.__showReport(this.__selectedBoard()));
    this.__clear = this._addButton("Süzgeçleri temizle", () => this.__clearFilters());
    this.__note = new qx.ui.basic.Label("").set({ rich: true, textColor: "app-muted" });
    this.add(this.__note);

    const C = tihamon.page.Ahenk.COLUMNS;
    this.__table = this._createTable(C, { checkable: true, prefsKey: "ahenk.columns" });
    this.__setupRenderers();
    this.__setupSorting();
    this.__fields = this._addColumnFilters(this.__table, C, () => this.__onFilter());
    // Kayıtlı süzgeçler: kutular başlık çizilince oluşur, yedek kutudaki değeri devralır (bkz. Base).
    const saved = (this._user.ui_prefs || {})["ahenk.filters"] || {};
    Object.keys(saved).forEach(id => this.__fields[id] && this.__fields[id].setValue(saved[id]));

    this.__table.addListener("cellDbltap", e => this.__showReport(this.__boardAt(e.getRow())));
    this.__table.getSelectionModel().addListener("changeSelection", () => this.__detail.setEnabled(!!this.__selectedBoard()));
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
    __fields: null,
    __note: null,
    __detail: null,
    __clear: null,
    __timer: null,
    __boards: null,
    __byId: null,
    __rows: null,
    __sorting: false,
    __saveTimer: null,

    /** Tablo sütun indisi (kimlik + onay kutusu sütunlarından sonra). */
    __col(id) {
      return tihamon.page.Ahenk.COLUMNS.findIndex(c => c.id === id) + 2;
    },

    __boardAt(row) {
      if (row === null || row === undefined || row < 0) {
        return null;
      }
      return this.__byId ? this.__byId.get(this.__table.getTableModel().getValue(0, row)) || null : null;
    },

    __selectedBoard() {
      let found = null;
      this.__table.getSelectionModel().iterateSelection(row => {
        found = found || this.__boardAt(row);
      });
      return found;
    },

    __setupRenderers() {
      const tcm = this.__table.getTableColumnModel();
      const A = tihamon.page.Ahenk;
      const F = tihamon.util.Format;
      const boardOf = info => (this.__byId ? this.__byId.get(info.rowData[0]) : null);
      const hint = (id, fn, dot) => tcm.setDataCellRenderer(this.__col(id), new tihamon.ui.table.HintRenderer(info => {
        const b = boardOf(info);
        return b ? fn(b, b.summary || {}) : null;
      }, dot));
      hint("checked", b => (b.checked_at ? "Son Ahenk kontrolü: " + F.dateTime(b.checked_at * 1000) : "Bu tahtada henüz Ahenk kontrolü yapılmadı."));
      hint("result", (b, s) => {
        if (b.checked_at === null) {
          return "Henüz kontrol edilmedi. Tahtayı işaretleyip \"İşaretlilerde Ahenk kontrol\" ile başlatın.";
        }
        const lines = [A.RESULT_HINT[b.exit_code] || `Çıkış kodu ${b.exit_code}`];
        (s.problems || []).forEach(p => lines.push(p));
        lines.push("", "Ayrıntılı (renkli) rapor için satıra çift tıklayın.");
        return lines.join("\n");
      });
      hint("problems", (b, s) => (s.problems || []).join("\n") || null);
      hint("registered", (b, s) => (b.checked_at === null ? null : String(s.registered) === "1"
        ? "Tahtanın Ahenk veritabanında Lider kaydı var (kimlik/parola alınmış)."
        : "Tahtanın Ahenk veritabanında Lider kaydı YOK: kayıt tamamlanmamış."));
      hint("lider", (b, s) => (s.lider_server ? "Lider sunucusunun bu kimliği tanıyıp tanımadığı (sunucu tarafı doğrulama): " + s.lider_server : null));
      hint("live", (b, s) => (b.checked_at === null ? null : s.live_count > 0
        ? `Ahenk'in Lider mesajlaşma sunucusuna (Pulsar) ${s.live_count} açık TCP bağlantısı var: tahta uzak komut alabilir.`
        : "Ahenk'in Lider mesajlaşma sunucusuna açık bağlantısı yok: tahta Lider'de çevrimdışı görünür."));
      hint("probe", (b, s) => {
        const p = s.probe || "";
        if (p.startsWith("atlandı")) {
          return /canlı/.test(p)
            ? "Pulsar bağlantısı zaten canlı olduğu için ek bir bağlantı testine gerek duyulmadı."
            : "Aktif Pulsar testi atlandı: " + (s.probe_detail || p.replace(/^atlandı ?/, ""));
        }
        if (p === "başarılı") {
          return "Aktif Pulsar testi başarılı: Lider'e test mesajı gönderildi ve kabul edildi.";
        }
        if (p === "başarısız") {
          return "Aktif Pulsar testi başarısız" + (s.probe_detail ? ": " + s.probe_detail : ".");
        }
        return null;
      });
      hint("mac", (b, s) => (s.identity_mac ? `Ahenk'in kimlik MAC'i: ${s.identity_mac}` +
        (s.registered_mac ? `\nLider'de kayıtlı MAC: ${s.registered_mac}${s.mac_match === false ? " — FARKLI (klon ya da donanım değişimi olabilir)" : " — aynı"}` : "") : null));
      hint("online", (b, s) => {
        const lines = [b.online ? "Çevrim içi: tahta şu an ağda erişilebilir." : "Çevrim dışı: tahta şu an kapalı ya da ağda erişilemiyor; Ahenk kontrolü çalıştırılamaz."];
        if (b.checked_at !== null) {
          lines.push(`Son Ahenk kontrolü: ${F.dateTime(b.checked_at * 1000)} — ${(A.RESULT[b.exit_code] || "").replace(/^\W+/, "")}`);
          lines.push(`Ahenk ${s.ahenk_version || "kurulu değil"} · servis ${s.service_active || "?"}${s.service_enabled ? " / " + s.service_enabled : ""}` +
            (s.service_nrestarts ? ` · ${s.service_nrestarts} kez yeniden başladı` : ""));
          lines.push(`Lider kaydı: ${String(s.registered) === "1" ? "var" : "yok"}${s.lider_server ? " (" + s.lider_server + ")" : ""}` +
            ` · mesajlaşma (${s.messenger || "?"}) bağlantısı: ${s.live_count > 0 ? "canlı" : "yok"}`);
          if (s.school) {
            lines.push(`ETA kaydı: ${[s.city, s.town, s.school].filter(Boolean).join(" / ")}${s.unit ? " · " + s.unit : ""}`);
          }
        } else {
          lines.push("Bu tahtada henüz Ahenk kontrolü yapılmadı.");
        }
        return lines.join("\n");
      }, info => (info.value === "Çevrim içi" ? "#2fa84a" : "#9aa0a6"));
    },

    /** "Son kontrol" gerçek zamana göre sıralanır (metin "3 dk önce" değil); sıralama kullanıcıya kaydedilir. */
    __setupSorting() {
      const model = this.__table.getTableModel();
      const at = row => {
        const b = this.__byId && this.__byId.get(row[0]);
        return b && b.checked_at !== null ? b.checked_at : -1;
      };
      model.setSortMethods(this.__col("checked"), {
        ascending: (a, b) => at(a) - at(b),
        descending: (a, b) => at(b) - at(a)
      });
      model.addListener("metaDataChanged", () => {
        if (this.__sorting) {
          return;
        }
        const index = model.getSortColumnIndex();
        const column = tihamon.page.Ahenk.COLUMNS[index - 2];
        tihamon.page.Base.savePref(this._user, "ahenk.sort", column ? { id: column.id, asc: model.isSortAscending() } : null);
      });
    },

    __onFilter() {
      this.__apply();
      clearTimeout(this.__saveTimer);
      this.__saveTimer = setTimeout(() => {
        const values = {};
        Object.keys(this.__fields).forEach(id => {
          const v = (this.__fields[id].getValue() || "").trim();
          if (v) {
            values[id] = v;
          }
        });
        tihamon.page.Base.savePref(this._user, "ahenk.filters", Object.keys(values).length ? values : null);
      }, 800);
    },

    __clearFilters() {
      Object.values(this.__fields).forEach(f => f.setValue(""));
    },

    /** Süzgeçleri uygular, kayıtlı/güncel sıralamayı korur. */
    __apply() {
      if (!this.__rows) {
        return;
      }
      const C = tihamon.page.Ahenk.COLUMNS;
      const filters = C.map((c, i) => ({ index: i + 2, text: ((this.__fields[c.id] && this.__fields[c.id].getValue()) || "").toLowerCase().trim() }))
        .filter(f => f.text);
      const shown = this.__rows.filter(cells => filters.every(f => String(cells[f.index] ?? "").toLowerCase().includes(f.text)));
      const model = this.__table.getTableModel();
      const checked = new Set(this._checkedIds(this.__table));
      shown.forEach(cells => {
        cells[1] = checked.has(cells[0]);
      });
      let index = model.getSortColumnIndex();
      let asc = model.isSortAscending();
      if (index < 0) {
        const saved = (this._user.ui_prefs || {})["ahenk.sort"];
        const i = saved ? C.findIndex(c => c.id === saved.id) : -1;
        if (i >= 0) {
          index = i + 2;
          asc = saved.asc !== false;
        }
      }
      this.__sorting = true;
      try {
        model.setData(shown, false);
        if (index >= 0) {
          model.sortByColumn(index, asc);
        }
      } finally {
        this.__sorting = false;
      }
      this.__clear.setEnabled(filters.length > 0);
      const done = this.__boards.filter(b => b.checked_at !== null);
      const count = code => done.filter(b => b.exit_code === code).length;
      this.__note.setValue(
        `${shown.length === this.__boards.length ? "" : shown.length + "/" + this.__boards.length + " satır gösteriliyor · "}` +
        `${done.length}/${this.__boards.length} tahta kontrol edildi · ${count(0)} sorunsuz · ${count(1)} uyarılı · ` +
        `<span style="color:#c42b1c">${count(2)} kritik</span> · rapor tahtadan alınır, dışarıya gönderilmez`);
    },

    async _refresh() {
      const data = await tihamon.io.Api.get("/ahenk");
      const R = tihamon.page.Ahenk.RESULT;
      const F = tihamon.util.Format;
      this.__boards = data.boards;
      this.__byId = new Map(data.boards.map(b => [b.id, b]));
      this.__rows = data.boards.map(b => {
        const s = b.summary || {};
        const has = b.checked_at !== null;
        const registered = String(s.registered) === "1" || s.registered === true;
        return [
          b.id, false, b.online ? "Çevrim içi" : "Çevrim dışı", b.name,
          has ? F.ago(b.checked_at) : "hiç",
          has ? (R[b.exit_code] || String(b.exit_code)) : "—",
          (s.problems || []).join(" · "),
          s.ahenk_version || (has ? "kurulu değil" : ""),
          has ? `${s.service_active || "—"}${s.service_enabled ? " / " + s.service_enabled : ""}` : "",
          has ? (registered ? "✓ kayıtlı" : "✗ kayıtsız") : "",
          s.lider_server || "",
          has ? (s.live_count > 0 ? `✓ ${s.live_count} TCP` : "✗ yok") : "",
          s.probe ? s.probe.replace(/ \(.*\)$/, "") : "",
          s.identity_mac ? s.identity_mac + (s.mac_match === false ? " ✗" : "") : "",
          s.school ? `${s.school}${s.school_code ? " (" + s.school_code + ")" : ""}${s.unit ? " · " + s.unit : ""}` : "",
          [s.city, s.town].filter(Boolean).join(" / "),
          typeof s.phase === "object" && s.phase ? (s.phase.phase || s.phase.name || "") : (s.phase || "")
        ];
      });
      this.__apply();
    },

    __run(all) {
      const checked = this._checkedIds(this.__table);
      const boards = (this.__boards || []).filter(b => b.online && (all || checked.includes(b.id)));
      if (!boards.length) {
        tihamon.ui.Dialog.alert(all ? "Çevrim içi tahta yok." : "Önce çevrim içi bir ya da daha fazla tahta işaretleyin.");
        return;
      }
      tihamon.ui.Jobs.show(tihamon.io.Api.post("/jobs", {
        type: "action", action: "ahenk-check", board_ids: boards.map(b => b.id), values: { KAPSAM: "tam" }
      }).then(res => res.id), `Ahenk kontrol — ${boards.length} tahta`);
    },

    /** ahenk-debug'ın renkli ham çıktısı (koyu zeminde, seçilebilir); yoksa (eski rapor) bulgu listesi. */
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
      const Ansi = tihamon.util.Ansi;
      const findings = data.report.findings || [];
      const text = data.report_text ||
        findings.map(f => `[${f.severity}] ${f.title}${f.detail ? "\n    " + String(f.detail).replace(/\n/g, "\n    ") : ""}`).join("\n");
      const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
      // Ekran kadar geniş: çıktı satırları uzun ve KIRILMAZ (kullanıcı isteği) — sığmayan yatay kaydırılır.
      const win = tihamon.ui.Dialog.window(`Ahenk raporu — ${board.name}`, root.width - 24, { maximizable: true });
      win.set({ height: root.height - 24 });
      win.add(new qx.ui.basic.Label(
        `${esc(tihamon.page.Ahenk.RESULT[data.exit_code] || String(data.exit_code))} · ${esc(F.dateTime(data.checked_at * 1000))}` +
        ` · ahenk-debug ${esc((data.tool_commit || "").slice(0, 7))} · ${findings.length} bulgu` +
        (data.report_text ? "" : " · renkli çıktı bir sonraki kontrolde gelir")).set({ rich: true, selectable: true }));
      const html = `<pre style="margin:0;padding:10px 12px;white-space:pre;` +
        `font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${Ansi.FOREGROUND}">${Ansi.toHtml(Ansi.colorBadges(text))}</pre>`;
      const body = new qx.ui.container.Composite(new qx.ui.layout.Grow()).set({ backgroundColor: Ansi.BACKGROUND });
      body.add(new qx.ui.basic.Label(html).set({ rich: true, wrap: false, selectable: true }));
      win.add(new qx.ui.container.Scroll(body).set({ backgroundColor: Ansi.BACKGROUND }), { flex: 1 });
      const copyText = new qx.ui.form.Button("Çıktıyı kopyala");
      copyText.addListener("execute", () => tihamon.util.Clipboard.copy(Ansi.strip(text)));
      const copyJson = new qx.ui.form.Button("Ham raporu (JSON) kopyala");
      copyJson.addListener("execute", () => tihamon.util.Clipboard.copy(JSON.stringify(data.report, null, 2)));
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      tihamon.ui.Dialog.buttons(win, [copyText, copyJson, close]);
      win.open();
    }
  }
});
