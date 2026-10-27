/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** "Açık Yeşil" tema: yeşil vurgu + açık yüzeyler, aksi halde ankamon.theme.Theme ile aynı. */
qx.Theme.define("ankamon.theme.ThemeGreenLight", {
  meta: {
    color: ankamon.theme.ColorGreenLight,
    decoration: qx.theme.tangible.Decoration,
    font: ankamon.theme.Font,
    icon: qx.theme.icon.Tango,
    appearance: qx.theme.tangible.Appearance
  }
});
