/**
 * GNOME Adwaita (Linux) görünümü, açık — ville.Fluent paletinden türetilmiş (vurgu #3584E4, bkz. Derive.colors) + Ankamon
 * kabuğunun "app-*" ve ortak (surface, error, text-primary-on-surface…) takma adları.
 *
 * Derive tanım anında çağrıldığından yükleme bağımlılığı açıkça bildirilir (derleyici bunu kendisi
 * görmüyor; olmadan paket bu sınıfı Derive'dan önce yükleyip arayüz hiç açılmıyordu).
 * @require(ankamon.theme.Derive)
 */
qx.Theme.define("ankamon.theme.ColorGnomeLight", {
  extend: ville.theme.fluent.Brand1,

  colors: ankamon.theme.Derive.colors(ville.theme.fluent.Brand1, "#3584E4", {
    "primary": "#3584E4",
    "secondary": "#77767B",
    "surface": "#FFFFFF",
    "error": "#E01B24",
    "text": "#2E3436",
    "text-primary-on-surface": "#2E3436",
    "app-background": "#FAFAFA",
    "app-header": "#EBEBEB",
    "app-header-text": "#2E3436",
    "app-nav": "#F2F2F2",
    "app-border": "#D9D9D9",
    "app-muted": "#77767B",
    "app-ok": "#26A269",
    "app-warn": "#C64600",
    "app-error": "#E01B24"
  })
});
