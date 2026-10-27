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
 * Sistem sayfasının (bkz. page.System) sekmelerinin ortak tabanı: üstte durum satırı, sekme her
 * göründüğünde (sekme geçişi, sayfaya dönüş) ve sayfa açılışında load() — ayrı "Yenile"
 * düğmesi yok. Alt sınıflar _load() içinde veriyi alıp kendi içeriğini kurar.
 */
qx.Class.define("ankamon.ui.system.Tab", {
  extend: qx.ui.tabview.Page,
  type: "abstract",

  /**
   * @param page {ankamon.page.Base} tablo yardımcıları (_createTable/_addColumnFilters) için
   * @param label {String} sekme başlığı
   */
  construct(page, label) {
    super(label);
    this._page = page;
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);
    this._bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this._status = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    this._bar.add(this._status, { flex: 1 });
    this.add(this._bar);
    // Eşzamanlı ikinci çağrı (ör. sayfa açılışı + appear) load()'daki __loading ile yutulur.
    this.addListener("appear", () => this.load());
  },

  members: {
    _page: null,
    _bar: null,
    _status: null,
    __loading: false,

    async load() {
      if (this.__loading) {
        return;
      }
      this.__loading = true;
      try {
        await this._load();
        this._status.setValue(this._statusText ? this._statusText() : "");
      } catch (e) {
        this._status.setValue(`<span style="color:#c5221f">Yüklenemedi: ${qx.bom.String.escape(e.message || String(e))}</span>`);
      } finally {
        this.__loading = false;
      }
    },

    /** Sekme gerçekten ekranda mı (TabView seçili olmayan sayfayı "hidden" yapar — isSeeable yetmez). */
    _isShown() {
      return this.isSeeable() && this.getVisibility() === "visible";
    },

    /** @abstract */
    async _load() {}
  }
});
