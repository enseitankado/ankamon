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
 * Ağ ▸ Varlıklar'ın kendi araç çubuğu (kullanıcı isteği 2026-11-24): sayfanın işleri (Yenile, Şimdi tara, Servisler,
 * Grup oluştur, Ağlar…) ayrı bir düğme satırında değil, cihaz araç çubuğunun (ui.devices.ActionBar) SOLUNDA, onunla aynı
 * satırda ve aynı görünümde ikinci bir panel olarak durur — dikey alan kazanılır. Görünüm ActionBar'ın ortak
 * yardımcılarından gelir (panelLook, flattenTool, toolHtml); simgeler ui.devices.ActionIcons. İşlev kodu sayfadadır.
 */
qx.Class.define("ankamon.ui.network.AssetToolbar", {
  extend: qx.ui.container.Composite,

  construct() {
    super(new qx.ui.layout.HBox(1).set({ alignY: "middle" }));
    this.__colors = ankamon.ui.devices.ActionBar.panelLook(this);
    this.__flat = new qx.ui.decoration.Decorator().set({ radius: 5 });
    // ActionBar'la aynı dolgu/kenar; sağ kenar boşluğu yanındaki çubuğun sol boşluğuyla birleşir.
    this.set({ padding: [3, 6], margin: [6, 0, 8, 8], allowGrowX: false });
  },

  members: {
    __colors: null,
    __flat: null,

    /**
     * @param spec {Map} {label, icon (ActionIcons adı), tip?, handler: (düğme) → void, menu?: true (yazıya ▾ eklenir)}
     * @return {qx.ui.toolbar.Button}
     */
    addTool(spec) {
      const Bar = ankamon.ui.devices.ActionBar;
      const button = new qx.ui.toolbar.Button("").set({ rich: true, show: "label", center: true, padding: [4, 3], minWidth: 46 });
      button.setUserData("ankamon.assetTool", spec);
      this.setToolLabel(button, spec.label);
      if (spec.tip) {
        button.setToolTipText(spec.tip);
      }
      Bar.flattenTool(button, this.__colors, this.__flat);
      // Kapalı düğme: ActionBar'daki gibi yazı rengi kalır, yalnız opaklık düşer (temanın soluk yazısıyla okunmuyordu).
      button.addListener("changeEnabled", e => button.setOpacity(e.getData() ? 1 : Bar.OFF_OPACITY));
      button.addListener("execute", () => spec.handler(button));
      this.add(button);
      return button;
    },

    /** Düğme yazısı (ör. işaretli sayısıyla "Grup oluştur (3)"); simge aynı kalır. */
    setToolLabel(button, label) {
      const spec = button.getUserData("ankamon.assetTool");
      button.setLabel(ankamon.ui.devices.ActionBar.toolHtml(ankamon.ui.devices.ActionIcons.svg(spec.icon),
        label + (spec.menu ? " ▾" : "")));
    }
  }
});
