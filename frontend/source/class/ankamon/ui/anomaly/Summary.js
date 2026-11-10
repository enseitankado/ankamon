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
 * Sağlık ▸ Geçmiş'in üst bölmesi (eski "Özet" sekmesi — bkz. ui.anomaly.Records): seçili dönemde tahta (ve tür) başına
 * anomali sayısı, toplam/en uzun süre, son başlangıç, şu an sürüyor mu. Süreler döneme kırpılır (dönem başından önce
 * başlayan kaydın yalnız dönem içindeki kısmı sayılır). Sütun süzgeçli (bkz. page.Base _addColumnFilters). Satır seçilince
 * alttaki kayıtlar o tahtanın o bulgusuna süzülür (onSelect). Her sütun başlığının ve hücrenin açıklayıcı ipucu var
 * (kullanıcı isteği; bkz. HINTS ve ui.table.HintRenderer).
 */
qx.Class.define("ankamon.ui.anomaly.Summary", {
  extend: qx.ui.container.Composite,

  /**
   * @param page {ankamon.page.Anomalies}
   * @param onSelect {Function} (tahta, bulgu) — seçim kalkınca (null, null)
   */
  construct(page, onSelect) {
    super(new qx.ui.layout.VBox(4));

    // Tahta ve Anomali her zaman hazır listeli (kullanıcı isteği): satır azken (her tahtanın birkaç türü)
    // otomatik karar "değer sayısı satır sayısına yakın" diye listeyi gizliyordu (bkz. Base.choicesSuitable).
    this.__columns = [
      { id: "board", label: "Tahta", width: 200, choices: true, hint: "Bulgunun görüldüğü tahta. Satırı seçin: aşağıda yalnız onun kayıtları" },
      { id: "kind", label: "Anomali", width: 140, choices: true, hint: "Bulgu türü (sürekli izleme denetimi); ayrıntısı Yardım ▸ Denetim türleri'nde" },
      { id: "count", label: "Sayı", width: 70, hint: "Seçili rapor döneminde bu bulgunun kaç kez başladığı" },
      { id: "total", label: "Toplam süre", width: 130, hint: "Dönem içinde toplam sürdüğü zaman (dönem başından önce başlayan kaydın yalnız dönem içindeki kısmı sayılır)" },
      { id: "longest", label: "En uzun", width: 120, hint: "En uzun süren tek kaydın süresi (dönem dışına taşan kısmı dahil)" },
      { id: "last", label: "Son başlangıç", width: 150, hint: "Bu bulgunun bu tahtada en son başladığı an" },
      { id: "now", label: "Şu an", hint: "Bulgu şu an sürüyor mu (Sürüyor = henüz bitmedi)" }
    ];
    this.__table = page._createTable(this.__columns, { prefsKey: "anomalies.summary.columns" });
    // Hücre ipuçları: değerin ne anlama geldiği, satırın kendi sayılarıyla.
    const F = ankamon.util.Format;
    const hints = {
      board: g => `${g.board}: bu dönemde ${g.count} kez "${g.kind}". Seçin: aşağıda yalnız bu kayıtlar`,
      kind: g => `${g.kind}${g.desc ? ": " + g.desc : ""}`,
      count: g => `Seçili dönemde ${g.count} kez başladı`,
      total: g => `Dönem içinde toplam ${F.span(g.total)} sürdü (dönem başından önce başlayan kaydın yalnız dönem içi kısmı sayılır)`,
      longest: g => `En uzun tek kayıt ${F.span(g.longest)} sürdü`,
      last: g => `En son ${F.dateTime(g.lastAt * 1000)} tarihinde başladı (${F.ago(g.lastAt)})`,
      now: g => (g.open ? "Bu bulgu şu an sürüyor (henüz bitmedi)" : "Şu an sürmüyor: dönemdeki bütün kayıtları bitti")
    };
    this.__columns.forEach((column, index) => {
      this.__table.getTableColumnModel().setDataCellRenderer(index + 1, new ankamon.ui.table.HintRenderer(info => {
        const g = this.__raw && info.rowData ? this.__raw[info.rowData[0]] : null;
        return g ? hints[column.id](g) : null;
      }));
    });
    // Sayı ve süre sütunları metin değil değere göre sıralansın (hücre metni "1 sa 5 dk" gibi).
    const model = this.__table.getTableModel();
    [[3, "count"], [4, "total"], [5, "longest"], [6, "lastAt"]].forEach(([col, key]) => {
      const cmp = (a, b) => this.__rawOf(a)[key] - this.__rawOf(b)[key];
      model.setSortMethods(col, { ascending: cmp, descending: (a, b) => cmp(b, a) });
    });
    const sm = this.__table.getSelectionModel();
    sm.addListener("changeSelection", () => {
      const row = sm.isSelectionEmpty() ? null : model.getRowData(sm.getLeadSelectionIndex());
      onSelect(row ? row[1] : null, row ? row[2] : null);
    });
    this.__table.setToolTipText("Bir satır seçin: aşağıda yalnız o tahtanın o bulgusunun kayıtları görünür");
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
        const g = groups[key] || (groups[key] = { board: a.board, kind: a.kindLabel, desc: a.kindDesc || "", count: 0, total: 0, longest: 0, lastAt: 0, open: false });
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

    /** Tahta süzgecini verilen adla doldurur (Durum'dan çift tık). */
    filterBoard(board) {
      this.__table.getSelectionModel().resetSelection();
      this.__filterFields.board.setValue(board || "");
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
