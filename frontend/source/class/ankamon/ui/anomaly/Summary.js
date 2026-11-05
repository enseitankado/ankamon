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
 * Anomaliler ▸ Özet: seçili dönemde tahta (ve tür) başına anomali sayısı, toplam/en uzun süre,
 * son başlangıç, şu an sürüyor mu. Süreler döneme kırpılır (dönem başından önce başlayan kaydın yalnız
 * dönem içindeki kısmı sayılır). Sütun süzgeçli (bkz. page.Base _addColumnFilters). Çift tık → Geçmiş
 * sekmesi o tahtaya süzülür.
 */
qx.Class.define("ankamon.ui.anomaly.Summary", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Anomalies} */
  construct(page) {
    super("Özet");
    this.setUserData("key", "summary"); // sekme kimliği etiketten bağımsız (sol menü yaprağı, hatırlanan sekme)
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    // Tahta ve Anomali her zaman hazır listeli (kullanıcı isteği): satır azken (her tahtanın birkaç türü)
    // otomatik karar "değer sayısı satır sayısına yakın" diye listeyi gizliyordu (bkz. Base.choicesSuitable).
    this.__columns = [
      { id: "board", label: "Tahta", width: 200, choices: true },
      { id: "kind", label: "Anomali", width: 140, choices: true },
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
    this.__filterFields = page._addColumnFilters(this.__table, this.__columns, this.__apply.bind(this),
      { rows: () => this.__rows || [] });
    this.add(this.__table, { flex: 1 });
    this.__count = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
    this.add(this.__count);
  },

  members: {
    __columns: null,
    __table: null,
    __raw: null,
    __rows: null,
    __filterFields: null,
    __count: null,

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
      this.__rows = Object.keys(groups)
        .sort((x, y) => groups[y].total - groups[x].total)
        .map(key => {
          const g = this.__raw[key] = groups[key];
          return [key, g.board, g.kind, g.count, F.span(g.total), F.span(g.longest),
            F.dateTime(g.lastAt * 1000), g.open ? "Sürüyor" : ""];
        });
      this.__apply();
    },

    /** Sütun süzgeçlerini uygular (her süzgeç değişikliğinde ve yeni veride). */
    __apply() {
      if (!this.__rows) {
        return;
      }
      const filters = this.__columns
        .map((column, index) => ({ index: index + 1, text: (this.__filterFields[column.id].getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
      const shown = this.__rows.filter(cells =>
        filters.every(f => ankamon.page.Base.filterMatch(cells[f.index], f.text)));
      this.__table.getTableModel().setData(shown);
      this.__count.setValue(`${shown.length} / ${this.__rows.length} satır`);
    }
  }
});
