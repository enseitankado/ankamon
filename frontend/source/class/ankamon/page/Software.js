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
 * Sistem ▸ Yazılımlar (yalnız yönetici): konteynerdeki kritik yazılımlar — sürüm, durum ve Ankamon'da
 * hangi işlevi sağladığı (backend Api/SoftwareApi.php, GET /api/system/software). Sürümler imaj
 * üretilirken toplanır; veritabanı ve TimescaleDB sürümü canlıdır. Durum: bileşen bir servis olarak
 * çalışıyorsa o servisin anlık durumu (Sistem ▸ Servisler ile aynı kaynak), değilse kurulu olup olmadığı.
 * Satıra çift tıklama projenin sayfasını yeni sekmede açar.
 */
qx.Class.define("ankamon.page.Software", {
  extend: ankamon.page.Base,

  statics: {
    STATE: {
      RUNNING: "✓ Çalışıyor", STARTING: "… Başlıyor", STOPPING: "… Duruyor", BACKOFF: "✗ Tekrar deneniyor",
      STOPPED: "■ Durduruldu", EXITED: "■ Bitti", FATAL: "✗ Başlatılamadı", UNKNOWN: "? Bilinmiyor",
      INSTALLED: "✓ Kurulu", MISSING: "✗ Bulunamadı"
    }
  },

  construct(user) {
    super(user, "Yazılımlar");
    this.__summary = new qx.ui.basic.Label("").set({ rich: true, textColor: "app-muted", selectable: true });
    this.add(this.__summary);
    this.__table = this._createTable([
      { id: "name", label: "Yazılım", width: 210 },
      { id: "version", label: "Sürüm", width: 150 },
      { id: "state", label: "Durum", width: 140 },
      { id: "role", label: "Ankamon'daki işlevi" },
      { id: "service", label: "Servis", width: 140 },
      { id: "category", label: "Grup", width: 120 }
    ], { prefsKey: "software.columns" });
    this.__table.addListener("cellDbltap", e => {
      const row = this.__rows && this.__rows[this.__table.getTableModel().getValue(0, e.getRow())];
      if (row && row.url) {
        window.open(row.url, "_blank", "noopener");
      }
    });
    this.__table.setToolTipText("Çift tıklama: projenin sayfası (yeni sekmede)");
    this.add(this.__table, { flex: 1 });
  },

  members: {
    __summary: null,
    __table: null,
    __rows: null,

    async _refresh() {
      const data = await ankamon.io.Api.get("/system/software");
      const STATE = ankamon.page.Software.STATE;
      this.__rows = data.components;
      this.__table.getTableModel().setData(data.components.map((c, i) => [
        i, c.name, c.version || "bilinmiyor", STATE[c.state] || c.state, c.role, c.service || "—", c.category
      ]));
      const bad = data.components.filter(c => ["FATAL", "BACKOFF", "UNKNOWN", "MISSING", "STOPPED", "EXITED"].includes(c.state));
      const esc = qx.bom.String.escape;
      this.__summary.setValue(
        `${data.components.length} bileşen` +
        (bad.length ? ` · <span style="color:#c42b1c">Dikkat: ${esc(bad.map(c => c.name).join(", "))}</span>` : " · hepsi çalışıyor/kurulu") +
        (data.built_at ? ` · sürümler imajın üretildiği an okundu: ${esc(ankamon.util.Format.dateTime(data.built_at * 1000))}` : "") +
        " · veritabanı ve TimescaleDB sürümü canlı");
    }
  }
});
