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
 * Üstte özet satırı (kaç tahtada sürüyor) ve türlerin açıklaması.
 */
qx.Class.define("ankamon.ui.anomaly.Live", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Anomalies} */
  construct(page) {
    super("Anlık");
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    this.__status = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true });
    this.add(this.__status);
    this.__columns = [
      { id: "board", label: "Tahta", width: 200 },
      { id: "kind", label: "Anomali", width: 140 },
      { id: "started", label: "Başlangıç", width: 150 },
      { id: "duration", label: "Süre", width: 110 },
      { id: "detail", label: "Ayrıntı" }
    ];
    this.__table = page._createTable(this.__columns, { prefsKey: "anomalies.live.columns" });
    this.add(this.__table, { flex: 1 });
    this.__kinds = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true, textColor: "app-muted" });
    this.add(this.__kinds);
  },

  members: {
    __status: null,
    __columns: null,
    __table: null,
    __kinds: null,

    /** @param rows {Array} süren kayıtlar (page.Anomalies._refresh) @param kinds {Map} tür → {label, description} */
    setData(rows, kinds) {
      const F = ankamon.util.Format;
      const now = Date.now() / 1000;
      this.__table.getTableModel().setData(rows.map(a => [
        a.id, a.board, a.kindLabel, F.dateTime(a.started_at * 1000), F.duration(now - a.started_at), a.text
      ]));
      const boards = new Set(rows.map(a => a.host)).size;
      const color = rows.length ? "#d93025" : "#1e8e3e";
      this.__status.setValue(`<span style="font-size:14px;font-weight:bold;color:${color}">` +
        (rows.length ? `Şu an ${boards} tahtada ${rows.length} anomali sürüyor` : "Şu an süren anomali yok") + "</span>");
      const esc = qx.bom.String.escape;
      this.__kinds.setValue(Object.values(kinds).map(k => `<b>${esc(k.label)}</b>: ${esc(k.description)}`).join("<br>"));
    }
  }
});
