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
 * Anomaliler ▸ Anlık: şu an süren anomaliler (bkz. page.Anomalies — veriyi sayfa 30 sn'de bir çeker).
 * Üstte özet satırı (kaç tahtada sürüyor) ve yardım simgesi: türlerin açıklaması, kaynağı ve sıklığı (eskiden tablonun
 * altında sürekli duruyordu — kullanıcı isteğiyle simgeye alındı). Tabloda her kaydın Kaynak ve Sıklık sütunu ve
 * Tetikleyen: kaydı hangi süreç üretti — Ankamon'un otomatik tespit süreci (worker, çekirdek kuralı) ya da bir eklentinin
 * kuralı (bkz. backend AnomaliesApi::kinds "origin"). Sütunlar sıralanır (Başlangıç/Süre ham zamana göre) ve başlıktaki
 * süzgeçlerle (az çeşitli sütunlarda hazır değer listesi) süzülür.
 */
qx.Class.define("ankamon.ui.anomaly.Live", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Anomalies} */
  construct(page) {
    super("Anlık");
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__status = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true });
    head.add(this.__status, { flex: 1 });
    const help = new qx.ui.form.Button().set({
      label: ankamon.ui.boards.ActionIcons.svg("helpCircle", 20), rich: true, show: "label",
      padding: [2, 4], toolTipText: "Anomali türleri: açıklama, kaynak ve sıklık"
    });
    help.addListener("execute", () => this.__showHelp(help));
    head.add(help);
    this.add(head);
    this.__columns = [
      { id: "board", label: "Tahta", width: 200 },
      { id: "kind", label: "Anomali", width: 140 },
      { id: "trigger", label: "Tetikleyen", width: 210 },
      { id: "started", label: "Başlangıç", width: 150 },
      { id: "duration", label: "Süre", width: 110 },
      { id: "source", label: "Kaynak", width: 90 },
      { id: "every", label: "Sıklık", width: 70 },
      { id: "detail", label: "Ayrıntı" }
    ];
    this.__table = page._createTable(this.__columns, { prefsKey: "anomalies.live.columns" });
    this.__filterFields = page._addColumnFilters(this.__table, this.__columns, () => this.__apply(),
      { rows: () => (this.__rows || []).map(r => r.cells) });
    // Başlangıç ve Süre metin olarak dizilmesin: ham başlangıç zamanına göre (Süre ters yönde).
    const model = this.__table.getTableModel();
    const at = row => (this.__startedAt || {})[row[0]] || 0;
    const col = id => this.__columns.findIndex(c => c.id === id) + 1;
    const byStart = (a, b) => at(a) - at(b);
    model.setSortMethods(col("started"), { ascending: byStart, descending: (a, b) => byStart(b, a) });
    model.setSortMethods(col("duration"), { ascending: (a, b) => byStart(b, a), descending: byStart });
    this.add(this.__table, { flex: 1 });
  },

  members: {
    __status: null,
    __columns: null,
    __table: null,
    __filterFields: null,
    __rows: null,
    __startedAt: null,
    __kinds: null,
    __help: null,
    __helpLabel: null,
    __helpScroll: null,

    /** @param rows {Array} süren kayıtlar (page.Anomalies._refresh) @param kinds {Map} tür → {label, description, source, every} */
    setData(rows, kinds) {
      const F = ankamon.util.Format;
      const now = Date.now() / 1000;
      this.__kinds = kinds;
      this.__startedAt = {};
      this.__rows = rows.map(a => {
        const k = kinds[a.kind] || {};
        this.__startedAt[a.id] = a.started_at;
        const trigger = k.origin ? `${k.origin} eklentisi (otomatik tespit)` : "Ankamon otomatik tespit (worker)";
        return { cells: [a.id, a.board, a.kindLabel, trigger, F.dateTime(a.started_at * 1000), F.span(now - a.started_at),
          k.source || "—", k.every || "—", a.text] };
      });
      this.__apply();
      const boards = new Set(rows.map(a => a.host)).size;
      const color = rows.length ? "#d93025" : "#1e8e3e";
      this.__status.setValue(`<span style="font-size:14px;font-weight:bold;color:${color}">` +
        (rows.length ? `Şu an ${boards} tahtada ${rows.length} anomali sürüyor` : "Şu an süren anomali yok") + "</span>");
    },

    __apply() {
      const filters = this.__columns
        .map((column, index) => ({ index: index + 1, text: (this.__filterFields[column.id].getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
      const shown = (this.__rows || []).filter(({ cells }) =>
        filters.every(f => ankamon.page.Base.filterMatch(cells[f.index], f.text)));
      this.__table.getTableModel().setData(shown.map(r => r.cells));
    },

    /** Tür listesi (açıklama, kaynak, sıklık) — yardım simgesinin altında açılır, dışına tıklayınca kapanır. */
    __showHelp(button) {
      const esc = qx.bom.String.escape;
      const rows = Object.values(this.__kinds || {}).map(k =>
        `<tr><td style="padding:3px 10px 3px 0;vertical-align:top;white-space:nowrap"><b>${esc(k.label)}</b></td>` +
        `<td style="padding:3px 10px 3px 0;vertical-align:top;white-space:nowrap">${esc(k.source || "—")}, ${esc(k.every || "—")}</td>` +
        `<td style="padding:3px 0;vertical-align:top">${esc(k.description || "")}` +
        (k.source_detail ? `<br><span style="opacity:.7">Kaynak: ${esc(k.source_detail)}</span>` : "") + "</td></tr>").join("");
      const html = "<div style=\"margin-bottom:6px\">Otomatik tespit tahtaya bağlanıp komut çalıştırmaz: Ankamon 60 sn'de bir " +
        "kendi verisinden hesaplar, log tarayan kurallar en çok 5 dk'da bir. <b>Log</b>: tahtanın gönderdiği loglar; " +
        "<b>Ölçüm</b>: Ankamon'un tahtanın 9100 portundan okuduğu ölçümler; <b>SSH verisi</b>: daha önce SSH ile " +
        "toplanmış bilgi. Tahtaya SSH ile o an bakmak için Tarama sekmesi.</div>" +
        `<table style="border-collapse:collapse">${rows}</table>`;
      if (!this.__help) {
        this.__help = new qx.ui.popup.Popup(new qx.ui.layout.Grow()).set({ padding: 10 });
        this.__helpLabel = new qx.ui.basic.Label("").set({ rich: true, wrap: true, selectable: true });
        this.__helpScroll = new qx.ui.container.Scroll(this.__helpLabel);
        this.__help.add(this.__helpScroll);
      }
      // Kaydırma kabının kendi boyut ipucu küçük (100 px): boyut açıkça verilir, pencereye sığdırılır.
      const view = qx.bom.Viewport;
      this.__helpScroll.set({
        width: Math.max(320, Math.min(820, view.getWidth() - 60)),
        height: Math.max(200, Math.min(560, view.getHeight() - 160))
      });
      this.__helpLabel.setValue(html);
      this.__help.placeToWidget(button, true);
      this.__help.show();
    }
  }
});
