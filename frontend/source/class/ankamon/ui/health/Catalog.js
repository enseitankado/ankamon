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
 * Tahta sağlığı ▸ Denetimler: Ankamon'un tahtalara baktığı BÜTÜN denetimler tek tabloda — hangi yoldan (sürekli izleme /
 * SSH denetimi), hangi kaynaktan, nasıl ve ne sıklıkla bakıldığı, bulgu düzeyi ve anlık taranıp taranamadığı.
 *
 * Sürekli izleme denetimleri anomali kurallarıdır (tür bilgileri backend AnomaliesApi::KINDS + eklentilerin
 * anomaly_kinds.json'u, /api/board-health "kinds"). SSH denetiminin başlıkları worker/ankamon/executor/diagnose.py'deki gruplardır
 * (aşağıda SSH_GROUPS — oradaki gruplar değişirse burası da güncellenir). Pil gerilimi ve saat eşitlemesi SSH denetiminde
 * değil, sürekli izlemededir (aynı soruya iki ayrı cevap verilmesin).
 */
qx.Class.define("ankamon.ui.health.Catalog", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Anomalies} */
  construct(page) {
    super("Denetimler");
    this.setUserData("key", "catalog");
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);
    this.add(new qx.ui.basic.Label(
      "Ankamon'un tahtalara baktığı bütün denetimler. <b>Sürekli izleme</b> tahtaya bağlanmaz: tahtanın gönderdiği " +
      "loglardan, Ankamon'un tahtadan okuduğu ölçümlerden ya da daha önce toplanmış verilerden kendiliğinden çıkarılır. " +
      "<b>SSH denetimi</b> tahtaya SSH ile girip yalnız okuma yapan komutlarla ölçer (tahtada hiçbir şey değiştirilmez). " +
      "<i>Anlık taranır</i> denetimler <b>Tara</b> sekmesinden seçilen tahtalarda o an da yoklanabilir."
    ).set({ rich: true, wrap: true, allowGrowX: true }));
    this.__columns = [
      { id: "check", label: "Denetim", width: 200 },
      { id: "path", label: "Yol", width: 120 },
      { id: "source", label: "Kaynak", width: 110 },
      { id: "every", label: "Sıklık", width: 140 },
      { id: "level", label: "Bulgu düzeyi", width: 100 },
      { id: "scan", label: "Anlık taranır", width: 100 },
      { id: "how", label: "Nasıl bakılır", width: 360 },
      { id: "what", label: "Ne arar" }
    ];
    this.__table = page._createTable(this.__columns, { prefsKey: "health.catalog.columns" });
    this.__filters = page._addColumnFilters(this.__table, this.__columns, () => this.__apply(),
      { rows: () => (this.__rows || []).map(r => r.cells) });
    this.add(this.__table, { flex: 1 });
    this.__count = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
    this.add(this.__count);
  },

  statics: {
    /** SSH denetiminin başlıkları (bkz. worker executor/diagnose.py — g = "…" grupları). */
    SSH_GROUPS: [
      ["Donanım kapasitesi", "Dikkat", "RAM ve disk boyutu, tahtaların ortalamasıyla kıyas."],
      ["Disk sağlığı (SMART)", "Acil / Dikkat", "Diskin kendi sağlık testi, okunamayan sektörler, yıpranma işaretleri, eşiği aşan öznitelikler (Acil), SSD kalan ömrü, disk sıcaklığı, son 7 günde çekirdeğin bildirdiği disk hataları."],
      ["İşlemci sıcaklığı", "Acil / Dikkat", "Son 24 saatin sıcaklık ölçümleri filonun geri kalanıyla kıyaslanır; ısı yüzünden işlemcinin yavaşlatılması. (Ani yükselmeler ayrıca sürekli izlemede: İşlemci sıcaklığı yüksek.)"],
      ["Soğutma ve kasa", "Acil / Dikkat", "İşlemci fanı dönüyor mu, kasa içi sıcaklık."],
      ["Boş disk alanı", "Acil / Dikkat", "Kök dosya sistemi doluluğu, dosya sayısı sınırı (inode)."],
      ["Yazılım güncellemeleri", "Dikkat", "Bekleyen (güvenlik dahil) güncellemeler, paket listesinin yaşı."],
      ["Sistem çalışma koşulları", "Acil / Dikkat", "Düşük RAM, takas alanı yok, mekanik disk, salt-okunur dosya sistemi, bellek yetersizliğinden kapatılan uygulamalar, başarısız servisler, yarım kalmış paket kurulumu, sürekli yüksek yük, yeniden başlatma bekliyor, uzun süredir açık."]
    ]
  },

  members: {
    __columns: null,
    __table: null,
    __filters: null,
    __rows: null,
    __count: null,

    /** @param kinds {Map} sürekli izleme türleri (boşsa kullanıcının o yola yetkisi yok) @param paths {Array} yetkili yollar */
    setData(kinds, paths) {
      const P = ankamon.ui.health.Status.PATH;
      const text = ankamon.ui.health.Status.levelText;
      const rows = [];
      if (paths.includes("watch")) {
        Object.entries(kinds || {}).forEach(([kind, k]) => {
          const origin = k.origin ? ` (${k.origin} eklentisi)` : "";
          rows.push([kind, k.label + origin, P.watch.text, k.source || "Log", k.every || "", text(k.level || "warn"),
            k.scan ? "Evet" : "Hayır", k.source_detail || "", k.description || ""]);
        });
      }
      if (paths.includes("ssh")) {
        ankamon.ui.health.Catalog.SSH_GROUPS.forEach(([group, level, what]) => {
          rows.push(["ssh:" + group, group, P.ssh.text, "SSH denetimi", "Haftada bir kendiliğinden + elle", level, "Evet",
            "Ankamon tahtaya root olarak tek SSH bağlantısı açar, yalnız okuma yapan komutlar çalıştırır (tahta başına 1-2 sn).", what]);
        });
      }
      this.__rows = rows.map(cells => ({ cells }));
      this.__apply();
    },

    __apply() {
      if (!this.__rows) {
        return;
      }
      const filters = this.__columns
        .map((column, index) => ({ index: index + 1, text: ((this.__filters[column.id] || { getValue: () => "" }).getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
      const shown = this.__rows.filter(({ cells }) => filters.every(f => ankamon.page.Base.filterMatch(cells[f.index], f.text)));
      this.__table.getTableModel().setData(shown.map(r => r.cells));
      this.__count.setValue(`${shown.length} / ${this.__rows.length} denetim`);
    }
  }
});
