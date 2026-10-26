/**
 * Anomaliler ▸ Tahta özeti: seçili dönemde tahta (ve tür) başına anomali sayısı, toplam/en uzun süre,
 * son başlangıç, şu an sürüyor mu. Süreler döneme kırpılır (dönem başından önce başlayan kaydın yalnız
 * dönem içindeki kısmı sayılır). Çift tık → Geçmiş sekmesi o tahtaya süzülür.
 */
qx.Class.define("ankamon.ui.anomaly.Summary", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Anomalies} */
  construct(page) {
    super("Tahta özeti");
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    this.__columns = [
      { id: "board", label: "Tahta", width: 200 },
      { id: "kind", label: "Anomali", width: 140 },
      { id: "count", label: "Sayı", width: 70 },
      { id: "total", label: "Toplam süre", width: 130 },
      { id: "longest", label: "En uzun", width: 120 },
      { id: "last", label: "Son başlangıç", width: 150 },
      { id: "now", label: "Şu an" }
    ];
    this.__table = page._createTable(this.__columns, { prefsKey: "anomalies.summary.columns" });
    // Sayı ve süre sütunları metin değil değere göre sıralansın (hücre metni "1 sa 5 dk" gibi).
    const model = this.__table.getTableModel();
    [[3, "count"], [4, "total"], [5, "longest"], [6, "lastAt"]].forEach(([col, key]) => {
      const cmp = (a, b) => this.__rawOf(a)[key] - this.__rawOf(b)[key];
      model.setSortMethods(col, { ascending: cmp, descending: (a, b) => cmp(b, a) });
    });
    this.__table.addListener("cellDbltap", e => {
      const board = model.getValue(1, e.getRow());
      if (board) {
        page.showBoard(board);
      }
    });
    this.__table.setToolTipText("Çift tıklayın: o tahtanın kayıtları (Geçmiş)");
    this.add(this.__table, { flex: 1 });
  },

  members: {
    __columns: null,
    __table: null,
    __raw: null,

    __rawOf(row) {
      return this.__raw[row[0]];
    },

    /** @param anomalies {Array} dönemin kayıtları @param from {Number} dönem başı (epoch sn) */
    setData(anomalies, from) {
      const F = ankamon.util.Format;
      const now = Date.now() / 1000;
      const groups = {};
      anomalies.forEach(a => {
        const key = a.host + "\u0000" + a.kind;
        const g = groups[key] || (groups[key] = { board: a.board, kind: a.kindLabel, count: 0, total: 0, longest: 0, lastAt: 0, open: false });
        const seconds = Math.max(0, (a.ended_at || now) - Math.max(a.started_at, from));
        g.count++;
        g.total += seconds;
        g.longest = Math.max(g.longest, (a.ended_at || now) - a.started_at);
        g.lastAt = Math.max(g.lastAt, a.started_at);
        g.open = g.open || a.ended_at === null;
      });
      this.__raw = {};
      const rows = Object.keys(groups)
        .sort((x, y) => groups[y].total - groups[x].total)
        .map(key => {
          const g = this.__raw[key] = groups[key];
          return [key, g.board, g.kind, g.count, F.duration(g.total), F.duration(g.longest),
            F.dateTime(g.lastAt * 1000), g.open ? "Sürüyor" : ""];
        });
      this.__table.getTableModel().setData(rows);
    }
  }
});
