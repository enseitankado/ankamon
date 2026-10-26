/**
 * qooxdoo'nun hazır "Tangible Açık" renk teması (stok mor vurgu #6200ee korunur) — yalnız
 * Ankamon'un "app-*" takma adları eklenir. text-primary-on-surface eklenmez: ColorEngine
 * (bkz. tangible.ColorEngine) bunu zaten primary/surface'tan otomatik hesaplar.
 */
qx.Theme.define("ankamon.theme.ColorTangibleLight", {
  extend: qx.theme.tangible.ColorLight,

  colors: {
    "app-background": "#f5f5f5",
    "app-header": "#341a78",
    "app-header-text": "#ffffff",
    "app-nav": "#fafafa",
    "app-border": "#e0e0e0",
    "app-muted": "#666666",
    "app-ok": "#2e7d32",
    "app-warn": "#e65100"
  }
});
