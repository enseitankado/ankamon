/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * "Koyu" tema: varsayılan mavi vurguyu koyu yüzeyler üzerinde tutar (Windows 11 koyu kip hissi).
 */
qx.Theme.define("ankamon.theme.ColorBlueDark", {
  extend: qx.theme.tangible.ColorDark,

  colors: {
    primary: "#4cc2ff",
    secondary: "#6ccb5f",
    surface: "#202020",
    error: "#ff99a4",

    "app-background": "#1f1f1f",
    "app-header": "#16283f",
    "app-header-text": "#ffffff",
    "app-nav": "#2b2b2b",
    "app-border": "#3a3a3a",
    "app-muted": "#a0a0a0",
    "app-ok": "#6ccb5f",
    "app-warn": "#ffb86b"
  }
});
