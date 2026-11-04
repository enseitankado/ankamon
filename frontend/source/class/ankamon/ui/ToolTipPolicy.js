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
 * İpuçları (qx ToolTip) süreyle kapanmaz, fare hareket edince kapanır (kullanıcı isteği) — Ankamon'daki TÜM
 * qx ipuçları için: setToolTipText'in ortak ipucu, zengin ToolTip nesneleri (araç çubuğu, sağ menü, Gösterge
 * kartları, alt çubuk), çekirdek ve eklentiler.
 *
 * qx.ui.tooltip.Manager ipucunu gösterirken ToolTip.hideTimeout (varsayılan 4 sn) süreli bir zamanlayıcı kurar;
 * fare kımıldamasa da süre dolunca ipucu kapanıyordu — uzun açıklamalar okunamıyordu. Burada:
 *  1) Manager bir ipucunu "current" yaptığında (gösterilmeden önce) hideTimeout en büyük değere çekilir:
 *     süreyle kapanma fiilen yok.
 *  2) İpucu görünürken fare, ipucunun açıldığı noktadan MOVE_PX'ten fazla uzaklaşırsa ipucu gizlenir.
 *     "current" bırakılmaz: aynı bileşenin içinde dolaşan fare ipucunu yeniden açmaz; bileşenden çıkıp
 *     yeniden girince (ya da başka bileşene geçince) Manager her zamanki gibi yeniden gösterir.
 * Tablo hücre ipuçları (ui.table.HintRenderer) tarayıcının kendi "title" ipucudur; zamanlamasını tarayıcı
 * belirler, bu sınıfın kapsamı dışındadır.
 */
qx.Class.define("ankamon.ui.ToolTipPolicy", {
  type: "static",

  statics: {
    /** İpucunu kapatan en küçük fare hareketi (piksel). Elin titremesi kapatmasın. */
    MOVE_PX: 6,
    /** setTimeout'un kabul ettiği en büyük süre (~24,8 gün) — "süreyle kapanma yok". */
    NEVER_MS: 2147483647,
    __installed: false,

    /** Uygulama açılışında bir kez çağrılır (bkz. Application.main). */
    install() {
      if (this.__installed) {
        return;
      }
      this.__installed = true;
      const Policy = this;
      const proto = qx.ui.tooltip.Manager.prototype;
      const applyCurrent = proto._applyCurrent;
      proto._applyCurrent = function (value, old) {
        if (value && !value.isDisposed()) {
          value.setHideTimeout(Policy.NEVER_MS);
          value.$$ankamonTipAnchor = null;
        }
        return applyCurrent.call(this, value, old);
      };

      const manager = qx.ui.tooltip.Manager.getInstance();
      let last = null;
      // Yerel dinleyici (yakalama evresinde, pasif): qx olay zincirinden bağımsız, hiçbir bileşen durduramaz.
      window.addEventListener("pointermove", e => {
        const pos = { x: e.clientX, y: e.clientY };
        const tip = manager.getCurrent();
        if (tip && !tip.isDisposed() && tip.isVisible()) {
          // İpucu fare dururken açılır: açıldığı nokta, görünür olduktan sonraki ilk hareketten ÖNCEKİ konumdur.
          const anchor = tip.$$ankamonTipAnchor || (tip.$$ankamonTipAnchor = last || pos);
          if (Math.abs(pos.x - anchor.x) > Policy.MOVE_PX || Math.abs(pos.y - anchor.y) > Policy.MOVE_PX) {
            tip.exclude();
            tip.$$ankamonTipAnchor = null;
          }
        } else if (tip) {
          tip.$$ankamonTipAnchor = null;
        }
        last = pos;
      }, { capture: true, passive: true });
    }
  }
});
