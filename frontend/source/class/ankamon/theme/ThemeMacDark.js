/**
 * macOS (Aqua) görünümü, koyu. Anahtar: "macos-dark" (bkz. Registry). Görünüm ve süsleme ville.Fluent'inki, renk/yazı tipi
 * türetilmiş (bkz. Derive, ColorMacDark, FontMac).
 * @asset(ville/theme/fluent/decoration/*)
 */
qx.Theme.define("ankamon.theme.ThemeMacDark", {
  meta: {
    color: ankamon.theme.ColorMacDark,
    decoration: ville.theme.fluent.Decoration,
    font: ankamon.theme.FontMac,
    icon: qx.theme.icon.Tango,
    appearance: ville.theme.fluent.Appearance
  }
});
