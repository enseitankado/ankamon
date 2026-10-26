/**
 * Giriş ekranında logo seçim galerisi (geçici: logo seçilince kaldırılacak).
 * Adaylar (hepsi anka kuşlu) 4 sütunda; tıklanan "select" olayıyla bildirilir, seçim tarayıcıda hatırlanır.
 */
qx.Class.define("ankamon.ui.LogoGallery", {
  extend: qx.ui.container.Composite,

  events: {
    /** Seçilen logonun 0 tabanlı sırası. */
    select: "qx.event.type.Data"
  },

  construct() {
    super(new qx.ui.layout.VBox(8));
    this.set({
      padding: 16,
      allowGrowX: false,
      allowGrowY: false,
      backgroundColor: "surface",
      decorator: new qx.ui.decoration.Decorator().set({ radius: 10, width: 1, color: "app-border" })
    });
    this.add(new qx.ui.basic.Label("Logo seçenekleri — önizlemek için birine tıklayın").set({ font: "bold" }));

    const grid = new qx.ui.container.Composite(new qx.ui.layout.Grid(8, 8));
    this.__tiles = ankamon.ui.Logos.LIST.map((L, i) => {
      const tile = new qx.ui.basic.Label(
        `<div style="font-size:11px;opacity:.65;margin-bottom:2px">${i + 1}. ${qx.bom.String.escape(L.name)}</div>` +
        ankamon.ui.Logos.svg(i, 44)
      ).set({ rich: true, padding: [6, 10], cursor: "pointer", textColor: "text" });
      tile.addListener("tap", () => this.setSelected(i));
      grid.add(tile, { row: i >> 2, column: i & 3 });
      return tile;
    });
    this.add(grid);
  },

  statics: {
    KEY: "ankamon.login.logo",

    /** Hatırlanan seçim (yoksa 0). */
    stored() {
      try {
        const n = parseInt(localStorage.getItem(ankamon.ui.LogoGallery.KEY), 10);
        return n >= 0 && n < ankamon.ui.Logos.LIST.length ? n : 0;
      } catch (e) {
        return 0;
      }
    }
  },

  members: {
    __tiles: null,

    setSelected(n) {
      this.__tiles.forEach((t, i) => t.set({
        padding: i === n ? [5, 9] : [6, 10], // kalın çerçeve içeriği kaydırmasın
        decorator: new qx.ui.decoration.Decorator().set({
          radius: 8, width: i === n ? 2 : 1, color: i === n ? "primary" : "app-border"
        })
      }));
      try {
        localStorage.setItem(ankamon.ui.LogoGallery.KEY, String(n));
      } catch (e) {
        // özel pencere vb. — seçim yalnız bu sayfada kalır
      }
      this.fireDataEvent("select", n);
    }
  }
});
