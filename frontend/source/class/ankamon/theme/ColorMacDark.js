/**
 * macOS (Aqua) görünümü, koyu — ville.Fluent paletinden türetilmiş (vurgu #0A84FF, bkz. Derive.colors) + Ankamon
 * kabuğunun "app-*" ve ortak (surface, error, text-primary-on-surface…) takma adları.
 *
 * Derive tanım anında çağrıldığından yükleme bağımlılığı açıkça bildirilir (derleyici bunu kendisi
 * görmüyor; olmadan paket bu sınıfı Derive'dan önce yükleyip arayüz hiç açılmıyordu).
 * @require(ankamon.theme.Derive)
 */
qx.Theme.define("ankamon.theme.ColorMacDark", {
  extend: ville.theme.fluent.Brand1Dark,

  colors: ankamon.theme.Derive.colors(ville.theme.fluent.Brand1Dark, "#0A84FF", {
    "primary": "#0A84FF",
    "secondary": "#98989D",
    "surface": "#2C2C2E",
    "error": "#FF453A",
    "text": "#F5F5F7",
    "text-primary-on-surface": "#F5F5F7",
    "app-background": "#1E1E1E",
    "app-header": "#323234",
    "app-header-text": "#F5F5F7",
    "app-nav": "#252527",
    "app-border": "#3A3A3C",
    "app-muted": "#98989D",
    "app-ok": "#32D74B",
    "app-warn": "#FF9F0A",
    "app-error": "#FF453A"
  })
});
