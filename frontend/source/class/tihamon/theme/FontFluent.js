/**
 * ville.Fluent'in yazı tipleri (body1, caption1, title1… — Fluent görünümü bunlara bakar) + Tiha-Mon'un
 * kendi bileşenlerinin kullandığı "app-*" yazı tipleri (bkz. tihamon.theme.Font). Fluent'in "default"u
 * Segoe UI tabanlı olduğundan app-* aileleri de aynı kalır.
 */
qx.Theme.define("tihamon.theme.FontFluent", {
  extend: ville.theme.fluent.Font,

  fonts: {
    "app-filter": {
      size: 13,
      bold: false,
      family: ["Segoe UI", "Roboto", "sans-serif"],
      color: "text-primary-on-surface"
    },

    "app-title": {
      size: 16,
      bold: true,
      family: ["Segoe UI", "Roboto", "sans-serif"]
    },

    "app-stat": {
      size: 26,
      bold: true,
      family: ["Segoe UI", "Roboto", "sans-serif"]
    },

    "app-mono": {
      size: 13,
      family: ["Consolas", "Cascadia Mono", "monospace"]
    }
  }
});
