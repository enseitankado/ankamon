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
 * Numaralı adım kutusu (kullanıcı isteği: bileşenler ana işlemlere göre gruplanır, sıra numarası büyük ve
 * fark edilir): ince çerçeve, başlıkta vurgu renginde daire içinde numara + adım adı (+ soluk açıklama).
 * Dosyaları dağıt/topla (ui.files.BulkPanel) ve Anomaliler ▸ Tarama (ui.anomaly.Scan) aynı görünümü kullanır.
 */
qx.Class.define("ankamon.ui.StepBox", {
  type: "static",

  statics: {
    /**
     * @param n {Number} adım numarası
     * @param title {String} adım adı
     * @param hint {String?} adın yanındaki soluk açıklama
     * @return {qx.ui.container.Composite} kutu (VBox; ilk çocuğu başlık satırı — HBox, sağına öğe eklenebilir;
     *   içerik çağıran tarafından eklenir)
     */
    create(n, title, hint) {
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({
        padding: [8, 12, 10, 12],
        decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 8 })
      });
      box.add(this.head(n, title, hint));
      return box;
    },

    /** Kutunun başlık satırı: daire içinde numara + adım adı (+ açıklama). */
    head(n, title, hint) {
      const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(10).set({ alignY: "middle" }));
      const esc = qx.bom.String.escape;
      const primary = qx.theme.manager.Color.getInstance().resolve("primary") || "primary";
      head.add(new qx.ui.basic.Label(
        `<span style="display:inline-block;width:30px;height:30px;line-height:30px;border-radius:50%;` +
        `background:${primary};color:#fff;text-align:center;font-weight:700;font-size:17px">${n}</span>`
      ).set({ rich: true, alignY: "middle" }));
      head.add(new qx.ui.basic.Label(`<span style="font-size:15px;font-weight:600">${esc(title)}</span>` +
        (hint ? `  <span style="opacity:.65">${esc(hint)}</span>` : "")).set({ rich: true, alignY: "middle" }));
      return head;
    }
  }
});
