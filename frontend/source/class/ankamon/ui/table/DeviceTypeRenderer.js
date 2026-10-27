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
 * "Cihaz türü" sütunu için hücre çizici: türün metninin SOLUNA türe özgü minik bir cihaz piktogramı koyar.
 * Simgeler satır içi SVG'dir (14 px, çizgi rengi currentColor → temanın metin rengini alır): resim/kaynak
 * dosyası yoktur — bu derlenmiş build'de resim tabanlı simgelerin URL'si güvenilmez (bkz. ui.Shell sınıf
 * başı notu). Türler ui.network.Ops.TYPES ve worker netscan/classify.py ile aynı adlardır; bilinmeyen/boş
 * tür (alt satırlar, serbest metin) simge almaz, metin olduğu gibi gösterilir.
 */
qx.Class.define("ankamon.ui.table.DeviceTypeRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  statics: {
    /** viewBox 0 0 16 16 içindeki çizim (stroke=currentColor, fill=none; "F" sınıfı dolgulu nokta). */
    SHAPES: {
      monitor: '<rect x="1.5" y="2.5" width="13" height="8.5" rx="1"/><path d="M5.5 14h5M8 11v3"/>',
      laptop: '<rect x="3" y="3" width="10" height="7" rx=".8"/><path d="M1.5 12.5h13"/>',
      server: '<rect x="2" y="2" width="12" height="5" rx="1"/><rect x="2" y="9" width="12" height="5" rx="1"/>' +
        '<circle class="F" cx="4.6" cy="4.5" r=".75"/><circle class="F" cx="4.6" cy="11.5" r=".75"/><path d="M8 4.5h3.5M8 11.5h3.5"/>',
      board: '<rect x="1.5" y="1.5" width="13" height="9" rx=".6"/><path d="M4 8l2.5-2.5 2 1.5L12 3.8M8 10.5v2.3M5 14.5l3-1.7 3 1.7"/>',
      printer: '<path d="M4.5 6V1.5h7V6"/><rect x="1.5" y="6" width="13" height="5.5" rx="1"/><rect x="4.5" y="9.5" width="7" height="5"/>',
      camera: '<path d="M1.5 5 11 2.5l1.2 4.3-9.5 2.5z"/><path d="M12.2 5.4 14.5 5v3l-2.1-.3M5 8.6V13H1.8"/>',
      switch: '<rect x="1.5" y="5" width="13" height="6" rx="1"/>' +
        '<rect class="F" x="3.5" y="7.4" width="1.6" height="1.4"/><rect class="F" x="6.2" y="7.4" width="1.6" height="1.4"/>' +
        '<rect class="F" x="8.9" y="7.4" width="1.6" height="1.4"/><path d="M12 8.1h.6"/>',
      router: '<rect x="1.5" y="8.5" width="13" height="5" rx="1"/><path d="M4.5 8.5 3.2 3.5M11.5 8.5l1.3-5"/>' +
        '<circle class="F" cx="4.5" cy="11" r=".7"/><circle class="F" cx="7" cy="11" r=".7"/>',
      wifi: '<path d="M1.5 6.2a9.5 9.5 0 0 1 13 0M3.8 8.7a6.2 6.2 0 0 1 8.4 0M6 11.1a3 3 0 0 1 4 0"/><circle class="F" cx="8" cy="13.4" r=".9"/>',
      phone: '<rect x="4.5" y="1.5" width="7" height="13" rx="1.3"/><path d="M7.2 12.3h1.6"/>',
      tv: '<rect x="1.5" y="3.5" width="13" height="9" rx="1"/><path d="M5.5 1 8 3.5 10.5 1M5 14.8h6"/>',
      storage: '<ellipse cx="8" cy="3.5" rx="5.5" ry="2"/><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/>',
      chip: '<rect x="4" y="4" width="8" height="8" rx="1"/><rect x="6.3" y="6.3" width="3.4" height="3.4"/>' +
        '<path d="M6 1.5V4M10 1.5V4M6 12v2.5M10 12v2.5M1.5 6H4M1.5 10H4M12 6h2.5M12 10h2.5"/>',
      sbc: '<rect x="1.5" y="3.5" width="13" height="9" rx="1"/><rect x="6" y="6.3" width="4" height="3.4"/><path d="M3.5 5.3h9" stroke-dasharray="1 1.2"/>',
      deskphone: '<path d="M3 2.5h2.4l1.2 3-1.6 1a8 8 0 0 0 4.5 4.5l1-1.6 3 1.2v2.4a1.5 1.5 0 0 1-1.6 1.5A11.6 11.6 0 0 1 1.5 4.1 1.5 1.5 0 0 1 3 2.5z"/>',
      vm: '<rect x="4" y="1.5" width="10.5" height="8" rx="1"/><path d="M4 4h10.5M2.5 5v8.2c0 .7.6 1.3 1.3 1.3H12"/>'
    },

    /** Tür adı → çizim (bkz. Ops.TYPES). */
    TYPE_SHAPE: {
      "Bilgisayar": "monitor",
      "Sunucu": "server",
      "Akıllı tahta": "board",
      "Yazıcı": "printer",
      "IP kamera": "camera",
      "Ağ cihazı": "switch",
      "Ağ geçidi / yönlendirici": "router",
      "Kablosuz erişim noktası": "wifi",
      "Telefon / tablet": "phone",
      "Apple cihazı": "laptop",
      "TV / medya": "tv",
      "Depolama (NAS)": "storage",
      "IoT cihazı": "chip",
      "Raspberry Pi": "sbc",
      "IP telefon": "deskphone",
      "Sanal makine": "vm",
      "Ankamon sunucusu": "server"
    },

    /** Tür adının SVG'si (yoksa null). */
    svg(type) {
      const shape = this.SHAPES[this.TYPE_SHAPE[type]];
      if (!shape) {
        return null;
      }
      return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" ' +
        'stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;flex:none">' +
        '<style>.F{fill:currentColor;stroke:none}</style>' + shape + "</svg>";
    }
  },

  members: {
    // overridden
    _getContentHtml(cellInfo) {
      const text = qx.bom.String.escape(this._formatValue(cellInfo));
      const icon = ankamon.ui.table.DeviceTypeRenderer.svg(cellInfo.value);
      return icon ? icon + text : text;
    }
  }
});
