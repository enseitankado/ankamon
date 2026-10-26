/**
 * Kullanıcının seçebileceği temalar: sunucudaki `users.theme` anahtarı ↔ qx Meta tema sınıfı.
 * Anahtarlar backend AuthApi::THEMES ile birebir eşleşmeli.
 */
qx.Class.define("ankamon.theme.Registry", {
  type: "static",

  statics: {
    THEMES: {
      "blue-light": { theme: ankamon.theme.Theme, label: "Açık (Mavi)" },
      "blue-dark": { theme: ankamon.theme.ThemeBlueDark, label: "Koyu (Mavi)" },
      "green-light": { theme: ankamon.theme.ThemeGreenLight, label: "Açık (Yeşil)" },
      "purple-dark": { theme: ankamon.theme.ThemePurpleDark, label: "Koyu (Mor)" },
      // qooxdoo'nun kendi hazır temaları (yalnız Ankamon'un kabuk renkleri için app-* takma
      // adları eklendi — bkz. ilgili ThemeXxx.js/ColorXxx.js dosyaları).
      "qx-classic": { theme: ankamon.theme.ThemeClassic, label: "Classic (qooxdoo)" },
      "qx-modern": { theme: ankamon.theme.ThemeModern, label: "Modern (qooxdoo)" },
      "qx-simple": { theme: ankamon.theme.ThemeSimple, label: "Simple (qooxdoo)" },
      "qx-indigo": { theme: ankamon.theme.ThemeIndigo, label: "Indigo (qooxdoo)" },
      "qx-indigo-dark": { theme: ankamon.theme.ThemeIndigoDark, label: "Indigo Koyu (qooxdoo)" },
      "qx-tangible-light": { theme: ankamon.theme.ThemeTangibleLight, label: "Tangible Açık (qooxdoo)" },
      "qx-tangible-dark": { theme: ankamon.theme.ThemeTangibleDark, label: "Tangible Koyu (qooxdoo)" },
      // Topluluk temaları (MIT; frontend/themes/ altına gömülü — her birinde VENDORED.txt kaynak/commit
      // bilgisini taşır). Windows tarzı olanlar önce.
      "fluent-light": { theme: ankamon.theme.ThemeFluentLight, label: "Fluent Açık (Windows 11)", fluent: true },
      "fluent-dark": { theme: ankamon.theme.ThemeFluentDark, label: "Fluent Koyu (Windows 11)", fluent: true },
      // macOS ve Linux görünümleri: hazır qooxdoo teması yok — Fluent'ten renk/yazı tipiyle türetildi (bkz. Derive).
      "macos-light": { theme: ankamon.theme.ThemeMacLight, label: "macOS Açık", fluent: true },
      "macos-dark": { theme: ankamon.theme.ThemeMacDark, label: "macOS Koyu", fluent: true },
      "gnome-light": { theme: ankamon.theme.ThemeGnomeLight, label: "GNOME Açık (Linux)", fluent: true },
      "gnome-dark": { theme: ankamon.theme.ThemeGnomeDark, label: "GNOME Koyu (Linux)", fluent: true },
      "ubuntu": { theme: ankamon.theme.ThemeUbuntu, label: "Ubuntu (Yaru, Linux)", fluent: true },
      "silverblue": { theme: ankamon.theme.ThemeSilverBlue, label: "Gümüş Mavi (Windows 7 tarzı)" },
      "graydient": { theme: ankamon.theme.ThemeGraydient, label: "Graydient (gri degrade)" },
      "darktheme": { theme: ankamon.theme.ThemeDark, label: "Dark (koyu degrade)" },
      "bernstein": { theme: ankamon.theme.ThemeBernstein, label: "Bernstein (koyu amber)" }
    },
    DEFAULT: "blue-light",

    /** Verilen anahtara karşılık gelen temayı anında uygular; bilinmeyen/boş anahtar varsayılana düşer. */
    apply(key) {
      const entry = this.THEMES[key] || this.THEMES[this.DEFAULT];
      if (entry.fluent) {
        this.__setupFluent();
      }
      qx.theme.manager.Meta.getInstance().setTheme(entry.theme);
    },

    __fluentReady: false,

    /**
     * ville.Fluent görünümünün beklediği ek özellikler (Image.html/clipPath, Atom.iconProps, menü açılış
     * animasyonu, sekme işareti) qooxdoo sınıflarına mixin ile eklenir — yalnız Fluent ilk kez seçildiğinde,
     * bir kez (özgün tema bunu tanımlanırken yapıyordu ve uygulama açılmıyordu; bkz. themes/fluent/VENDORED.txt).
     * Mixin'ler eklendikten sonra başka temaya geçilse de zararsızdır (MMenu yamalı: animasyon yoksa atlar).
     */
    __setupFluent() {
      if (this.__fluentReady) {
        return;
      }
      this.__fluentReady = true;
      qx.Class.include(qx.ui.basic.Image, ville.theme.MImage);
      qx.Class.include(qx.ui.basic.Atom, ville.theme.MEmbed);
      qx.Class.include(qx.ui.menu.AbstractButton, ville.theme.MEmbed);
      qx.Class.include(qx.ui.menu.Menu, ville.theme.MMenu);
      qx.Class.include(qx.ui.tabview.TabView, ville.theme.MTabView);
    }
  }
});
