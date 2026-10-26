/**
 * SilverBlueTheme (goldim/scro34, MIT) — gümüş-mavi degrade pencereler (Windows Vista/7 klasik görünümüne yakın).
 * Temanın kendi renklerine Ankamon kabuğunun (başlık, sol menü, kenarlık…) kullandığı "app-*" ve ortak
 * (surface, error, text-primary-on-surface…) takma adları eklenir. Tema kaynağı: frontend/themes/ (VENDORED.txt).
 */
qx.Theme.define("ankamon.theme.ColorSilverBlue", {
  extend: silverbluetheme.theme.Color,

  colors: {
    "primary": "#4F7FAF",
    "secondary": "#7F949D",
    "surface": "#FDFDFD",
    "error": "#CC0000",
    "text": "#101010",
    "text-primary-on-surface": "#101010",
    "app-background": "#E4E6E8",
    "app-header": "#5E7A8C",
    "app-header-text": "#ffffff",
    "app-nav": "#F0F2F4",
    "app-border": "#CECECE",
    "app-muted": "#5a5a5a",
    "app-ok": "#2e7d32",
    "app-warn": "#e65100",
    "app-error": "#CC0000"
  }
});
