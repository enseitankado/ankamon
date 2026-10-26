/**
 * qooxdoo'nun hazır "Indigo Koyu" renk temasına Ankamon'un "app-*" takma adları eklenir
 * (bkz. ColorClassic.js'teki aynı gerekçe).
 */
qx.Theme.define("ankamon.theme.ColorIndigoDark", {
  extend: qx.theme.indigo.ColorDark,

  colors: {
    primary: "#5583D0",
    secondary: "#eeeeee",
    surface: "#333333",
    error: "#ff6659",
    "text-primary-on-surface": "#dddddd",

    "app-background": "#2b2b2b",
    "app-header": "#202531",
    "app-header-text": "#ffffff",
    "app-nav": "#3a3a3a",
    "app-border": "#4d4d4d",
    "app-muted": "#b0b0b0",
    "app-ok": "#66bb6a",
    "app-warn": "#ffb74d"
  }
});
