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
 * Onay kutusu sütununun (bkz. page.Base _createTable {checkable}) başlığı: üç durumlu bir onay kutusu
 * (kullanıcı isteği: tüm işaret sütunlu grid'lerde). Tıklanınca grid'de o an GÖSTERİLEN (süzülmüş)
 * işaretlenebilir satırların hepsi işaretlenir ya da işaretleri kaldırılır; kutu da işaretlerin durumunu
 * yansıtır — hepsi ✓, hiçbiri boş, bir kısmı belirsiz (−).
 *
 * Başlık hücresi qx'in Header önbelleğiyle tembel oluşturulur (bkz. FilterHeaderRenderer); oluşan kutular
 * burada tutulur, sync() hepsini günceller.
 */
qx.Class.define("ankamon.ui.table.CheckHeaderRenderer", {
  extend: qx.ui.table.headerrenderer.Default,

  /** @param onToggle {Function} (checked) — kullanıcı kutuya tıklayınca, yeni değerle */
  construct(onToggle) {
    super();
    this.__onToggle = onToggle;
    this.__boxes = [];
    this.__state = false;
  },

  members: {
    __onToggle: null,
    __boxes: null,
    __state: null,
    __syncing: false,

    // overridden
    createHeaderCell(cellInfo) {
      const widget = new qx.ui.table.headerrenderer.HeaderCell();
      this.updateHeaderCell(cellInfo, widget);
      const box = new qx.ui.form.CheckBox().set({ triState: true, value: this.__state, alignX: "center", alignY: "middle" });
      box.setToolTipText("Gösterilen satırların tümünü işaretle / işaretleri kaldır");
      // Başlığın tap/pointerdown'u sıralama ve sütun taşımayı başlatır (bkz. FilterHeaderCell).
      ["tap", "pointerdown", "dbltap"].forEach(type => box.addListener(type, e => e.stopPropagation()));
      box.addListener("changeValue", e => {
        if (!this.__syncing) {
          // Belirsizden (−) tıklama: qx null → true yapar; yani "hepsini işaretle".
          this.__onToggle(e.getData() !== false);
        }
      });
      widget._add(box, { row: 0, column: 0, colSpan: 3 });
      this.__boxes.push(box);
      return widget;
    },

    /**
     * @param checked {Integer} işaretli satır sayısı
     * @param total {Integer} işaretlenebilir (gösterilen) satır sayısı
     */
    sync(checked, total) {
      this.__state = total > 0 && checked === total ? true : checked > 0 ? null : false;
      // Başlık yeniden kurulunca (sütun gizleme/taşıma, tema) eski hücreler atılır; onların kutuları bırakılır.
      this.__boxes = this.__boxes.filter(box => !box.isDisposed());
      this.__syncing = true;
      try {
        this.__boxes.forEach(box => {
          box.setValue(this.__state);
          box.setEnabled(total > 0);
        });
      } finally {
        this.__syncing = false;
      }
    }
  },

  destruct() {
    this.__boxes = null;
  }
});
