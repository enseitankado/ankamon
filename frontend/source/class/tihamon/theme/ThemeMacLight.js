/**
 * macOS (Aqua) görünümü, açık. Anahtar: "macos-light" (bkz. Registry). Görünüm ve süsleme ville.Fluent'inki, renk/yazı tipi
 * türetilmiş (bkz. Derive, ColorMacLight, FontMac).
 * @asset(ville/theme/fluent/decoration/*)
 */
qx.Theme.define("tihamon.theme.ThemeMacLight", {
  meta: {
    color: tihamon.theme.ColorMacLight,
    decoration: ville.theme.fluent.Decoration,
    font: tihamon.theme.FontMac,
    icon: qx.theme.icon.Tango,
    appearance: ville.theme.fluent.Appearance
  }
});
