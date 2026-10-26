/**
 * qooxdoo'nun hazır "Classic" (Windows klasik) renk temasını Ankamon'un kendi kabuk
 * yüzeylerinde (başlık, ağaç, kenarlık vb.) kullanabilmesi için gereken "app-*" takma adları
 * eklenir — qooxdoo'nun kendi Color sınıfı bunları tanımlamaz. Decoration/Appearance/Icon
 * değişmeden qx.theme.classic.* ailesinden kalır (bkz. ThemeClassic.js).
 */
qx.Theme.define("ankamon.theme.ColorClassic", {
  extend: qx.theme.classic.Color,

  colors: {
    primary: "#3E6CA8",
    secondary: "#716F64",
    surface: "#FAFBFE",
    error: "#CC0000",
    "text-primary-on-surface": "#000000",

    "app-background": "#ECE9ED",
    "app-header": "#0A246A",
    "app-header-text": "#ffffff",
    "app-nav": "#F3F0F5",
    "app-border": "#888888",
    "app-muted": "#5a5a5a",
    "app-ok": "#2e7d32",
    "app-warn": "#e65100"
  }
});
