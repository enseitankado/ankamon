/**
 * GNOME Adwaita (Linux) görünümü, açık. Anahtar: "gnome-light" (bkz. Registry). Görünüm ve süsleme ville.Fluent'inki, renk/yazı tipi
 * türetilmiş (bkz. Derive, ColorGnomeLight, FontGnome).
 * @asset(ville/theme/fluent/decoration/*)
 */
qx.Theme.define("tihamon.theme.ThemeGnomeLight", {
  meta: {
    color: tihamon.theme.ColorGnomeLight,
    decoration: ville.theme.fluent.Decoration,
    font: tihamon.theme.FontGnome,
    icon: qx.theme.icon.Tango,
    appearance: ville.theme.fluent.Appearance
  }
});
