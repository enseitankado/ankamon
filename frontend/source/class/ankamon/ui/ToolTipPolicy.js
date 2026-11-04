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
 * İpuçları süreyle kapanmaz, fare hareket edince kapanır (kullanıcı isteği) — Ankamon'daki TÜM ipuçları için:
 * qx ipuçları (setToolTipText'in ortak ipucu, zengin ToolTip nesneleri: araç çubuğu, sağ menü, Gösterge kartları,
 * alt çubuk; çekirdek ve eklentiler) ve HTML "title" ipuçları (tablo hücreleri — ui.table.HintRenderer —, alt
 * çubuk, giriş ekranı, Sorun tespiti raporu, Görev yöneticisi, Dosyalar …).
 *
 * qx.ui.tooltip.Manager ipucunu gösterirken ToolTip.hideTimeout (varsayılan 4 sn) süreli bir zamanlayıcı kurar;
 * tarayıcının "title" ipucu da birkaç saniyede kendiliğinden kapanır — uzun açıklamalar okunamıyordu. Burada:
 *  1) Manager bir ipucunu "current" yaptığında (gösterilmeden önce) hideTimeout en büyük değere çekilir.
 *  2) İpucu görünürken fare, ipucunun açıldığı noktadan MOVE_PX'ten fazla uzaklaşırsa ipucu gizlenir.
 *     "current" bırakılmaz: aynı bileşenin içinde dolaşan fare ipucunu yeniden açmaz; bileşenden çıkıp
 *     yeniden girince (ya da başka bileşene geçince) Manager her zamanki gibi yeniden gösterir.
 *  3) qx, bileşenin İÇİNDEKİ DOM öğeleri arasındaki geçişte de (ör. araç çubuğu düğmesinde simge → yazı)
 *     "pointerout" ile ipucunu sıfırlıyordu (birkaç piksellik kıpırtı kapatıyordu): ipucu görünürken fare
 *     sahibinin içinde kalıyorsa bu olay qx'e ulaşmaz.
 *  4) "title" taşıyan öğenin üzerine gelince title, data-ankamon-title'a taşınır (tarayıcının kendi ipucu
 *     çıkmaz) ve metin aynı kurallarla (SHOW_MS gecikme, süresiz, fare kayınca kapanır) bir qx ipucunda gösterilir.
 *     Tablo tazelenip hücre aynı metinle yeniden çizilince ipucu kapanmaz.
 *  5) qx menü maddelerinin ipucu engeli (blockToolTip), ipucu tanımlı maddelerde kaldırılır: sağ menü ipuçları görünür.
 */
qx.Class.define("ankamon.ui.ToolTipPolicy", {
  type: "static",

  statics: {
    /** İpucunu kapatan en küçük fare hareketi (piksel). Elin titremesi kapatmasın. */
    MOVE_PX: 6,
    /** setTimeout'un kabul ettiği en büyük süre (~24,8 gün) — "süreyle kapanma yok". */
    NEVER_MS: 2147483647,
    /** "title" ipucunun açılma gecikmesi (qx ToolTip showTimeout varsayılanı ile aynı). */
    SHOW_MS: 700,
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
      const Widget = qx.ui.core.Widget;
      const moved = (pos, anchor) =>
        Math.abs(pos.x - anchor.x) > Policy.MOVE_PX || Math.abs(pos.y - anchor.y) > Policy.MOVE_PX;
      let last = null;

      // "title" ipuçları için tek bir qx ipucu.
      let titleTip = null;
      let titleEl = null;
      let titleAnchor = null;
      let titleTimer = null;
      const hideTitle = () => {
        clearTimeout(titleTimer);
        titleTimer = null;
        if (titleTip && titleTip.isVisible()) {
          titleTip.exclude();
        }
      };
      const showTitle = (el, pos) => {
        const text = el.getAttribute("data-ankamon-title") || "";
        if (!text.trim() || !el.isConnected) {
          return;
        }
        if (!titleTip) {
          titleTip = new qx.ui.tooltip.ToolTip().set({ rich: true, maxWidth: 520 });
        }
        titleTip.setLabel(qx.bom.String.escape(text).replace(/\n/g, "<br>"));
        titleTip.placeToPoint({ left: pos.x, top: pos.y });
        titleTip.show();
        titleAnchor = null;
      };

      // Yerel dinleyiciler (pencere, yakalama evresi): qx olay zincirinden önce çalışır.
      window.addEventListener("pointermove", e => {
        const pos = { x: e.clientX, y: e.clientY };
        const tip = manager.getCurrent();
        if (tip && !tip.isDisposed() && tip.isVisible()) {
          // İpucu fare dururken açılır: açıldığı nokta, görünür olduktan sonraki ilk hareketten ÖNCEKİ konumdur.
          const anchor = tip.$$ankamonTipAnchor || (tip.$$ankamonTipAnchor = last || pos);
          if (moved(pos, anchor)) {
            tip.exclude();
            tip.$$ankamonTipAnchor = null;
          }
        } else if (tip) {
          tip.$$ankamonTipAnchor = null;
        }
        if (titleTip && titleTip.isVisible()) {
          titleAnchor = titleAnchor || last || pos;
          if (moved(pos, titleAnchor)) {
            hideTitle(); // titleEl kalır: aynı öğede dolaşan fare yeniden açmaz
          }
        }
        last = pos;
      }, { capture: true, passive: true });

      window.addEventListener("pointerout", e => {
        const tip = manager.getCurrent();
        if (!tip || tip.isDisposed() || !tip.isVisible() || !e.relatedTarget) {
          return;
        }
        const opener = tip.getOpener();
        const to = Widget.getWidgetByElement(e.relatedTarget);
        if (opener && to && (to === opener || Widget.contains(opener, to))) {
          e.stopPropagation(); // sahibinin içinde kalan geçiş: qx ipucunu sıfırlamasın
        }
      }, { capture: true });

      window.addEventListener("pointerover", e => {
        const t = e.target;
        // qx menü maddeleri ipucunu varsayılan olarak engeller (menu.AbstractButton blockToolTip: true): sağ menüde
        // tanımlı ipuçları (ör. Ahenk ▸ ETAP kontrol, Etap adlarını senkronize et) hiç görünmüyordu. İpucu tanımlı
        // maddede engel, qx olayı işlemeden önce kaldırılır; ipucu aynı kurallarla (fare kayınca) kapanır.
        for (let w = Widget.getWidgetByElement(t); w; w = w.getLayoutParent()) {
          if (w instanceof qx.ui.menu.AbstractButton) {
            if (w.isBlockToolTip() && (w.getToolTip() || w.getToolTipText())) {
              w.setBlockToolTip(false);
            }
            break;
          }
          if (w instanceof qx.ui.menu.Menu) {
            break;
          }
        }
        const el = t && t.closest ? t.closest("[title],[data-ankamon-title]") : null;
        if (el && el.hasAttribute("title")) {
          el.setAttribute("data-ankamon-title", el.getAttribute("title"));
          el.removeAttribute("title");
        }
        if (el === titleEl) {
          return;
        }
        // Tablo tazelenince (ör. Ahenk 15 sn'de bir) fare kımıldamasa da hücre DOM'u yenilenir: önceki öğe
        // DOM'dan düşmüş ve yenisi aynı metni taşıyorsa bu aynı ipucunun devamıdır — kapatılıp yeniden açılmaz.
        if (el && titleEl && !titleEl.isConnected &&
            el.getAttribute("data-ankamon-title") === titleEl.getAttribute("data-ankamon-title")) {
          titleEl = el;
          return;
        }
        hideTitle();
        titleEl = el;
        if (el) {
          const pos = { x: e.clientX, y: e.clientY };
          const token = titleTimer = setTimeout(() => {
            if (titleTimer === token && titleEl) {
              showTitle(titleEl, last || pos);
            }
          }, Policy.SHOW_MS);
        }
      }, { capture: true, passive: true });

      window.addEventListener("pointerdown", () => hideTitle(), { capture: true, passive: true });
    }
  }
});
