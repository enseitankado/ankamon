/**
 * ville.Fluent (sqville, MIT) — Microsoft Fluent UI / Windows 11 tasarım dili, açık.
 * Temanın kendi renklerine Ankamon kabuğunun (başlık, sol menü, kenarlık…) kullandığı "app-*" ve ortak
 * (surface, error, text-primary-on-surface…) takma adları eklenir. Tema kaynağı: frontend/themes/ (VENDORED.txt).
 */
qx.Theme.define("ankamon.theme.ColorFluentLight", {
  extend: ville.theme.fluent.Brand1,

  colors: {
    "primary": "#0F6CBD",
    "secondary": "#616161",
    "surface": "#ffffff",
    "error": "#C50F1F",
    "text": "#242424",
    "text-primary-on-surface": "#242424",
    "app-background": "#F5F5F5",
    "app-header": "#0F6CBD",
    "app-header-text": "#ffffff",
    "app-nav": "#FAFAFA",
    "app-border": "#D1D1D1",
    "app-muted": "#616161",
    "app-ok": "#107C10",
    "app-warn": "#BC4B09",
    "app-error": "#C50F1F"
  }
});
