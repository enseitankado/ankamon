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

/** Sistem → Veritabanı (/api/system/database): boyut, bağlantılar, hypertable'lar (sıkıştırma kazancı), tablolar. */
qx.Class.define("ankamon.ui.system.Database", {
  extend: ankamon.ui.system.Tab,

  construct(page) {
    super(page, "Veritabanı");
    const { label, scroll } = ankamon.ui.system.Html.box();
    this.__label = label;
    this.add(scroll, { flex: 1 });
  },

  members: {
    __label: null,

    async _load() {
      const d = await ankamon.io.Api.get("/system/database");
      const F = ankamon.util.Format;
      const H = ankamon.ui.system.Html;
      const total = d.connections.reduce((sum, c) => sum + Number(c.n), 0);
      const usage = Math.round(100 * total / d.max_connections);
      this.__label.setValue(H.keyValue([
        {
          title: "Genel", rows: [
            ["Sürüm", `PostgreSQL ${d.version}`],
            ["Toplam boyut", F.bytes(d.size)],
            ["Bağlantılar", { html: H.badge(`${total} / ${d.max_connections} (%${usage})`, usage > 80 ? "bad" : usage > 60 ? "warn" : "ok") }]
          ]
        },
        {
          title: "Zaman serisi tabloları (TimescaleDB)", rows: d.hypertables.map(h => [h.name,
            `${F.bytes(h.bytes)} · ${h.chunks} parça` + (h.before && h.after
              ? ` · sıkıştırılan kısım ${F.bytes(h.before)} → ${F.bytes(h.after)} (×${(h.before / h.after).toFixed(1)})`
              : h.compression ? " · henüz sıkıştırılmış parça yok" : "")])
        },
        { title: "En büyük tablolar", rows: d.tables.map(t => [t.name, `${F.bytes(t.bytes)} · ~${t.rows} satır`]) },
        { title: "Bağlantılar (kullanıcı · uygulama · durum)", rows: d.connections.map(c => [`${c.user} · ${c.application}`, `${c.state}: ${c.n}`]) }
      ]));
    }
  }
});
