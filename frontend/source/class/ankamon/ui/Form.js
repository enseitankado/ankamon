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

/** Etiket + alan satırlarından oluşan basit form ızgarası. */
qx.Class.define("ankamon.ui.Form", {
  extend: qx.ui.container.Composite,

  construct() {
    const layout = new qx.ui.layout.Grid(10, 8);
    layout.setColumnFlex(1, 1);
    layout.setColumnAlign(0, "left", "middle");
    super(layout);
    this.__row = 0;
    this.__fields = {};
  },

  members: {
    __row: null,
    __fields: null,

    /** Alan ekler ve geri döner. */
    addField(key, label, widget) {
      this.add(new qx.ui.basic.Label(label), { row: this.__row, column: 0 });
      this.add(widget, { row: this.__row, column: 1 });
      this.__fields[key] = widget;
      this.__row++;
      return widget;
    },

    text(key, label, value, placeholder) {
      return this.addField(key, label, new qx.ui.form.TextField(value || "").set({ placeholder: placeholder || null }));
    },

    password(key, label, placeholder) {
      return this.addField(key, label, new qx.ui.form.PasswordField().set({ placeholder: placeholder || null }));
    },

    check(key, label, value) {
      return this.addField(key, label, new qx.ui.form.CheckBox().set({ value: !!value }));
    },

    /** @param options {Array} [{value, label}] */
    select(key, label, options, value) {
      const box = new qx.ui.form.SelectBox();
      options.forEach(option => {
        const item = new qx.ui.form.ListItem(option.label, null, option.value);
        box.add(item);
        if (option.value === value) {
          box.setSelection([item]);
        }
      });
      return this.addField(key, label, box);
    },

    /** Bütün alanların değerleri: anahtar → değer. */
    values() {
      const values = {};
      Object.entries(this.__fields).forEach(([key, widget]) => {
        if (widget instanceof qx.ui.form.SelectBox) {
          const item = widget.getSelection()[0];
          values[key] = item ? item.getModel() : "";
        } else {
          const value = widget.getValue();
          values[key] = typeof value === "string" ? value.trim() : value;
        }
      });
      return values;
    }
  }
});
