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
 * Yedekle/Geri al penceresinin onay kutulu listesi: süzgeç kutusu, Tümü/Hiçbiri, kaydırılan liste. Seçim
 * değişince "changeChecked" yayar. Süzgeçle gizlenen öğelerin işareti korunur; Tümü/Hiçbiri yalnız görünenlere uygulanır.
 */
qx.Class.define("ankamon.ui.homebackup.CheckColumn", {
  extend: qx.ui.container.Composite,

  events: {
    changeChecked: "qx.event.type.Event"
  },

  construct() {
    super(new qx.ui.layout.VBox(6));
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(4).set({ alignY: "middle" }));
    this.__filter = new qx.ui.form.TextField().set({ placeholder: "Süz…", liveUpdate: true });
    this.__filter.addListener("changeValue", () => this.__applyFilter());
    bar.add(this.__filter, { flex: 1 });
    [["Tümü", true], ["Hiçbiri", false]].forEach(([label, value]) => {
      const button = new qx.ui.form.Button(label);
      button.addListener("execute", () => this.__setVisible(value));
      bar.add(button);
    });
    this.add(bar);
    this.__box = new qx.ui.container.Composite(new qx.ui.layout.VBox(2)).set({ padding: [4, 6] });
    this.__scroll = new qx.ui.container.Scroll(this.__box).set({
      decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 4 })
    });
    this.add(this.__scroll, { flex: 1 });
    this.__checks = [];
  },

  members: {
    __filter: null,
    __box: null,
    __scroll: null,
    __checks: null,
    __quiet: false,

    /**
     * Listeyi yeniden kurar; aynı değerli öğelerin işareti korunur.
     * @param items {Array} [{value, label, checked?, side?}] side: sağda sütun gibi gösterilen kısa metin (ör. boyut)
     * @param note {String?} liste boşken gösterilecek metin
     */
    setItems(items, note) {
      const was = new Set(this.getChecked());
      this.__box.removeAll().forEach(w => w.destroy());
      this.__checks = items.map(item => {
        const check = new qx.ui.form.CheckBox(item.label).set({ value: was.has(item.value) || !!item.checked });
        check.setUserData("value", item.value);
        check.addListener("changeValue", () => this.__changed());
        if (item.side !== undefined) {
          const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
          row.add(check);
          row.add(new qx.ui.core.Spacer(), { flex: 1 });
          row.add(new qx.ui.basic.Label(item.side).set({ textColor: "app-muted", alignY: "middle", marginRight: 4 }));
          this.__box.add(row);
        } else {
          this.__box.add(check);
        }
        return check;
      });
      if (!items.length && note) {
        this.__box.add(new qx.ui.basic.Label(note).set({ textColor: "app-muted", rich: true, wrap: true }));
      }
      this.__applyFilter();
      this.__changed();
    },

    /** İşaretli öğelerin değerleri (listedeki sırayla). */
    getChecked() {
      return this.__checks.filter(c => c.getValue()).map(c => c.getUserData("value"));
    },

    __changed() {
      if (!this.__quiet) {
        this.fireEvent("changeChecked");
      }
    },

    __setVisible(value) {
      this.__quiet = true;
      this.__checks.filter(c => {
        const parent = c.getLayoutParent();
        return (parent === this.__box ? c : parent).getVisibility() === "visible";
      }).forEach(c => c.setValue(value));
      this.__quiet = false;
      this.__changed();
    },

    __applyFilter() {
      const q = (this.__filter.getValue() || "").toLocaleLowerCase("tr");
      this.__checks.forEach(c => {
        const parent = c.getLayoutParent();
        (parent === this.__box ? c : parent).setVisibility(c.getLabel().toLocaleLowerCase("tr").includes(q) ? "visible" : "excluded");
      });
    }
  }
});
