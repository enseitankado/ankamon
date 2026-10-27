/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * macOS (Aqua) görünümü, açık. Anahtar: "macos-light" (bkz. Registry). Görünüm ve süsleme ville.Fluent'inki, renk/yazı tipi
 * türetilmiş (bkz. Derive, ColorMacLight, FontMac).
 * @asset(ville/theme/fluent/decoration/*)
 */
qx.Theme.define("ankamon.theme.ThemeMacLight", {
  meta: {
    color: ankamon.theme.ColorMacLight,
    decoration: ville.theme.fluent.Decoration,
    font: ankamon.theme.FontMac,
    icon: qx.theme.icon.Tango,
    appearance: ville.theme.fluent.Appearance
  }
});
