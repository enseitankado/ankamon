/**
 * ville.Fluent (sqville, MIT) — Microsoft Fluent UI / Windows 11 tasarım dili, koyu.
 * Temanın kendi renklerine Ankamon kabuğunun (başlık, sol menü, kenarlık…) kullandığı "app-*" ve ortak
 * (surface, error, text-primary-on-surface…) takma adları eklenir. Tema kaynağı: frontend/themes/ (VENDORED.txt).
 */
qx.Theme.define("ankamon.theme.ColorFluentDark", {
  extend: ville.theme.fluent.Brand1Dark,

  colors: {
    "primary": "#479EF5",
    "secondary": "#ADADAD",
    "surface": "#292929",
    "error": "#DC626D",
    "text": "#ffffff",
    "text-primary-on-surface": "#ffffff",
    "app-background": "#1F1F1F",
    "app-header": "#115EA3",
    "app-header-text": "#ffffff",
    "app-nav": "#292929",
    "app-border": "#666666",
    "app-muted": "#ADADAD",
    "app-ok": "#54B054",
    "app-warn": "#F7630C",
    "app-error": "#DC626D"
  }
});
