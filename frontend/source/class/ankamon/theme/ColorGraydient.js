/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * GraydientTheme (goldim/scro34, MIT) — gri degrade, CSS tabanlı hafif masaüstü görünümü.
 * Temanın kendi renklerine Ankamon kabuğunun (başlık, sol menü, kenarlık…) kullandığı "app-*" ve ortak
 * (surface, error, text-primary-on-surface…) takma adları eklenir. Tema kaynağı: frontend/themes/ (VENDORED.txt).
 */
qx.Theme.define("ankamon.theme.ColorGraydient", {
  extend: graydienttheme.theme.Color,

  colors: {
    "primary": "#3E6CA8",
    "secondary": "#6E6E6E",
    "surface": "#FAFAFA",
    "error": "#CC0000",
    "text": "#101010",
    "text-primary-on-surface": "#101010",
    "app-background": "#E0E0E0",
    "app-header": "#3A3A3A",
    "app-header-text": "#ffffff",
    "app-nav": "#F0F0F0",
    "app-border": "#CECECE",
    "app-muted": "#5a5a5a",
    "app-ok": "#2e7d32",
    "app-warn": "#e65100",
    "app-error": "#CC0000"
  }
});
