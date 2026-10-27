/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * GNOME Adwaita (Linux) görünümü, koyu. Anahtar: "gnome-dark" (bkz. Registry). Görünüm ve süsleme ville.Fluent'inki, renk/yazı tipi
 * türetilmiş (bkz. Derive, ColorGnomeDark, FontGnome).
 * @asset(ville/theme/fluent/decoration/*)
 */
qx.Theme.define("ankamon.theme.ThemeGnomeDark", {
  meta: {
    color: ankamon.theme.ColorGnomeDark,
    decoration: ville.theme.fluent.Decoration,
    font: ankamon.theme.FontGnome,
    icon: qx.theme.icon.Tango,
    appearance: ville.theme.fluent.Appearance
  }
});
