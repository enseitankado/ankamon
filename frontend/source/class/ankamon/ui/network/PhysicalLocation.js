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
 * "Fiziksel konum" alanının ortak tanımı (kullanıcı isteği 2026-11-13): ağda tespit edilen her varlığın bulunduğu yer, Tesis
 * Envanteri Kodlama Sistemi'nde il.ilçe.tesis.bina.kat.salon (bkz. backend Core\FacilityInventoryCode, göç 054). Kullanıcı serbest
 * metin de yazabilir. Varlıklar / varlık grupları / Akıllı Tahtalar grid sütunu, Cihaz ayrıntıları ve toplu düzenleme bu sınıfın
 * etiketini, ipucunu ve hazır değer listeli kutusunu kullanır — tek yerden değişsin.
 */
qx.Class.define("ankamon.ui.network.PhysicalLocation", {
  type: "static",

  statics: {
    LABEL: "Fiziksel konum",

    /** Sütun başlığı / alan ipucu (düz metin). */
    HINT: "Fiziksel konum — Tesis Envanteri Kodlama Sistemi (Hiyerarşik Fiziksel Lokasyon Kodlama ve Adresleme Sistemi): " +
      "cihazın bulunduğu yer il.ilçe.tesis.bina.kat.salon biçiminde, noktayla ayrılmış sayılarla yazılır. " +
      "Ör. 55.11.165.1.2.15 = 55 il, 11 ilçe, 165 tesis (okul/kurum), 1. bina, 2. kat, 15. salon. " +
      "İl, ilçe ve tesis kodları Ayarlar ▸ Kuruluş'tan gelir: yalnız bina.kat.salon (ör. 1.2.15) yazarsanız önek kendiliğinden eklenir. " +
      "Kod bilinmiyorsa serbest metin de yazılabilir (ör. B Blok 2. kat).",

    /** Ayarlar ▸ Kuruluş açıklaması (HTML). */
    HINT_HTML: "<b>Tesis Envanteri Kodlama Sistemi</b> (Hiyerarşik Fiziksel Lokasyon Kodlama ve Adresleme Sistemi): bir yerin adresi " +
      "<b>il.ilçe.tesis.bina.kat.salon</b> biçiminde, noktayla ayrılmış sayılardır — ör. <b>55.11.165.1.2.15</b> = 55 il, 11 ilçe, " +
      "165 tesis (okul/kurum), 1. bina, 2. kat, 15. salon. Ağdaki her cihazın <i>Fiziksel konum</i> alanı bu kodla yazılır.",

    __cache: null,
    __cacheAt: 0,

    /** GET /network/locations (30 sn önbellekli): {locations: [{value, count}], prefix}. */
    async load(force = false) {
      const PL = ankamon.ui.network.PhysicalLocation;
      if (!force && PL.__cache && Date.now() - PL.__cacheAt < 30000) {
        return PL.__cache;
      }
      try {
        PL.__cache = await ankamon.io.Api.get("/network/locations");
        PL.__cacheAt = Date.now();
      } catch (e) {
        PL.__cache = PL.__cache || { locations: [], prefix: "" };
      }
      return PL.__cache;
    },

    /** Kayıttan sonra listeyi tazelemek için. */
    invalidate() {
      ankamon.ui.network.PhysicalLocation.__cacheAt = 0;
    },

    /**
     * Düzenlenebilir kutu: yazılabilir ve daha önce girilmiş konumlar hazır listeden seçilebilir (ComboBox — en çok kullanılan
     * önce). İpucu kod biçimini anlatır; kutunun örnek yazısı Kuruluş öneki varsa onunla başlar.
     * @param value {String} mevcut değer @param placeholder {String?} verilirse örnek yazının yerine (ör. toplu düzenlemede "değişmez")
     */
    field(value, placeholder = null) {
      const PL = ankamon.ui.network.PhysicalLocation;
      const box = new qx.ui.form.ComboBox().set({ value: value || "", placeholder: placeholder || "ör. 55.11.165.1.2.15 ya da B Blok 2. kat",
        toolTipText: PL.HINT });
      PL.load().then(res => {
        if (box.isDisposed()) {
          return;
        }
        if (!placeholder && res.prefix) {
          box.setPlaceholder(`ör. ${res.prefix}1.2.15 — ya da yalnız bina.kat.salon: 1.2.15`);
        }
        (res.locations || []).forEach(l => {
          const item = new qx.ui.form.ListItem(l.value);
          item.setToolTipText(`${l.count} cihazda kayıtlı`);
          box.add(item);
        });
      });
      return box;
    }
  }
});
