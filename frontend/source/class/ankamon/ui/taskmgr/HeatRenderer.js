/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
 * Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
 * https://github.com/enseitankado/ankamon
 *
 * Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
 * GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
 * daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
 * değiştirebilirsiniz.
 *
 * Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
 * YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
 * verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
 *
 * Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
 * dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
 * adresine bakınız.
 *
 * Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
 * parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
 * lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
 * korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
 * kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).
 */

/**
 * Windows Görev Yöneticisi'nin "ısı" hücreleri: sayısal değer, yoğunluğu arttıkça açık sarıdan turuncuya
 * koyulaşan bir zeminle, sağa yaslı çizilir. Zemin yarı saydam turuncudur — açık ve koyu temalarda okunur.
 * @param format {Function} değer → metin
 * @param max {Function|Number} doluluk ölçeği (değer / max → 0..1)
 */
qx.Class.define("ankamon.ui.taskmgr.HeatRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  construct(format, max) {
    super();
    this.__format = format;
    this.__max = max;
    this.setDefaultCellStyle("text-align:right");
  },

  members: {
    __format: null,
    __max: null,

    // overridden
    _getContentHtml(cellInfo) {
      const v = cellInfo.value;
      return v === null || v === undefined || v === "" ? "" : qx.bom.String.escape(this.__format(v, cellInfo.rowData));
    },

    // overridden
    _getCellStyle(cellInfo) {
      let style = super._getCellStyle(cellInfo);
      const v = Number(cellInfo.value);
      if (!(v > 0)) {
        return style;
      }
      const max = typeof this.__max === "function" ? this.__max() : this.__max;
      const f = Math.max(0, Math.min(1, v / (max || 1)));
      // Windows: hafif sarı (#fff4c4) → turuncu (#ffa040); en az %8 görünür zemin.
      const alpha = (0.12 + 0.6 * f).toFixed(2);
      const hue = Math.round(48 - 22 * f);
      style += `;background-color:hsla(${hue},100%,58%,${alpha})`;
      return style;
    }
  }
});
