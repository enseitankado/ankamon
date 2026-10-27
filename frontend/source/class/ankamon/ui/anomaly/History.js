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
 * Anomaliler ▸ Geçmiş: seçili dönemle örtüşen tüm anomali kayıtları (sürenler dahil), Excel tarzı
 * sütun süzgeçli (bkz. page.Base _addColumnFilters). Tahta özetinde çift tık bu sekmeyi o tahtaya süzer.
 */
qx.Class.define("ankamon.ui.anomaly.History", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Anomalies} */
  construct(page) {
    super("Geçmiş");
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    this.__columns = [
      { id: "board", label: "Tahta", width: 200 },
      { id: "kind", label: "Anomali", width: 140 },
      { id: "started", label: "Başlangıç", width: 150 },
      { id: "ended", label: "Bitiş", width: 150 },
      { id: "duration", label: "Süre", width: 130 },
      { id: "detail", label: "Ayrıntı" }
    ];
    this.__table = page._createTable(this.__columns, { storageKey: "anomalies.history.columns" });
    this.__filterFields = page._addColumnFilters(this.__table, this.__columns, this.__apply.bind(this));
    this.add(this.__table, { flex: 1 });
    this.__count = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
    this.add(this.__count);
  },

  members: {
    __columns: null,
    __table: null,
    __filterFields: null,
    __rows: null,
    __count: null,

    /** @param anomalies {Array} dönemin kayıtları (page.Anomalies._refresh) */
    setData(anomalies) {
      const F = ankamon.util.Format;
      const now = Date.now() / 1000;
      this.__rows = anomalies.map(a => {
        const seconds = (a.ended_at || now) - a.started_at;
        return {
          seconds,
          cells: [
            a.id, a.board, a.kindLabel, F.dateTime(a.started_at * 1000),
            a.ended_at ? F.dateTime(a.ended_at * 1000) : "—",
            F.duration(seconds) + (a.ended_at ? "" : " (sürüyor)"),
            a.text
          ]
        };
      });
      this.__apply();
    },

    /** Tahta sütununun süzgecini verilen adla doldurur (Tahta özeti → çift tık). */
    filterBoard(board) {
      this.__filterFields.board.setValue(board);
      this.__apply();
    },

    __apply() {
      if (!this.__rows) {
        return;
      }
      const filters = this.__columns
        .map((column, index) => ({ index: index + 1, text: (this.__filterFields[column.id].getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
      const shown = this.__rows.filter(({ cells }) =>
        filters.every(f => String(cells[f.index] ?? "").toLowerCase().includes(f.text)));
      this.__table.getTableModel().setData(shown.map(r => r.cells));
      const total = shown.reduce((sum, r) => sum + r.seconds, 0);
      this.__count.setValue(`${shown.length} / ${this.__rows.length} kayıt · toplam süre ${ankamon.util.Format.duration(total)}`);
    }
  }
});
