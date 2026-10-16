/**
 * GNOME Adwaita (Linux) görünümü, koyu. Anahtar: "gnome-dark" (bkz. Registry). Görünüm ve süsleme ville.Fluent'inki, renk/yazı tipi
 * türetilmiş (bkz. Derive, ColorGnomeDark, FontGnome).
 * @asset(ville/theme/fluent/decoration/*)
 */
qx.Theme.define("tihamon.theme.ThemeGnomeDark", {
  meta: {
    color: tihamon.theme.ColorGnomeDark,
    decoration: ville.theme.fluent.Decoration,
    font: tihamon.theme.FontGnome,
    icon: qx.theme.icon.Tango,
    appearance: ville.theme.fluent.Appearance
  }
});
