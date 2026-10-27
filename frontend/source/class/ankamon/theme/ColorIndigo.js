/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * qooxdoo'nun hazır "Indigo" renk temasına Ankamon'un "app-*" takma adları eklenir
 * (bkz. ColorClassic.js'teki aynı gerekçe).
 */
qx.Theme.define("ankamon.theme.ColorIndigo", {
  extend: qx.theme.indigo.Color,

  colors: {
    primary: "#3D72C9",
    secondary: "#5583D0",
    surface: "#ffffff",
    error: "#CC0000",
    "text-primary-on-surface": "#262626",

    "app-background": "#F4F4F4",
    "app-header": "#2a4f8f",
    "app-header-text": "#ffffff",
    "app-nav": "#ffffff",
    "app-border": "#cccccc",
    "app-muted": "#666666",
    "app-ok": "#2e7d32",
    "app-warn": "#e65100"
  }
});
