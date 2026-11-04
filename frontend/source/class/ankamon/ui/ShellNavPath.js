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
 * Üst başlıktaki yol gösterimi: "Ankamon > Bakım > Sensörler". Sayfa başlıklarının yerine geçer (dikey alan
 * kazanılır — kullanıcı isteği). Parçalar "Ankamon" yazısıyla aynı düz metindir (yazı tipi, renk aynı); tıklanınca
 * altına seçenek listesi açılır: altı olan parçada kendi altındakiler, son parçada kardeşleri, "Ankamon"da ana menü.
 * Listedeki dallar alt menüdür; böylece ağacın tamamına buradan da gidilir.
 *
 * Kaynak sol menü ağacıdır (bkz. ui.Shell PAGES / tabs): yol ağaçtaki seçimden, listeler ağacın düğümlerinden
 * türetilir. Yeni sayfa, alt sayfa ya da sekme ağaca eklendiğinde burada da kendiliğinden görünür; ayrıca
 * kayıt gerekmez. Sayfaya hangi yoldan gidilirse gidilsin (menü, bağlantı, sekme) ağaç seçimi eşlenir,
 * yol da onunla güncellenir.
 */
qx.Class.define("ankamon.ui.ShellNavPath", {
  extend: qx.ui.container.Composite,

  construct() {
    super(new qx.ui.layout.HBox(0).set({ alignY: "middle" }));
    this.setBackgroundColor("app-header");
    this.__menus = [];
    this.__parts = [];
    const home = this.__part("Ankamon");
    home.addListener("tap", () => this.__tree && this.__open(home, this.__tree.getRoot().getChildren()));
    this.add(home);
  },

  destruct() {
    this.__dropMenus();
  },

  statics: {
    /** Düğümün yoldaki adı: baştaki simge karakteri atılır (bkz. ui.Shell ICON); düğüm kendi adını da verebilir. */
    text(item) {
      return item.getUserData("ankamon.navText") || String(item.getLabel() || "").replace(/^[^\p{L}\p{N}(]+/u, "");
    }
  },

  members: {
    __tree: null,
    __pick: null,
    __menus: null,
    __parts: null,

    /**
     * @param tree {qx.ui.tree.Tree} sol menü
     * @param pick {Function} (düğüm) → o düğümü seçer (sayfayı açar)
     */
    attach(tree, pick) {
      this.__tree = tree;
      this.__pick = pick;
      tree.addListener("changeSelection", () => this.__render());
      this.__render();
    },

    /** "Ankamon" ile aynı görünüm: tıklanabilir olduğu yalnız imleçten anlaşılır. */
    __part(text) {
      return new qx.ui.basic.Label(text).set({ font: "app-title", textColor: "app-header-text", cursor: "pointer" });
    },

    /** Kökten seçili düğüme kadar olan düğümler. */
    __path() {
      const path = [];
      const root = this.__tree.getRoot();
      for (let item = this.__tree.getSelection()[0]; item && item !== root; item = item.getParent()) {
        path.unshift(item);
      }
      return path;
    },

    __render() {
      this.__parts.forEach(widget => widget.destroy());
      this.__parts = [];
      this.__path().forEach(item => {
        const sep = new qx.ui.basic.Label(">").set({ font: "app-title", textColor: "app-header-text", marginLeft: 8, marginRight: 8 });
        const part = this.__part(ankamon.ui.ShellNavPath.text(item));
        const kids = item.getChildren();
        // Altı varsa altındakiler, yoksa aynı düzeydekiler (ör. Sensörler → Bakım, Sensörler, Ahenk…).
        const parent = item.getParent();
        part.addListener("tap", () => this.__open(part, kids.length ? kids : parent.getChildren()));
        this.add(sep);
        this.add(part);
        this.__parts.push(sep, part);
      });
    },

    __open(anchor, items) {
      qx.ui.menu.Manager.getInstance().hideAll();
      this.__dropMenus();
      const menu = this.__menuOf(items, new Set(this.__path()));
      menu.setOpener(anchor);
      menu.placeToWidget(anchor, true);
      menu.show();
    },

    /** Düğümlerin menüsü; dallar alt menü. Açık yoldaki düğümler kalın. */
    __menuOf(items, current) {
      const menu = new qx.ui.menu.Menu();
      this.__menus.push(menu);
      const entry = (item, submenu) => {
        const text = qx.bom.String.escape(ankamon.ui.ShellNavPath.text(item));
        const button = new qx.ui.menu.Button(current.has(item) ? `<b>${text}</b>` : text, null, null, submenu || null);
        button.getChildControl("label").setRich(true);
        if (!submenu) {
          button.addListener("execute", () => this.__pick(item));
        }
        return button;
      };
      items.forEach(item => {
        const kids = item.getChildren();
        if (!kids.length) {
          menu.add(entry(item));
          return;
        }
        const sub = this.__menuOf(kids, current);
        // Sekmesi olmayan dalın kendi sayfası (ör. Sistem, Ağ) alt menünün başında: sekmeli dalda ilk sekme zaten onu açar.
        if (item.getUserData("page") && !kids.some(kid => kid.getUserData("tab"))) {
          sub.addAt(new qx.ui.menu.Separator(), 0);
          sub.addAt(entry(item), 0);
        }
        menu.add(entry(item, sub));
      });
      return menu;
    },

    __dropMenus() {
      this.__menus.forEach(menu => qx.util.DisposeUtil.destroyContainer(menu));
      this.__menus = [];
    }
  }
});
