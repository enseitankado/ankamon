/**
 * Ubuntu Yaru (Linux) görünümü — ville.Fluent paletinden türetilmiş (vurgu #E95420, bkz. Derive.colors) + Tiha-Mon
 * kabuğunun "app-*" ve ortak (surface, error, text-primary-on-surface…) takma adları.
 *
 * Derive tanım anında çağrıldığından yükleme bağımlılığı açıkça bildirilir (derleyici bunu kendisi
 * görmüyor; olmadan paket bu sınıfı Derive'dan önce yükleyip arayüz hiç açılmıyordu).
 * @require(tihamon.theme.Derive)
 */
qx.Theme.define("tihamon.theme.ColorUbuntu", {
  extend: ville.theme.fluent.Brand1,

  colors: tihamon.theme.Derive.colors(ville.theme.fluent.Brand1, "#E95420", {
    "primary": "#E95420",
    "secondary": "#787878",
    "surface": "#FFFFFF",
    "error": "#C7162B",
    "text": "#3D3D3D",
    "text-primary-on-surface": "#3D3D3D",
    "app-background": "#FAFAFA",
    "app-header": "#2C001E",
    "app-header-text": "#FFFFFF",
    "app-nav": "#F0F0F0",
    "app-border": "#D8D8D8",
    "app-muted": "#787878",
    "app-ok": "#0E8420",
    "app-warn": "#B85C00",
    "app-error": "#C7162B"
  })
});
