/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * qooxdoo'nun hazır "Simple" renk temasına Ankamon'un "app-*" takma adları eklenir
 * (bkz. ColorClassic.js'teki aynı gerekçe).
 */
qx.Theme.define("ankamon.theme.ColorSimple", {
  extend: qx.theme.simple.Color,

  colors: {
    primary: "#1866B5",
    secondary: "#5685D6",
    surface: "#FAFBFE",
    error: "#CC0000",
    "text-primary-on-surface": "#000000",

    "app-background": "#EEF2F7",
    "app-header": "#134983",
    "app-header-text": "#ffffff",
    "app-nav": "#F7F7F7",
    "app-border": "#999999",
    "app-muted": "#555555",
    "app-ok": "#2e7d32",
    "app-warn": "#e65100"
  }
});
