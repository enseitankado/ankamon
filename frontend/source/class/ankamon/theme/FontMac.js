/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * macOS görünümü için yazı tipleri: Fluent'inkiler (+ Ankamon app-*) — aile macOS sistem yazı tipi
 * yığınıyla değiştirilmiş (bkz. Derive.fonts). Yazı tipi istemcide yoksa sıradaki aileye düşer.
 *
 * Derive tanım anında çağrıldığından yükleme bağımlılığı açıkça bildirilir (derleyici bunu kendisi
 * görmüyor; olmadan paket bu sınıfı Derive'dan önce yükleyip arayüz hiç açılmıyordu).
 * @require(ankamon.theme.Derive)
 */
qx.Theme.define("ankamon.theme.FontMac", {
  extend: ankamon.theme.FontFluent,

  fonts: ankamon.theme.Derive.fonts(ankamon.theme.FontFluent,
    ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
    ["SF Mono", "Menlo", "Monaco", "DejaVu Sans Mono", "monospace"])
});
