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
 * Sütun başlık hücresi + bunun İÇİNE gömülü süzgeç metin kutusu (etiketin altında, tüm genişliği
 * kaplar) — kullanıcı isteği: "filtreleme satırını grid'in sütununa entegre et" (ayrı bir satır
 * değil, başlığın kendisi). qx.ui.table.headerrenderer.HeaderCell GERÇEKTEN bir
 * qx.ui.container.Composite (Grid düzeni, satır 0 = simge/etiket/sıra oku) — bkz. framework
 * kaynağı; burada eklenen satır 1 metin kutusunu üç sütunu da (simge/etiket/sıra oku) kaplayacak
 * şekilde (colSpan) yerleştirir.
 */
qx.Class.define("ankamon.ui.table.FilterHeaderCell", {
  extend: qx.ui.table.headerrenderer.HeaderCell,

  construct() {
    super();
    // Görünüm (kullanıcı isteği: eski kutu "kaba" görünüyordu — temanın tam boy, alt çizgili metin
    // kutusu + sütun adının gri tekrarı): alçak, küçük yazılı, ince çerçeveli yuvarlak kutu; odakta
    // vurgu rengi. Renkler bütün temalarda tanımlı ortak adlardır (app-border/app-background/primary),
    // açık ve koyu temaya kendiliğinden uyar. İpucu metni sütun adını tekrarlamaz (bkz. Base
    // _addColumnFilters).
    const deco = ankamon.ui.table.FilterHeaderCell.__decorator;
    this.__filterField = new qx.ui.form.TextField().set({
      liveUpdate: true,
      allowGrowX: true,
      // Etiketle arası dar (1): bazı temalarda (ör. Gümüş Mavi) başlık etiketi 21 px — 3 px'te kutunun
      // alt kenarı başlık satırınca kırpılıyordu (bkz. Base._addColumnFilters setHeaderCellHeight).
      marginTop: 1,
      height: 22,
      padding: [1, 6],
      font: "app-filter", // ince yazı (başlığın kalınlığını devralmaz, bkz. theme/Font.js)
      decorator: deco(false)
    });
    this.__filterField.addListener("focusin", () => this.__filterField.setDecorator(deco(true)));
    this.__filterField.addListener("focusout", () => this.__filterField.setDecorator(deco(false)));
    // Başlığın tap/pointerdown dinleyicisi üst kapsayıcıda (bkz. qx.ui.table.pane.Scroller
    // _onTapHeader) ve KABARCIKLANMA ile çalışır — durdurulmazsa kutuya her tıklama/yazma sütunu
    // sıralamaya çalışır (tablo yeniden çizilir, kutu odağı/yazılan karakter kaybolur).
    this.__filterField.addListener("tap", e => e.stopPropagation());
    this.__filterField.addListener("pointerdown", e => e.stopPropagation());
    this.__filterField.addListener("dbltap", e => e.stopPropagation());
    // Tuşlar da tabloya kabarmasın: qx Table keypress'te Boşluk'u (satır seçimi) ve ok/Home/End/PageUp
    // tuşlarını kendisi işleyip varsayılanı engelliyor — kutuya boşluk yazılamıyordu ("Arge 2" → "Arge2").
    this.__filterField.addListener("keypress", e => e.stopPropagation());
    this.__filterField.addListener("keydown", e => e.stopPropagation());
    // Hazır değer listesi düğmesi (▾): yalnız az çeşitli değerli sütunlarda görünür — görünürlüğü ve
    // açtığı onay kutulu liste Base._addColumnFilters'ta. Kutuyla aynı çerçeve/yükseklik, sağında.
    this.__choiceButton = new qx.ui.form.Button("▾").set({
      height: 22, width: 20, minWidth: 20, padding: [0, 2], marginTop: 1, font: "app-filter",
      decorator: deco(false), visibility: "excluded", focusable: false,
      toolTipText: "Hazır değerlerden seçerek süz (birden çok seçilebilir)"
    });
    ["tap", "pointerdown", "dbltap"].forEach(type => this.__choiceButton.addListener(type, e => e.stopPropagation()));
    const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(2)).set({ alignY: "top" });
    row.add(this.__filterField, { flex: 1 });
    row.add(this.__choiceButton);
    this._add(row, { row: 1, column: 0, colSpan: 3 });
    // Başlık yüksekliğinin fazlası etiket satırına değil kutunun satırına gitsin ve kutu etiketin
    // hemen altında (üste hizalı) dursun: aksi hâlde birçok temada (Açık/Koyu Mavi, Indigo, Simple…)
    // HeaderCell'in Grid'i etiket satırını esnetip kutuyu hücrenin dibine itiyordu — etiketle kutu
    // arası açılıyor, kutunun alt kenarı başlığın alt kenarına yapışıyordu (tarayıcıda ölçüldü).
    const layout = this._getLayout();
    layout.setRowFlex(0, 0);
    layout.setRowFlex(1, 1);
    this.__filterField.setAlignY("top");
  },

  statics: {
    __decorators: {},

    /** Paylaşılan (sütun başına yeni nesne üretmeyen) kutu çerçevesi: normal ya da odaklı. */
    __decorator(focused) {
      const key = focused ? "focused" : "normal";
      const cache = ankamon.ui.table.FilterHeaderCell.__decorators;
      if (!cache[key]) {
        cache[key] = new qx.ui.decoration.Decorator().set({
          width: 1,
          style: "solid",
          color: focused ? "primary" : "app-border",
          radius: 4,
          backgroundColor: "app-background"
        });
      }
      return cache[key];
    }
  },

  members: {
    __filterField: null,
    __choiceButton: null,

    getFilterField() {
      return this.__filterField;
    },

    /** Hazır değer listesini açan düğme (başta gizli — bkz. Base._addColumnFilters). */
    getChoiceButton() {
      return this.__choiceButton;
    }
  }
});
