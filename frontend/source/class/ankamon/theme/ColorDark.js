/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * DarkTheme (goldim/scro34, MIT) — koyu degrade masaüstü görünümü.
 * Temanın kendi renklerine Ankamon kabuğunun (başlık, sol menü, kenarlık…) kullandığı "app-*" ve ortak
 * (surface, error, text-primary-on-surface…) takma adları eklenir. Tema kaynağı: frontend/themes/ (VENDORED.txt).
 */
qx.Theme.define("ankamon.theme.ColorDark", {
  extend: darktheme.theme.Color,

  colors: {
    "primary": "#5FA0B0",
    "secondary": "#9A9A9A",
    "surface": "#4A4A4A",
    "error": "#EF5350",
    "text": "#ffffff",
    "text-primary-on-surface": "#ffffff",
    "app-background": "#3C3C3C",
    "app-header": "#1E1E1E",
    "app-header-text": "#ffffff",
    "app-nav": "#484848",
    "app-border": "#1A1A1A",
    "app-muted": "#B8B8B8",
    "app-ok": "#66BB6A",
    "app-warn": "#FFA726",
    "app-error": "#EF5350"
  }
});
