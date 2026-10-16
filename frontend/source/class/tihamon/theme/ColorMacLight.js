/**
 * macOS (Aqua) görünümü, açık — ville.Fluent paletinden türetilmiş (vurgu #007AFF, bkz. Derive.colors) + Tiha-Mon
 * kabuğunun "app-*" ve ortak (surface, error, text-primary-on-surface…) takma adları.
 *
 * Derive tanım anında çağrıldığından yükleme bağımlılığı açıkça bildirilir (derleyici bunu kendisi
 * görmüyor; olmadan paket bu sınıfı Derive'dan önce yükleyip arayüz hiç açılmıyordu).
 * @require(tihamon.theme.Derive)
 */
qx.Theme.define("tihamon.theme.ColorMacLight", {
  extend: ville.theme.fluent.Brand1,

  colors: tihamon.theme.Derive.colors(ville.theme.fluent.Brand1, "#007AFF", {
    "primary": "#007AFF",
    "secondary": "#6E6E73",
    "surface": "#FFFFFF",
    "error": "#FF3B30",
    "text": "#1D1D1F",
    "text-primary-on-surface": "#1D1D1F",
    "app-background": "#ECECEC",
    "app-header": "#E3E3E6",
    "app-header-text": "#1D1D1F",
    "app-nav": "#E8E8ED",
    "app-border": "#D2D2D7",
    "app-muted": "#86868B",
    "app-ok": "#28CD41",
    "app-warn": "#C77700",
    "app-error": "#FF3B30"
  })
});
