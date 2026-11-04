/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Toplu işlem tablolarındaki "Durum" sütunu için hücre çizici: değer verilen "sürüyor" metinlerinden
 * biriyle başlıyorsa önüne dönen halka (ui.JobSpinner) konur; öteki değerler düz metin çizilir. Hücre
 * değeri düz metin kaldığından süzgeç/sıralama değişmez.
 */
qx.Class.define("ankamon.ui.table.JobStateRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  /** @param runningTexts {String[]} "sürüyor" sayılan değer başlangıçları (ör. ["Sürüyor"]) */
  construct(runningTexts) {
    super();
    this.__running = runningTexts;
  },

  members: {
    __running: null,

    // overridden
    _getContentHtml(cellInfo) {
      const text = qx.bom.String.escape(this._formatValue(cellInfo));
      return this.__running.some(r => String(cellInfo.value || "").startsWith(r))
        ? ankamon.ui.JobSpinner.label(text) : text;
    }
  }
});
