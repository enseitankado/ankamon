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
 * Wi-Fi Monitör grid'inin hücre çizicisi (bkz. ui.boards.WifimonRender): hücrenin HTML'i ve ipucu (title — fare kayınca kapanır,
 * bkz. ui.ToolTipPolicy) satır kimliğine bağlı ek veriden gelir; hücre değeri düz metindir (süzgeç ve sıralama onu kullanır).
 * Hücreler sola yaslıdır (sayılar dahil — qx'in sayıyı sağa yaslaması kapalı: sinyal göstergeleri alt alta hizalı); uzun metin
 * hücre içinde üç noktayla kırpılır, tamamı ipucundadır.
 */
qx.Class.define("ankamon.ui.boards.WifimonCellRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  /**
   * @param html {Function?} (cellInfo) → String|null — null: değerin kendisi (kaçışlı)
   * @param hint {Function?} (cellInfo) → String|null
   */
  construct(html, hint) {
    super();
    this.setUseAutoAlign(false);
    this.__wifimonHtml = html || null;
    this.__wifimonHint = hint || null;
  },

  members: {
    __wifimonHtml: null,
    __wifimonHint: null,

    // overridden
    _getCellStyle(cellInfo) {
      return super._getCellStyle(cellInfo) + "text-overflow:ellipsis;text-align:left;";
    },

    // overridden
    _getCellAttributes(cellInfo) {
      const hint = this.__wifimonHint ? this.__wifimonHint(cellInfo) : null;
      return hint ? `title="${qx.bom.String.escape(hint).replace(/"/g, "&quot;")}"` : "";
    },

    // overridden
    _getContentHtml(cellInfo) {
      const html = this.__wifimonHtml ? this.__wifimonHtml(cellInfo) : null;
      return html === null || html === undefined ? qx.bom.String.escape(this._formatValue(cellInfo)) : html;
    }
  }
});
