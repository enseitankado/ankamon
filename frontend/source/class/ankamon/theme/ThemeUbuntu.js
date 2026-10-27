/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Ubuntu Yaru (Linux) görünümü. Anahtar: "ubuntu" (bkz. Registry). Görünüm ve süsleme ville.Fluent'inki, renk/yazı tipi
 * türetilmiş (bkz. Derive, ColorUbuntu, FontUbuntu).
 * @asset(ville/theme/fluent/decoration/*)
 */
qx.Theme.define("ankamon.theme.ThemeUbuntu", {
  meta: {
    color: ankamon.theme.ColorUbuntu,
    decoration: ville.theme.fluent.Decoration,
    font: ankamon.theme.FontUbuntu,
    icon: qx.theme.icon.Tango,
    appearance: ville.theme.fluent.Appearance
  }
});
