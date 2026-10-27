/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Alt satırlı (katlanır) grid'ler için tablo modeli: başlığa tıklayınca satırları KENDİSİ sıralamaz,
 * yalnız sıralama durumunu (sütun + yön, başlıktaki ok) tutar ve sayfanın verdiği geri çağrıyı
 * çağırır. Sayfa üst satırları (ör. cihazlar) sıralar, her birinin açık alt satırlarını (ör. servisler)
 * hemen altına ekleyip `setData(rows, false)` ile yükler — düz Simple model alt satırları üst
 * satırlarından koparıp tablonun her yerine dağıtırdı. Bkz. page.Network.
 */
qx.Class.define("ankamon.ui.table.GroupModel", {
  extend: qx.ui.table.model.Simple,

  /** @param onSort {Function} (columnIndex, ascending) — veriyi yeniden dizip setData(…, false) çağırmalı */
  construct(onSort) {
    super();
    this.__onSort = onSort;
  },

  members: {
    __onSort: null,

    // overridden
    sortByColumn(columnIndex, ascending) {
      this._setSortColumnIndex(columnIndex);
      this._setSortAscending(ascending);
      this.__onSort(columnIndex, ascending);
      this.fireDataEvent("sorted", { columnIndex, ascending });
      this.fireEvent("metaDataChanged");
    }
  }
});
