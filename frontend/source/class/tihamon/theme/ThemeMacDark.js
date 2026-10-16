/**
 * macOS (Aqua) görünümü, koyu. Anahtar: "macos-dark" (bkz. Registry). Görünüm ve süsleme ville.Fluent'inki, renk/yazı tipi
 * türetilmiş (bkz. Derive, ColorMacDark, FontMac).
 * @asset(ville/theme/fluent/decoration/*)
 */
qx.Theme.define("tihamon.theme.ThemeMacDark", {
  meta: {
    color: tihamon.theme.ColorMacDark,
    decoration: ville.theme.fluent.Decoration,
    font: tihamon.theme.FontMac,
    icon: qx.theme.icon.Tango,
    appearance: ville.theme.fluent.Appearance
  }
});
