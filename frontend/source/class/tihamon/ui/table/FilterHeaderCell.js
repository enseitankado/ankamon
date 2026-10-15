/**
 * Sütun başlık hücresi + bunun İÇİNE gömülü süzgeç metin kutusu (etiketin altında, tüm genişliği
 * kaplar) — kullanıcı isteği: "filtreleme satırını grid'in sütununa entegre et" (ayrı bir satır
 * değil, başlığın kendisi). qx.ui.table.headerrenderer.HeaderCell GERÇEKTEN bir
 * qx.ui.container.Composite (Grid düzeni, satır 0 = simge/etiket/sıra oku) — bkz. framework
 * kaynağı; burada eklenen satır 1 metin kutusunu üç sütunu da (simge/etiket/sıra oku) kaplayacak
 * şekilde (colSpan) yerleştirir.
 */
qx.Class.define("tihamon.ui.table.FilterHeaderCell", {
  extend: qx.ui.table.headerrenderer.HeaderCell,

  construct() {
    super();
    // Görünüm (kullanıcı isteği: eski kutu "kaba" görünüyordu — temanın tam boy, alt çizgili metin
    // kutusu + sütun adının gri tekrarı): alçak, küçük yazılı, ince çerçeveli yuvarlak kutu; odakta
    // vurgu rengi. Renkler bütün temalarda tanımlı ortak adlardır (app-border/app-background/primary),
    // açık ve koyu temaya kendiliğinden uyar. İpucu metni sütun adını tekrarlamaz (bkz. Base
    // _addColumnFilters).
    const deco = tihamon.ui.table.FilterHeaderCell.__decorator;
    this.__filterField = new qx.ui.form.TextField().set({
      liveUpdate: true,
      allowGrowX: true,
      marginTop: 3,
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
    this._add(this.__filterField, { row: 1, column: 0, colSpan: 3 });
  },

  statics: {
    __decorators: {},

    /** Paylaşılan (sütun başına yeni nesne üretmeyen) kutu çerçevesi: normal ya da odaklı. */
    __decorator(focused) {
      const key = focused ? "focused" : "normal";
      const cache = tihamon.ui.table.FilterHeaderCell.__decorators;
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

    getFilterField() {
      return this.__filterField;
    }
  }
});
