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

  statics: {
    __softSheet: null
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

    /** @param warning {Map?} {note, hint}: kutunun yanında uyarı rengiyle kısa not, üzerine gelince ipucu */
    password(key, label, placeholder, warning) {
      const field = new qx.ui.form.PasswordField().set({ placeholder: placeholder || null });
      if (!warning) {
        return this.addField(key, label, field);
      }
      field.setToolTipText(warning.hint);
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      row.add(field, { flex: 1 });
      row.add(new qx.ui.basic.Label(warning.note).set({ textColor: "app-warn", toolTipText: warning.hint }));
      this.add(new qx.ui.basic.Label(label), { row: this.__row, column: 0 });
      this.add(row, { row: this.__row, column: 1 });
      this.__fields[key] = field;
      this.__row++;
      return field;
    },

    /**
     * Metin alanlarının ipucu (placeholder) yazısı temanın ipucu renginden daha açık/soluk (kullanıcı isteği 2026-11-10,
     * Tahta ekle: örnek değerler girilmiş değer sanılmasın). Renk temanın "text-placeholder"ının yarı saydamı — açık
     * temada açılır, koyu temada söner; tema değişince pencere yeniden açıldığında yeni renk. Firefox'un ::placeholder
     * opacity'si (0.54) sıfırlanır ki iki tarayıcıda aynı görünsün.
     */
    softPlaceholders() {
      const color = qx.theme.manager.Color.getInstance().resolve("text-placeholder") || "#888";
      const rule = `color:color-mix(in srgb, ${color} 65%, transparent) !important;opacity:1`;
      const sheet = ankamon.ui.Form.__softSheet || (ankamon.ui.Form.__softSheet = qx.bom.Stylesheet.createElement(""));
      qx.bom.Stylesheet.removeAllRules(sheet);
      ["::placeholder", "::-webkit-input-placeholder"].forEach(pseudo => {
        try {
          qx.bom.Stylesheet.addRule(sheet, `input.ankamon-soft-placeholder${pseudo}, textarea.ankamon-soft-placeholder${pseudo}`, rule);
        } catch (e) {
          // tarayıcı bu sözde öğeyi tanımıyor: diğeri yeter
        }
      });
      Object.values(this.__fields).forEach(widget => {
        if (widget instanceof qx.ui.form.AbstractField) {
          widget.getContentElement().addClass("ankamon-soft-placeholder");
        }
      });
      return this;
    },

    /** Daha önce eklenmiş alan. */
    getField(key) {
      return this.__fields[key];
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
