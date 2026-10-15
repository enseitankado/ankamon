/**
 * Windows 11 benzeri temiz açık tema: qooxdoo Tangible (düz/flat) renk motoru üzerine
 * beyaz yüzeyler, açık gri paneller ve canlı mavi vurgu.
 */
qx.Theme.define("tihamon.theme.Color", {
  extend: qx.theme.tangible.ColorLight,

  colors: {
    // Ana renkler (motor geri kalan tonları bunlardan türetir)
    primary: "#0067c0",
    secondary: "#107c10",
    surface: "#ffffff",
    error: "#c42b1c",

    // Uygulamaya özgü yüzeyler — Windows 11 açık paleti
    "app-background": "#f3f3f3",
    "app-header": "#1f3b5c",
    "app-header-text": "#ffffff",
    "app-nav": "#fafafa",
    "app-border": "#e5e5e5",
    "app-muted": "#5f6b7a",
    "app-ok": "#107c10",
    "app-warn": "#9d5d00"
  }
});
