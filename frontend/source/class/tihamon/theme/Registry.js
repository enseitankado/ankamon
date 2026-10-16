/**
 * Kullanıcının seçebileceği temalar: sunucudaki `users.theme` anahtarı ↔ qx Meta tema sınıfı.
 * Anahtarlar backend AuthApi::THEMES ile birebir eşleşmeli.
 */
qx.Class.define("tihamon.theme.Registry", {
  type: "static",

  statics: {
    THEMES: {
      "blue-light": { theme: tihamon.theme.Theme, label: "Açık (Mavi)" },
      "blue-dark": { theme: tihamon.theme.ThemeBlueDark, label: "Koyu (Mavi)" },
      "green-light": { theme: tihamon.theme.ThemeGreenLight, label: "Açık (Yeşil)" },
      "purple-dark": { theme: tihamon.theme.ThemePurpleDark, label: "Koyu (Mor)" },
      // qooxdoo'nun kendi hazır temaları (yalnız Tiha-Mon'un kabuk renkleri için app-* takma
      // adları eklendi — bkz. ilgili ThemeXxx.js/ColorXxx.js dosyaları).
      "qx-classic": { theme: tihamon.theme.ThemeClassic, label: "Classic (qooxdoo)" },
      "qx-modern": { theme: tihamon.theme.ThemeModern, label: "Modern (qooxdoo)" },
      "qx-simple": { theme: tihamon.theme.ThemeSimple, label: "Simple (qooxdoo)" },
      "qx-indigo": { theme: tihamon.theme.ThemeIndigo, label: "Indigo (qooxdoo)" },
      "qx-indigo-dark": { theme: tihamon.theme.ThemeIndigoDark, label: "Indigo Koyu (qooxdoo)" },
      "qx-tangible-light": { theme: tihamon.theme.ThemeTangibleLight, label: "Tangible Açık (qooxdoo)" },
      "qx-tangible-dark": { theme: tihamon.theme.ThemeTangibleDark, label: "Tangible Koyu (qooxdoo)" },
      // Topluluk temaları (MIT; frontend/themes/ altına gömülü — her birinde VENDORED.txt kaynak/commit
      // bilgisini taşır). Windows tarzı olanlar önce.
      "fluent-light": { theme: tihamon.theme.ThemeFluentLight, label: "Fluent Açık (Windows 11)", fluent: true },
      "fluent-dark": { theme: tihamon.theme.ThemeFluentDark, label: "Fluent Koyu (Windows 11)", fluent: true },
      // macOS ve Linux görünümleri: hazır qooxdoo teması yok — Fluent'ten renk/yazı tipiyle türetildi (bkz. Derive).
      "macos-light": { theme: tihamon.theme.ThemeMacLight, label: "macOS Açık", fluent: true },
      "macos-dark": { theme: tihamon.theme.ThemeMacDark, label: "macOS Koyu", fluent: true },
      "gnome-light": { theme: tihamon.theme.ThemeGnomeLight, label: "GNOME Açık (Linux)", fluent: true },
      "gnome-dark": { theme: tihamon.theme.ThemeGnomeDark, label: "GNOME Koyu (Linux)", fluent: true },
      "ubuntu": { theme: tihamon.theme.ThemeUbuntu, label: "Ubuntu (Yaru, Linux)", fluent: true },
      "silverblue": { theme: tihamon.theme.ThemeSilverBlue, label: "Gümüş Mavi (Windows 7 tarzı)" },
      "graydient": { theme: tihamon.theme.ThemeGraydient, label: "Graydient (gri degrade)" },
      "darktheme": { theme: tihamon.theme.ThemeDark, label: "Dark (koyu degrade)" },
      "bernstein": { theme: tihamon.theme.ThemeBernstein, label: "Bernstein (koyu amber)" }
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
