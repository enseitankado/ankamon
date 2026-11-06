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
 * Tahta sağlığı ▸ Durum: her tahtanın şu anki sağlığı tek yerde (bkz. backend BoardHealthApi, GET /api/board-health).
 *
 * Bulgular iki yoldan gelir ve her satırda hangisinden geldiği yazar:
 *   - Sürekli izleme: Ankamon tahtaya BAĞLANMADAN, tahtanın gönderdiği loglardan, kendi okuduğu ölçümlerden ve daha önce
 *     toplanmış verilerden birkaç dakikada bir çıkarır (anomali kuralları). Yalnız şu an SÜRENLER.
 *   - SSH denetimi: Ankamon tahtaya SSH ile girip ölçer (haftalık otomatik ya da Tara sekmesinden elle). Her tahtanın EN SON
 *     denetiminin Acil/Dikkat bulguları ve denetlenemeyen tahtalar.
 *
 * Üst tablo tahta başına bir satır (en kötü düzey, iki yolun özeti); alttaki tablo seçili tahtanın (seçim yoksa hepsinin)
 * bulguları: Yol, Kaynak, Nasıl bakıldı, Sıklık, Zaman. Çift tık: sürekli izleme bulgusu → o tahtanın Geçmiş'i; SSH denetimi
 * bulgusu → Denetle (o tahtaya süzülmüş). İki tablo da sütun süzgeçli (az çeşitli sütunlarda hazır değer listesi).
 * İki yolun açıklaması sayfada yer kaplamaz: sekme kulakçığının ve özet satırındaki ⓘ işaretinin ipucunda (kullanıcı isteği).
 * İki tablo arasındaki ayırıcı kalın (SPLITTER px; kullanıcı isteği: ince çubuk zor tutuluyordu).
 */
qx.Class.define("ankamon.ui.health.Status", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Anomalies} */
  construct(page) {
    super("Durum");
    this.setUserData("key", "status");
    this.__page = page;
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__summary = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true });
    head.add(this.__summary, { flex: 1 });
    this.__info = new qx.ui.basic.Label("ⓘ Bulgular nereden gelir?").set({ textColor: "app-muted", cursor: "help" });
    head.add(this.__info);
    this.add(head);
    this.getButton().setToolTipText(this.__legendHtml(["watch", "ssh"]));
    this.__info.setToolTipText(this.__legendHtml(["watch", "ssh"]));

    const split = new qx.ui.splitpane.Pane("vertical");
    const thick = ankamon.ui.health.Status.SPLITTER;
    split.getChildControl("splitter").set({ height: thick, minHeight: thick, maxHeight: thick });
    this.add(split, { flex: 1 });

    this.__boardColumns = [
      { id: "board", label: "Tahta", width: 200 },
      { id: "online", label: "Açık mı", width: 90 },
      { id: "level", label: "Durum", width: 90 },
      { id: "watch", label: "Sürekli izleme (şu an)", width: 300 },
      // İki yolun en yeni bakışı (SSH denetimi zamanı ya da sürekli izlemenin en yeni bulgusu) ve toplam bulgu sayıları;
      // 10 saatten yeniyse geçen süre ("2 saat 23 dk önce" — kullanıcı isteği).
      { id: "last", label: "Son denetim / bulgu", width: 300, hint: "Son SSH denetimi ya da sürekli izlemenin en yeni bulgusu" },
      { id: "count", label: "Bulgu", width: 70 }
    ];
    this.__boardTable = page._createTable(this.__boardColumns, { prefsKey: "health.status.boards.columns" });
    this.__boardFilters = page._addColumnFilters(this.__boardTable, this.__boardColumns, () => this.__applyBoards(),
      { rows: () => (this.__boardRows || []).map(r => r.cells) });
    this.__levelRenderer(this.__boardTable, 3);
    this.__boardTable.getSelectionModel().addListener("changeSelection", () => this.__applyFindings());
    this.__boardTable.setToolTipText("Bir tahtayı seçin: aşağıda yalnız onun bulguları görünür");
    const top = new qx.ui.container.Composite(new qx.ui.layout.VBox(4)).set({ marginBottom: 5 });
    top.add(this.__boardTable, { flex: 1 });
    split.add(top, 1);

    this.__findingColumns = [
      { id: "board", label: "Tahta", width: 180 },
      { id: "level", label: "Düzey", width: 80 },
      { id: "check", label: "Bulgu", width: 220 },
      { id: "path", label: "Yol", width: 130 },
      { id: "source", label: "Kaynak", width: 110 },
      { id: "how", label: "Nasıl bakıldı", width: 300 },
      { id: "every", label: "Sıklık", width: 120 },
      { id: "at", label: "Zaman", width: 140 },
      { id: "text", label: "Ayrıntı" }
    ];
    this.__findingTable = page._createTable(this.__findingColumns, { prefsKey: "health.status.findings.columns" });
    this.__findingFilters = page._addColumnFilters(this.__findingTable, this.__findingColumns, () => this.__applyFindings(),
      { rows: () => (this.__findingRows || []).map(r => r.cells) });
    this.__levelRenderer(this.__findingTable, 2);
    // Yol sütunu, üstteki açıklamanın rozetleriyle aynı renkte: bulgunun hangi yoldan geldiği bir bakışta seçilsin.
    const pathRenderer = new qx.ui.table.cellrenderer.Conditional();
    Object.values(ankamon.ui.health.Status.PATH).forEach(P => pathRenderer.addRegex(`^${P.text}$`, null, P.color, null, "bold"));
    this.__findingTable.getTableColumnModel().setDataCellRenderer(4, pathRenderer);
    this.__findingTable.addListener("cellDbltap", e => {
      const row = (this.__shownFindings || [])[e.getRow()];
      if (row) {
        this.__page.openFinding(row.finding);
      }
    });
    this.__findingTable.setToolTipText("Çift tıklayın: sürekli izleme bulgusu → Geçmiş'te o tahta; SSH denetimi bulgusu → Denetle (o tahta)");
    const bottom = new qx.ui.container.Composite(new qx.ui.layout.VBox(4)).set({ marginTop: 5 });
    this.__findingTitle = new qx.ui.basic.Label("").set({ rich: true, font: "bold" });
    bottom.add(this.__findingTitle);
    bottom.add(this.__findingTable, { flex: 1 });
    split.add(bottom, 1);
  },

  statics: {
    /** İki tablo arasındaki ayırıcının kalınlığı (px). */
    SPLITTER: 12,
    /** Bu kadar saniyeden yeni zamanlar geçen süreyle yazılır ("2 saat 23 dk önce"). */
    RELATIVE_S: 10 * 3600,

    /** epoch sn → 10 saatten yeniyse "2 saat 23 dk önce", değilse tarih-saat. */
    when(ts) {
      if (!ts) {
        return "";
      }
      const diff = Math.floor(Date.now() / 1000) - ts;
      if (diff < 0 || diff >= ankamon.ui.health.Status.RELATIVE_S) {
        return ankamon.util.Format.dateTime(ts * 1000);
      }
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      if (!h && !m) {
        return "az önce";
      }
      return (h ? `${h} saat ` : "") + `${m} dk önce`;
    },

    PATH: {
      watch: { text: "Sürekli izleme", color: "#1a73e8" },
      ssh: { text: "SSH denetimi", color: "#7b1fa2" }
    },

    /** Düzey adları Bakım raporuyla aynı (bkz. page.Diagnose LEVEL). */
    levelText(level) {
      const L = ankamon.page.Diagnose.LEVEL[level];
      return L ? L.text : level;
    }
  },

  members: {
    __page: null,
    __info: null,
    __summary: null,
    __boardColumns: null,
    __boardTable: null,
    __boardFilters: null,
    __boardRows: null,
    __shownBoards: null,
    __findingColumns: null,
    __findingTable: null,
    __findingFilters: null,
    __findingRows: null,
    __shownFindings: null,
    __findingTitle: null,
    __data: null,

    /** Düzey sütunu renkli ve kalın (metin süzgeç için düz kalır). */
    __levelRenderer(table, column) {
      const r = new qx.ui.table.cellrenderer.Conditional();
      Object.values(ankamon.page.Diagnose.LEVEL).forEach(L => r.addRegex(`^${L.text}$`, null, L.color, null, "bold"));
      table.getTableColumnModel().setDataCellRenderer(column, r);
    },

    /** İki yolun açıklaması (ipucu): yalnız kullanıcının gördüğü yollar. */
    __legendHtml(paths) {
      const P = ankamon.ui.health.Status.PATH;
      const badge = key => `<span style="display:inline-block;padding:0 7px;border-radius:9px;background:${P[key].color};color:#fff;font-weight:600">${P[key].text}</span>`;
      return `<div style="max-width:560px;white-space:normal;line-height:1.5">` +
        "Bulgular iki yoldan gelir; her satırda hangisinden geldiği yazar. " +
        (paths.includes("watch") ? `${badge("watch")} Ankamon tahtaya bağlanmadan, tahtanın gönderdiği loglardan ve kendi ` +
          "okuduğu ölçümlerden birkaç dakikada bir çıkarır; burada yalnız şu an sürenler. " : "") +
        (paths.includes("ssh") ? `${badge("ssh")} Ankamon tahtaya SSH ile girip ölçer (haftada bir kendiliğinden ya da Tara ` +
          "sekmesinden elle); her tahtanın en son denetimi. " : "") +
        "Her denetimin ne olduğu, nasıl ve ne sıklıkla bakıldığı: <b>Denetimler</b> sekmesi.</div>";
    },

    /** @param data {Map} GET /api/board-health yanıtı */
    setData(data) {
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const P = ankamon.ui.health.Status.PATH;
      const text = ankamon.ui.health.Status.levelText;
      this.__data = data;
      const paths = data.paths || [];
      const legend = this.__legendHtml(paths);
      this.getButton().setToolTipText(legend);
      this.__info.setToolTipText(legend);
      const when = ankamon.ui.health.Status.when;

      const order = { bad: 3, warn: 2, info: 1, ok: 0 };
      const byBoard = new Map();
      (data.findings || []).forEach(f => {
        const key = f.board_id ?? f.board;
        if (!byBoard.has(key)) {
          byBoard.set(key, []);
        }
        byBoard.get(key).push(f);
      });
      const boardIds = new Set();
      this.__boardRows = (data.boards || []).map(b => {
        boardIds.add(b.id);
        const list = byBoard.get(b.id) || [];
        const watch = list.filter(f => f.path === "watch");
        const worst = list.reduce((w, f) => (order[f.level] > order[w] ? f.level : w), "ok");
        const last = this.__lastText(list, paths.includes("ssh") ? b.ssh || false : null, when);
        const watchText = !paths.includes("watch") ? "—"
          : watch.length ? [...new Set(watch.map(f => f.check))].join(", ") : "Sorun yok";
        return { id: b.id, name: b.name, cells: [b.id, b.name, b.online ? "Açık" : "Kapalı", text(worst), watchText, last, list.length] };
      });
      // Kaydı silinmiş tahtanın süren bulguları da görünsün.
      byBoard.forEach((list, key) => {
        if (typeof key === "number" && boardIds.has(key)) {
          return;
        }
        const worst = list.reduce((w, f) => (order[f.level] > order[w] ? f.level : w), "ok");
        this.__boardRows.push({ id: key, name: list[0].board, cells: [key, list[0].board || "?", "—", text(worst),
          [...new Set(list.map(f => f.check))].join(", "), this.__lastText(list, null, when), list.length] });
      });
      this.__boardRows.sort((a, b) => (order[this.__levelKey(b.cells[3])] - order[this.__levelKey(a.cells[3])]) ||
        String(a.name).localeCompare(String(b.name), "tr", { numeric: true }));

      this.__findingRows = (data.findings || []).map(f => ({
        finding: f,
        cells: [f.board_id ?? f.board, f.board || "?", text(f.level), f.check, P[f.path] ? P[f.path].text : f.path,
          f.source || "", f.how || "", f.every || "", f.since ? F.dateTime(f.since * 1000) : "",
          (f.text || "") + (f.advice ? ` — Öneri: ${f.advice}` : "")]
      }));

      const boardsBad = this.__boardRows.filter(r => r.cells[3] === text("bad")).length;
      const boardsWarn = this.__boardRows.filter(r => r.cells[3] === text("warn")).length;
      const color = boardsBad ? "#c5221f" : boardsWarn ? "#e37400" : "#1e8e3e";
      this.__summary.setValue(`<span style="font-size:14px;font-weight:bold;color:${color}">` +
        (boardsBad || boardsWarn
          ? [boardsBad && `${boardsBad} tahtada acil`, boardsWarn && `${boardsWarn} tahtada dikkat gerektiren`].filter(Boolean).join(", ") + " bulgu var"
          : "Şu an acil ya da dikkat gerektiren bulgu yok") +
        `</span> <span style="opacity:.7">· ${esc(String(this.__boardRows.length))} tahta · güncellendi ${F.dateTime(data.generated_at * 1000)}</span>`);
      this.__applyBoards();
    },

    /**
     * "Son denetim / bulgu" hücresi: iki yolun en yeni zamanı (SSH denetimi ya da sürekli izlemenin en yeni bulgusu)
     * + tahtanın iki yoldaki bulgu sayıları; SSH denetimi yapılamadıysa/hiç yapılmadıysa o da yazılır.
     * @param list {Array} tahtanın bulguları @param ssh {Map|false|null} son SSH denetimi (false: hiç; null: yetki yok)
     */
    __lastText(list, ssh, when) {
      const times = list.filter(f => f.path === "watch" && f.since).map(f => f.since);
      if (ssh && ssh.at) {
        times.push(ssh.at);
      }
      const at = times.length ? Math.max(...times) : null;
      const bad = list.filter(f => f.level === "bad").length;
      const warn = list.filter(f => f.level === "warn").length;
      const parts = [at ? when(at) : "", bad || warn ? [bad && `${bad} acil`, warn && `${warn} dikkat`].filter(Boolean).join(", ") : "sorun yok"];
      if (ssh === false) {
        parts.push("SSH: hiç denetlenmedi");
      } else if (ssh && ssh.status !== "ok") {
        parts.push("SSH: denetlenemedi");
      }
      return parts.filter(Boolean).join(" · ");
    },

    __levelKey(label) {
      return Object.keys(ankamon.page.Diagnose.LEVEL).find(k => ankamon.page.Diagnose.LEVEL[k].text === label) || "ok";
    },

    __filtersOf(columns, fields) {
      return columns.map((column, index) => ({ index: index + 1, text: ((fields[column.id] || { getValue: () => "" }).getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
    },

    __applyBoards() {
      if (!this.__boardRows) {
        return;
      }
      const selected = this.__selectedBoard();
      const filters = this.__filtersOf(this.__boardColumns, this.__boardFilters);
      this.__shownBoards = this.__boardRows.filter(({ cells }) => filters.every(f => ankamon.page.Base.filterMatch(cells[f.index], f.text)));
      this.__boardTable.getTableModel().setData(this.__shownBoards.map(r => r.cells));
      // Tazelemede seçim korunur.
      const index = selected === null ? -1 : this.__shownBoards.findIndex(r => r.id === selected);
      const sm = this.__boardTable.getSelectionModel();
      if (index >= 0) {
        sm.setSelectionInterval(index, index);
      } else {
        sm.resetSelection();
      }
      this.__applyFindings();
    },

    __selectedBoard() {
      const sm = this.__boardTable.getSelectionModel();
      if (sm.isSelectionEmpty()) {
        return null;
      }
      const row = this.__boardTable.getTableModel().getRowData(sm.getLeadSelectionIndex());
      return row ? row[0] : null;
    },

    __applyFindings() {
      if (!this.__findingRows) {
        return;
      }
      const board = this.__selectedBoard();
      const filters = this.__filtersOf(this.__findingColumns, this.__findingFilters);
      this.__shownFindings = this.__findingRows.filter(({ cells }) =>
        (board === null || cells[0] === board) && filters.every(f => ankamon.page.Base.filterMatch(cells[f.index], f.text)));
      this.__findingTable.getTableModel().setData(this.__shownFindings.map(r => r.cells));
      const name = board === null ? null : (this.__boardRows.find(r => r.id === board) || {}).name;
      this.__findingTitle.setValue(name
        ? `Bulgular — ${qx.bom.String.escape(String(name))} (${this.__shownFindings.length})`
        : `Bulgular — tüm tahtalar (${this.__shownFindings.length})`);
    }
  }
});
