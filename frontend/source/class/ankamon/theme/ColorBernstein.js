/**
 * Bernstein (goldim/scro34, MIT) — koyu zemin, amber (kehribar) vurgular.
 * Temanın kendi renklerine Ankamon kabuğunun (başlık, sol menü, kenarlık…) kullandığı "app-*" ve ortak
 * (surface, error, text-primary-on-surface…) takma adları eklenir. Tema kaynağı: frontend/themes/ (VENDORED.txt).
 */
qx.Theme.define("ankamon.theme.ColorBernstein", {
  extend: bernstein.theme.Color,

  colors: {
    "primary": "#D18F14",
    "secondary": "#8A8A8A",
    "surface": "#1E1E1E",
    "error": "#E05A47",
    "text": "#C8C8C8",
    "text-primary-on-surface": "#C8C8C8",
    "app-background": "#171717",
    "app-header": "#0D0D0D",
    "app-header-text": "#E0A030",
    "app-nav": "#1E1E1E",
    "app-border": "#050505",
    "app-muted": "#8A8A8A",
    "app-ok": "#66BB6A",
    "app-warn": "#E0A030",
    "app-error": "#E05A47"
  }
});
