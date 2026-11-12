/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * UYUMLULUK (terim geçişi 2026-11-12): eski ad. Yeni kod ankamon.ui.devices.ActionBar kullanır; eklentiler
 * (new ankamon.ui.boards.ActionBar(...)) bozulmasın diye aynı sınıfın alt sınıfı. Yeni işlev eklemeyin.
 */
qx.Class.define("ankamon.ui.boards.ActionBar", {
  extend: ankamon.ui.devices.ActionBar
});
