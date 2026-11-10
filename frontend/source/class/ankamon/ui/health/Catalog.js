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
 * Sağlık ▸ Yardım ▸ Denetim türleri (eski ayrı "Denetimler" sekmesi; kullanıcı isteğiyle Yardım'ın içinde): Ankamon'un
 * tahtalara baktığı BÜTÜN denetimler tek tabloda — hangi yoldan (sürekli izleme / SSH denetimi), hangi kaynaktan, nasıl ve
 * ne sıklıkla bakıldığı, bulgu düzeyi ve anlık taranıp taranamadığı. Metinler uzun: satıra çift tıklayınca hepsi bir
 * pencerede okunur ve yönetici sıklık / bulgu düzeyi / anlık taranır ayarlarını değiştirir (bkz. ui.health.CheckTypeWindow).
 *
 * Sürekli izleme denetimleri anomali kurallarıdır (tür bilgileri backend AnomaliesApi::kinds + eklentilerin
 * anomaly_kinds.json'u, yönetici ayarları uygulanmış; /api/board-health "kinds"). SSH denetiminin başlıkları
 * worker/ankamon/executor/diagnose.py'deki gruplardır (aşağıda SSH_GROUPS — oradaki gruplar değişirse burası da güncellenir).
 * Pil gerilimi ve saat eşitlemesi SSH denetiminde değil, sürekli izlemededir (aynı soruya iki ayrı cevap verilmesin).
 */
qx.Class.define("ankamon.ui.health.Catalog", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Anomalies} */
  construct(page) {
    super("Denetim türleri");
    this.setUserData("key", "catalog");
    this.__page = page;
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);
    this.add(new qx.ui.basic.Label(
      "Ankamon'un tahtalara baktığı bütün denetimler. <b>Sürekli izleme</b> tahtaya bağlanmaz: tahtanın gönderdiği " +
      "loglardan, Ankamon'un tahtadan okuduğu ölçümlerden ya da daha önce toplanmış verilerden kendiliğinden çıkarılır. " +
      "<b>SSH denetimi</b> tahtaya SSH ile girip yalnız okuma yapan komutlarla ölçer (tahtada hiçbir şey değiştirilmez). " +
      "<b>Satıra çift tıklayın</b>: bütün ayrıntı" + (page._user.is_admin ? " ve ayarlar (sıklık, bulgu düzeyi, anlık taranır)." : ".")
    ).set({ rich: true, wrap: true, allowGrowX: true }));
    this.__columns = [
      { id: "check", label: "Denetim", width: 200 },
      { id: "path", label: "Yol", width: 120 },
      { id: "source", label: "Kaynak", width: 110 },
      { id: "every", label: "Sıklık", width: 150 },
      { id: "level", label: "Bulgu düzeyi", width: 110 },
      { id: "scan", label: "Anlık taranır", width: 100 },
      { id: "how", label: "Nasıl bakılır", width: 360 },
      { id: "what", label: "Ne arar" }
    ];
    this.__table = page._createTable(this.__columns, { prefsKey: "health.catalog.columns" });
    this.__filters = page._addColumnFilters(this.__table, this.__columns, () => this.__apply(),
      { rows: () => (this.__rows || []).map(r => r.cells) });
    this.__table.setToolTipText("Çift tıklayın: bütün ayrıntı" + (page._user.is_admin ? " ve ayarlar" : ""));
    this.__table.addListener("cellDbltap", e => {
      const id = this.__table.getTableModel().getValue(0, e.getRow());
      const row = (this.__rows || []).find(x => x.cells[0] === id);
      if (row) {
        ankamon.ui.health.CheckTypeWindow.open(row.meta, !!page._user.is_admin, () => page.refresh());
      }
    });
    this.add(this.__table, { flex: 1 });
    this.__count = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
    this.add(this.__count);
  },

  statics: {
    /** SSH denetiminin başlıkları (bkz. worker executor/diagnose.py — g = "…" grupları). */
    SSH_GROUPS: [
      ["Donanım kapasitesi", "Dikkat", "RAM ve disk boyutu, tahtaların ortalamasıyla kıyas."],
      ["Disk sağlığı (SMART)", "Acil / Dikkat / Bilgi", "Diskin kendi sağlık testi, okunamayan sektörler, yıpranma işaretleri, eşiği aşan öznitelikler (Acil), SSD kalan ömrü, disk sıcaklığı, son 7 günde çekirdeğin bildirdiği disk hataları (tahtaya takılan USB bellek / harici diskteki hatalar ayrı ve yalnız Bilgi düzeyinde: çoğu, bellek düzgün çıkarılmadan sökülünce olur)."],
      ["İşlemci sıcaklığı", "Acil / Dikkat", "Son 24 saatin sıcaklık ölçümleri filonun geri kalanıyla kıyaslanır; ısı yüzünden işlemcinin yavaşlatılması. (Ani yükselmeler ayrıca sürekli izlemede: İşlemci sıcaklığı yüksek.)"],
      ["Soğutma ve kasa", "Acil / Dikkat", "İşlemci fanı dönüyor mu, kasa içi sıcaklık."],
      ["Boş disk alanı", "Acil / Dikkat", "Kök dosya sistemi doluluğu, dosya sayısı sınırı (inode)."],
      ["Yazılım güncellemeleri", "Dikkat", "Bekleyen (güvenlik dahil) güncellemeler, paket listesinin yaşı."],
      ["Sistem çalışma koşulları", "Acil / Dikkat", "Düşük RAM, takas alanı yok, mekanik disk, salt-okunur dosya sistemi, bellek yetersizliğinden kapatılan uygulamalar, başarısız servisler, yarım kalmış paket kurulumu, sürekli yüksek yük, yeniden başlatma bekliyor, uzun süredir açık."]
    ],
    SSH_HOW: "Ankamon tahtaya root olarak tek SSH bağlantısı açar, yalnız okuma yapan komutlar çalıştırır (tahta başına 1-2 sn)."
  },

  members: {
    __page: null,
    __columns: null,
    __table: null,
    __filters: null,
    __rows: null,
    __count: null,

    /** @param health {Map} GET /api/board-health yanıtı (kinds, paths, ssh_every, ssh_interval_days, ssh_interval_default) */
    setData(health) {
      const P = ankamon.ui.health.Status.PATH;
      const text = ankamon.ui.health.Status.levelText;
      const paths = health.paths || [];
      const rows = [];
      // Yöneticinin değiştirdiği değerlerin yanında "(ayarlı)".
      const mark = (k, field, value) => value + ((k.overridden || []).includes(field) ? " (ayarlı)" : "");
      if (paths.includes("watch")) {
        Object.entries(health.kinds || {}).forEach(([kind, k]) => {
          const origin = k.origin ? ` (${k.origin} eklentisi)` : "";
          const cells = [kind, k.label + origin, P.watch.text, k.source || "Log", mark(k, "every_s", k.every || ""),
            mark(k, "level", text(k.level || "warn")), mark(k, "scan", k.scan ? "Evet" : "Hayır"), k.source_detail || "", k.description || ""];
          rows.push({ cells, meta: { type: "watch", kind, k, check: cells[1], path: cells[2], source: cells[3], how: cells[7], what: cells[8] } });
        });
      }
      if (paths.includes("ssh")) {
        const days = health.ssh_interval_days;
        const def = health.ssh_interval_default;
        const every = (health.ssh_every || "Haftada bir + elle") + (days !== def ? " (ayarlı)" : "");
        ankamon.ui.health.Catalog.SSH_GROUPS.forEach(([group, level, what]) => {
          const cells = ["ssh:" + group, group, P.ssh.text, "SSH denetimi", every, level, "Evet", ankamon.ui.health.Catalog.SSH_HOW, what];
          rows.push({ cells, meta: { type: "ssh", group, level, check: group, path: cells[2], source: cells[3], how: cells[7],
            what, days, daysDefault: def } });
        });
      }
      this.__rows = rows;
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
      this.__count.setValue(`${shown.length} / ${this.__rows.length} denetim türü`);
    }
  }
});
