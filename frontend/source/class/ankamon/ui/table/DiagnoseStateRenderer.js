/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Sağlık ▸ Denetle tablosunun "Genel durum" sütunu: düzey rengi ve kalınlığı (bkz. page.Diagnose LEVEL), süren
 * denetimde ("Denetleniyor…") dönen halka (kalıcı kural — bkz. ui.JobSpinner). Hücre değeri düz metin kalır (süzgeç ve
 * hazır değer listesi onu görür).
 */
qx.Class.define("ankamon.ui.table.DiagnoseStateRenderer", {
  extend: qx.ui.table.cellrenderer.Conditional,

  construct() {
    super();
    const L = ankamon.page.Diagnose.LEVEL;
    Object.values(L).forEach(level => this.addRegex(`^${level.text}$`, null, level.color, null, "bold"));
    this.addRegex(`^${ankamon.ui.table.DiagnoseStateRenderer.UNREACHABLE}$`, null, L.bad.color, null, "bold");
    this.addRegex(`^${ankamon.ui.table.DiagnoseStateRenderer.HALTED}$`, null, L.warn.color, null, "bold");
  },

  statics: {
    RUNNING: "Denetleniyor…",
    QUEUED: "Sırada",
    UNREACHABLE: "Bağlanılamadı",
    HALTED: "Yarıda kaldı"
  },

  members: {
    // overridden
    _getContentHtml(cellInfo) {
      const text = qx.bom.String.escape(this._formatValue(cellInfo));
      return cellInfo.value === ankamon.ui.table.DiagnoseStateRenderer.RUNNING ? ankamon.ui.JobSpinner.label(text) : text;
    }
  }
});
