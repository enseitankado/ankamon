/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * qooxdoo'nun hazır "Tangible Koyu" renk teması (stok teal vurgu #26a69a korunur) — yalnız
 * Ankamon'un "app-*" takma adları eklenir (bkz. ColorTangibleLight.js'teki aynı gerekçe).
 */
qx.Theme.define("ankamon.theme.ColorTangibleDark", {
  extend: qx.theme.tangible.ColorDark,

  colors: {
    "app-background": "#263238",
    "app-header": "#1a2327",
    "app-header-text": "#ffffff",
    "app-nav": "#37474f",
    "app-border": "#4b5a62",
    "app-muted": "#b0bec5",
    "app-ok": "#66bb6a",
    "app-warn": "#ffb74d"
  }
});
