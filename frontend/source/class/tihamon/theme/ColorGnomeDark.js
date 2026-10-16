/**
 * GNOME Adwaita (Linux) görünümü, koyu — ville.Fluent paletinden türetilmiş (vurgu #3584E4, bkz. Derive.colors) + Tiha-Mon
 * kabuğunun "app-*" ve ortak (surface, error, text-primary-on-surface…) takma adları.
 *
 * Derive tanım anında çağrıldığından yükleme bağımlılığı açıkça bildirilir (derleyici bunu kendisi
 * görmüyor; olmadan paket bu sınıfı Derive'dan önce yükleyip arayüz hiç açılmıyordu).
 * @require(tihamon.theme.Derive)
 */
qx.Theme.define("tihamon.theme.ColorGnomeDark", {
  extend: ville.theme.fluent.Brand1Dark,

  colors: tihamon.theme.Derive.colors(ville.theme.fluent.Brand1Dark, "#3584E4", {
    "primary": "#78AEED",
    "secondary": "#9A9996",
    "surface": "#303030",
    "error": "#FF7B63",
    "text": "#FFFFFF",
    "text-primary-on-surface": "#FFFFFF",
    "app-background": "#242424",
    "app-header": "#303030",
    "app-header-text": "#FFFFFF",
    "app-nav": "#2A2A2A",
    "app-border": "#454545",
    "app-muted": "#9A9996",
    "app-ok": "#33D17A",
    "app-warn": "#F8E45C",
    "app-error": "#FF7B63"
  })
});
