/**
 * qooxdoo'nun hazır "Modern" renk temasına Tiha-Mon'un "app-*" takma adları eklenir
 * (bkz. ColorClassic.js'teki aynı gerekçe).
 */
qx.Theme.define("tihamon.theme.ColorModern", {
  extend: qx.theme.modern.Color,

  colors: {
    primary: "#00368A",
    secondary: "#5a6b7a",
    surface: "#F3F3F3",
    error: "#CC0000",
    "text-primary-on-surface": "#000000",

    "app-background": "#DFDFDF",
    "app-header": "#00368A",
    "app-header-text": "#ffffff",
    "app-nav": "#F3F3F3",
    "app-border": "#999999",
    "app-muted": "#555555",
    "app-ok": "#2e7d32",
    "app-warn": "#e65100"
  }
});
