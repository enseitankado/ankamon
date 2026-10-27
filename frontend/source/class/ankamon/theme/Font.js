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

/** Windows 11 hissi: Segoe UI öncelikli, biraz büyütülmüş yazı tipleri (nesneler ferah görünsün). */
qx.Theme.define("ankamon.theme.Font", {
  extend: qx.theme.tangible.Font,

  fonts: {
    default: {
      size: 15,
      family: ["Segoe UI", "Roboto", "sans-serif"],
      color: "text-primary-on-surface",
      lineHeight: 1.4
    },

    bold: {
      size: 15,
      bold: true,
      family: ["Segoe UI", "Roboto", "sans-serif"],
      color: "text-primary-on-surface"
    },

    headline: {
      size: 22,
      family: ["Segoe UI", "Roboto", "sans-serif"],
      color: "text-primary-on-surface"
    },

    small: {
      size: 13,
      family: ["Segoe UI", "Roboto", "sans-serif"],
      color: "text-primary-on-surface"
    },

    // Süzgeç kutuları (bkz. ui/table/FilterHeaderCell): kutu kalın yazılı sütun başlığının İÇİNDE —
    // ağırlık açıkça "normal" verilmezse girdi ve ipucu (placeholder) metni başlığın kalınlığını devralır.
    "app-filter": {
      size: 13,
      bold: false,
      family: ["Segoe UI", "Roboto", "sans-serif"],
      color: "text-primary-on-surface"
    },

    monospace: {
      size: 13,
      family: ["Consolas", "Cascadia Mono", "monospace"]
    },

    "app-title": {
      size: 16,
      bold: true,
      family: ["Segoe UI", "Roboto", "sans-serif"]
    },

    "app-stat": {
      size: 26,
      bold: true,
      family: ["Segoe UI", "Roboto", "sans-serif"]
    },

    "app-mono": {
      size: 13,
      family: ["Consolas", "Cascadia Mono", "monospace"]
    }
  }
});
