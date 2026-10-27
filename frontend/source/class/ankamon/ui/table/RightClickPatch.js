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
 * Sağ tıklama grid'lerde işaret (✓) değiştirmez (kullanıcı isteği) — Ankamon'daki TÜM qx tabloları için.
 *
 * qx.ui.table.pane.Scroller sağ tıklamanın "contextmenu" olayını da sol tıklamayla aynı işleyiciye
 * (_onTapPane) bağlar; o işleyici satırı seçip bir de "cellTap" yayar. İşaretleme kuralları ise
 * (bkz. page.Base checkable: onay kutusu sütunu, Ctrl/⌘ ya da Shift ile, ışıklı satıra ikinci tıklama)
 * ve alt satır açma/kapama (Ağ, Görev yöneticisi) "cellTap" dinler — sağ tıklama da işareti değiştiriyordu.
 * Burada sağ tuşla gelen (ya da macOS'ta Ctrl+tıklama gibi "contextmenu" olan) dokunuşta yalnız "cellTap"
 * yayılmaz: satırın seçilip vurgulanması (sağ menü o satıra uygulanır) ve "cellContextmenu" olduğu gibi kalır.
 */
qx.Class.define("ankamon.ui.table.RightClickPatch", {
  type: "static",

  statics: {
    __installed: false,

    /** Uygulama açılışında bir kez çağrılır (bkz. Application.main). */
    install() {
      if (this.__installed) {
        return;
      }
      this.__installed = true;
      const proto = qx.ui.table.pane.Scroller.prototype;
      const onTap = proto._onTapPane;
      const fire = proto.fireEvent;
      proto._onTapPane = function (e) {
        const secondary = e.getType() === "contextmenu" || (e.getButton && e.getButton() === "right");
        this.$$ankamonNoCellTap = secondary;
        try {
          return onTap.call(this, e);
        } finally {
          this.$$ankamonNoCellTap = false;
        }
      };
      proto.fireEvent = function (type) {
        if (type === "cellTap" && this.$$ankamonNoCellTap) {
          return true;
        }
        return fire.apply(this, arguments);
      };
    }
  }
});
