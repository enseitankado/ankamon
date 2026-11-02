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
 * Oturumlar sayfasının "Sohbet geçmişi" sekmesi: sağ menü "Sohbet"te yazışılan bütün iletiler (bkz. worker screen/chat.py),
 * en yeni üstte; sütunlar süzülebilir. Kayıtlar Disk kullanımı ▸ Sohbet geçmişi'nden silinir.
 */
qx.Class.define("ankamon.ui.sessions.Chats", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Sessions} tablo yardımcıları için */
  construct(page) {
    super("Sohbet geçmişi");
    this.setUserData("key", "chat");
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    const refresh = new qx.ui.form.Button("Yenile");
    refresh.addListener("execute", () => this.load());
    bar.add(refresh);
    this.__status = new qx.ui.basic.Label("").set({ textColor: "app-muted", alignY: "middle" });
    bar.add(this.__status, { flex: 1 });
    this.add(bar);

    this.__columns = [
      { id: "time", label: "Zaman", width: 150 },
      { id: "board", label: "Bilgisayar", width: 190, choices: true },
      { id: "session", label: "Oturum", width: 130, choices: true },
      { id: "direction", label: "Yön", width: 90, choices: true },
      { id: "author", label: "Yazan", width: 130, choices: true },
      { id: "body", label: "İleti" }
    ];
    this.__table = page._createTable(this.__columns, { prefsKey: "chat-history.columns" });
    this.__fields = page._addColumnFilters(this.__table, this.__columns, () => this.__apply(), { rows: () => this.__rows || [] });
    this.add(this.__table, { flex: 1 });
    this.addListener("appear", () => this.load());
  },

  members: {
    __status: null,
    __columns: null,
    __table: null,
    __fields: null,
    __rows: null,

    async load() {
      try {
        const F = ankamon.util.Format;
        const data = await ankamon.io.Api.get("/chat/messages");
        this.__rows = data.messages.map(m => [
          m.id, F.dateTime(m.sent_at * 1000), m.board_name, m.session_username || "",
          m.direction === "out" ? "Ankamon → tahta" : "Tahta → Ankamon", m.author, m.body
        ]);
        this.__apply();
        this.__status.setValue(`${data.messages.length} ileti`);
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    __apply() {
      if (!this.__rows) {
        return;
      }
      const filters = this.__columns
        .map((column, index) => ({ index: index + 1, text: ((this.__fields[column.id] || { getValue: () => "" }).getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
      this.__table.getTableModel().setData(
        this.__rows.filter(cells => filters.every(f => ankamon.page.Base.filterMatch(cells[f.index], f.text))));
    }
  }
});
