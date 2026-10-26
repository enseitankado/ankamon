/**
 * GNOME Adwaita (Linux) görünümü, açık. Anahtar: "gnome-light" (bkz. Registry). Görünüm ve süsleme ville.Fluent'inki, renk/yazı tipi
 * türetilmiş (bkz. Derive, ColorGnomeLight, FontGnome).
 * @asset(ville/theme/fluent/decoration/*)
 */
qx.Theme.define("ankamon.theme.ThemeGnomeLight", {
  meta: {
    color: ankamon.theme.ColorGnomeLight,
    decoration: ville.theme.fluent.Decoration,
    font: ankamon.theme.FontGnome,
    icon: qx.theme.icon.Tango,
    appearance: ville.theme.fluent.Appearance
  }
});
