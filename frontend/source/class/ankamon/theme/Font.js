/** Windows 11 hissi: Segoe UI öncelikli, biraz büyütülmüş yazı tipleri (nesneler ferah görünsün). */
qx.Theme.define("ankamon.theme.Font", {
  extend: qx.theme.tangible.Font,

  fonts: {
    default: {
      size: 15,
      family: ["Segoe UI", "Roboto", "sans-serif"],
      color: "text-primary-on-surface",
      lineHeight: 1.4
    },

    bold: {
      size: 15,
      bold: true,
      family: ["Segoe UI", "Roboto", "sans-serif"],
      color: "text-primary-on-surface"
    },

    headline: {
      size: 22,
      family: ["Segoe UI", "Roboto", "sans-serif"],
      color: "text-primary-on-surface"
    },

    small: {
      size: 13,
      family: ["Segoe UI", "Roboto", "sans-serif"],
      color: "text-primary-on-surface"
    },

    // Süzgeç kutuları (bkz. ui/table/FilterHeaderCell): kutu kalın yazılı sütun başlığının İÇİNDE —
    // ağırlık açıkça "normal" verilmezse girdi ve ipucu (placeholder) metni başlığın kalınlığını devralır.
    "app-filter": {
      size: 13,
      bold: false,
      family: ["Segoe UI", "Roboto", "sans-serif"],
      color: "text-primary-on-surface"
    },

    monospace: {
      size: 13,
      family: ["Consolas", "Cascadia Mono", "monospace"]
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
