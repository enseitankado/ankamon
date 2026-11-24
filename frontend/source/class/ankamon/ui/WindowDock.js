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
 * Küçültülebilir pencereler ve onları geri getiren şerit (kullanıcı isteği): Ankamon'da açılan HER pencere
 * (web terminal, dosya yöneticisi, ekran, komut çıktısı, formlar, onay soruları — eklentilerinkiler dahil)
 * simge durumuna küçültülebilir ve kalıcı (modal) değildir: önde dururken arkadaki sayfa, menüler ve öteki
 * pencereler kullanılabilir.
 * qooxdoo'da küçültülen pencere yalnız gizlenir (görev çubuğu yoktur); bu yüzden küçültülen pencereler alt
 * çubukta (bkz. ui.StatusBar) başlıklarıyla düğme olarak durur, tıklanınca geri açılır (büyütülmüş açılan
 * pencere yine büyütülmüş).
 *
 * Yeni pencereler kökün "changeActiveWindow" olayından yakalanır (Window.open() pencereyi etkinleştirir) —
 * pencereleri açan kodlara (Dialog.window, DeviceOps, Jobs…) tek tek dokunmak gerekmez.
 *
 * İçinde iframe olan pencereler (terminal, dosya yöneticisi, ekran): iframe'e tıklama olayı qooxdoo'ya
 * ulaşmaz, pencere öne gelmezdi; kipsiz pencereler üst üste binebildiğinden iframe'e tıklanınca da
 * pencere etkinleştirilir (__watchIframes).
 *
 * Çok sayıda küçültülmüş pencere (kullanıcı isteği 2026-11-24): şerit alt çubukta kalan boşluğu doldurur (flex, kendi
 * genişliği 0 — düğmeleri alt çubuğa en küçük genişlik dayatmaz, paneller ekran dışına itilmez); sığmayan düğmeler
 * gizlenir ve sondaki "+N ▾" düğmesinin menüsüne toplanır. Aynı menü (ve düğmelerin sağ menüsü): tümünü geri aç /
 * kapat, türe göre (başlığın "—" öncesi; win.setUserData("ankamon.windowKind", ad) ile açıkça verilebilir) geri aç /
 * kapat. Kapatırken kaydedilmemiş değişiklik (ui.WindowEscClose.isDirty) varsa onay sorulur.
 */
qx.Class.define("ankamon.ui.WindowDock", {
  extend: qx.ui.container.Composite,

  construct() {
    super(new qx.ui.layout.HBox(4).set({ alignY: "middle" }));
    // Genişlik 0 + flex (bkz. ui.StatusBar): boşluğu doldurur ama düğmeleri yüzünden genişlemez.
    this.set({ width: 0, minWidth: 0 });
    this.__buttons = new Map();
    this.__menus = [];
    this.__more = new qx.ui.form.Button("▾").set({
      padding: [0, 6], allowGrowY: false, maxHeight: 20, visibility: "excluded"
    });
    this.__more.addListener("execute", () => this.__openMenu(null, null));
    this.__more.addListener("contextmenu", e => this.__openMenu(null, e));
    this.add(this.__more);
    this.addListener("resize", this.__fit, this);
    const root = qx.core.Init.getApplication().getRoot();
    root.addListener("changeActiveWindow", e => {
      const win = e.getData();
      if (win && !win.getUserData("ankamon.dock")) {
        this.__adopt(win);
      }
    });
    // Odak bir iframe'e geçince (içine tıklandı) ana belge "blur" alır; odaktaki iframe'in penceresi öne.
    // Kaynağı başka köken olan ya da iç içe çerçevelerde de çalışır (bkz. __watchIframes — aynı kökende
    // iframe'ler arası geçişte ana belge ikinci kez blur almaz, onu oradaki dinleyici karşılar).
    window.addEventListener("blur", () => setTimeout(() => {
      const el = document.activeElement;
      if (el && el.tagName === "IFRAME") {
        this.__activateFor(el);
      }
    }, 0));
  },

  statics: {
    /** Başlık önekinden türe birleştirmeler (aynı işin tekil/çoğul başlıkları). */
    KIND_ALIASES: { "Ekranlar": "Ekran" }
  },

  members: {
    __buttons: null,
    __more: null,
    __menus: null,
    __hidden: null,

    /** Olay hedefi şeridin bir düğmesi mi (boş alan değil; bkz. ui.StatusBar tıklama ile aç/kapat). */
    ownsTarget(target) {
      return target !== this && qx.ui.core.Widget.contains(this, target);
    },

    /** Pencereye küçültme düğmesi ekler, kipliliği kaldırır; küçültülünce şeride, geri açılınca/kapanınca şeritten. */
    __adopt(win) {
      win.setUserData("ankamon.dock", true);
      win.set({ showMinimize: true, allowMinimize: true });
      // İstisna: açıkça kalıcı istenen pencere (bkz. ui.sessions.ScreenshotViewer).
      if (!win.getUserData("ankamon.keepModal")) {
        win.setModal(false);
      }
      // qx minimize() büyütülmüş durumu atar (restore() normal boyuta, 0,0'a döner): geri açarken yeniden büyütülür.
      win.addListener("beforeMinimize", () => win.setUserData("ankamon.dock.maximized", win.isMaximized()));
      win.addListener("minimize", () => this.__add(win));
      win.addListener("appear", () => {
        this.__remove(win);
        this.__watchIframes(win);
      });
      win.addListener("close", () => this.__remove(win));
      if (win.isSeeable()) {
        this.__watchIframes(win);
      }
    },

    __add(win) {
      if (this.__buttons.has(win)) {
        return;
      }
      const caption = String(win.getCaption() || "Pencere");
      const button = new qx.ui.form.Button("▣ " + (caption.length > 32 ? caption.slice(0, 31) + "…" : caption)).set({
        toolTipText: caption + " — geri açmak için tıklayın", padding: [0, 6], allowGrowY: false, maxHeight: 20
      });
      button.addListener("execute", () => this.__restore(win));
      button.addListener("contextmenu", e => this.__openMenu(win, e));
      this.__buttons.set(win, button);
      this.addBefore(button, this.__more);
      this.__fit();
    },

    __remove(win) {
      const button = this.__buttons.get(win);
      if (button) {
        this.__buttons.delete(win);
        button.destroy();
        this.__fit();
      }
    },

    __restore(win) {
      if (win.isDisposed()) {
        return;
      }
      win.restore(); // gizliyse açar, eski konumuna koyar
      if (win.getUserData("ankamon.dock.maximized")) {
        win.maximize();
      }
    },

    /** Sığan düğmeler görünür, kalanlar gizli ("+N" menüsünde); "+N ▾" her zaman sonda. */
    __fit() {
      const count = this.__buttons.size;
      this.__hidden = [];
      if (!count) {
        this.__more.setVisibility("excluded");
        this.setMinWidth(0);
        return;
      }
      const bounds = this.getBounds();
      const avail = bounds ? bounds.width : 0;
      const spacing = 4;
      // "+N ▾" en geniş haliyle ölçülür ki etiket değişince yerleşim oynamasın.
      this.__more.set({ label: `+${count} ▾`, visibility: "visible" });
      let used = this.__more.getSizeHint().width;
      for (const [win, button] of this.__buttons) {
        const w = button.getSizeHint().width + spacing;
        if (!this.__hidden.length && used + w <= avail) {
          used += w;
          button.setVisibility("visible");
        } else {
          button.setVisibility("excluded");
          this.__hidden.push(win);
        }
      }
      const n = this.__hidden.length;
      this.__more.set({
        label: n ? `+${n} ▾` : "▾",
        toolTipText: `${count} küçültülmüş pencere` + (n ? ` (${n} tanesi sığmadı)` : "") +
          " — listele, tümünü ya da türe göre geri aç / kapat"
      });
      this.setMinWidth(this.__more.getSizeHint().width);
    },

    /** Pencerenin türü: açık verilen ya da başlığın "—", ":" ya da " (" öncesi. */
    __kindOf(win) {
      const given = win.getUserData("ankamon.windowKind");
      if (given) {
        return String(given);
      }
      const caption = String(win.getCaption() || "").trim();
      const head = caption.split(/\s+[—–-]\s+|:\s+|\s+\(/)[0].trim() || "Pencere";
      return ankamon.ui.WindowDock.KIND_ALIASES[head] || head;
    },

    __caption(win) {
      const caption = String(win.getCaption() || "Pencere");
      return caption.length > 60 ? caption.slice(0, 59) + "…" : caption;
    },

    /**
     * Toplu işlem menüsü. focus verilirse (bir düğmenin sağ menüsü) önce o pencere ve türü; pointer olayı verilirse
     * imlecin yerinde, yoksa "+N" düğmesinin üstünde açılır.
     */
    __openMenu(focus, e) {
      this.__menus.forEach(m => m.destroy());
      this.__menus = [];
      const newMenu = () => {
        const m = new qx.ui.menu.Menu();
        this.__menus.push(m);
        return m;
      };
      const item = (menu, label, fn, enabled = true) => {
        const b = new qx.ui.menu.Button(label).set({ enabled });
        b.addListener("execute", fn);
        menu.add(b);
        return b;
      };
      const header = (menu, label) => menu.add(new qx.ui.menu.Button(label).set({ enabled: false }));
      const all = [...this.__buttons.keys()].filter(w => !w.isDisposed());
      const byKind = new Map();
      all.forEach(w => {
        const k = this.__kindOf(w);
        byKind.set(k, (byKind.get(k) || []).concat([w]));
      });
      const menu = newMenu();
      if (focus && all.includes(focus)) {
        header(menu, this.__caption(focus));
        item(menu, "Geri aç", () => this.__restore(focus));
        item(menu, "Kapat", () => this.__closeAll([focus]));
        menu.add(new qx.ui.menu.Separator());
      }
      item(menu, `Tümünü geri aç (${all.length})`, () => all.forEach(w => this.__restore(w)), all.length > 0);
      item(menu, `Tümünü kapat (${all.length})`, () => this.__closeAll(all), all.length > 0);
      if (byKind.size) {
        menu.add(new qx.ui.menu.Separator());
        header(menu, "Türe göre");
        [...byKind.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "tr"))
          .forEach(([kind, wins]) => {
            const sub = newMenu();
            item(sub, `Geri aç (${wins.length})`, () => wins.forEach(w => this.__restore(w)));
            item(sub, `Kapat (${wins.length})`, () => this.__closeAll(wins));
            sub.add(new qx.ui.menu.Separator());
            wins.forEach(w => item(sub, this.__caption(w), () => this.__restore(w)));
            const b = new qx.ui.menu.Button(`${kind} (${wins.length})`, null, null, sub);
            if (focus && this.__kindOf(focus) === kind) {
              b.setLabel(`${kind} (${wins.length}) — bu pencerenin türü`);
            }
            menu.add(b);
          });
      }
      // Sığmayanlar en altta (toplu işlemler kaydırmadan görünsün); çoksa alt menüde.
      const hidden = (this.__hidden || []).filter(w => all.includes(w));
      if (!focus && hidden.length) {
        menu.add(new qx.ui.menu.Separator());
        const label = `Alt çubuğa sığmayanlar (${hidden.length})`;
        if (hidden.length > 8) {
          const sub = newMenu();
          hidden.forEach(w => item(sub, this.__caption(w), () => this.__restore(w)));
          menu.add(new qx.ui.menu.Button(label, null, null, sub));
        } else {
          header(menu, label);
          hidden.forEach(w => item(menu, this.__caption(w), () => this.__restore(w)));
        }
      }
      if (e) {
        menu.openAtPointer(e);
        e.stop();
      } else {
        menu.setOpener(this.__more);
        menu.open();
      }
    },

    /**
     * Pencereleri kapatır; kaydedilmemiş değişikliği olanlar için (ESC kuralıyla aynı ölçüt) tek onay sorulur —
     * vazgeçilirse yalnız onlar açık kalır. Kapatılamayan (allowClose: false) pencereye dokunulmaz.
     */
    async __closeAll(wins) {
      let list = wins.filter(w => !w.isDisposed() && w.isAllowClose());
      const dirty = list.filter(w => ankamon.ui.WindowEscClose.isDirty(w));
      if (dirty.length) {
        const names = dirty.slice(0, 5).map(w => qx.bom.String.escape(this.__caption(w))).join("<br>") +
          (dirty.length > 5 ? `<br>… ve ${dirty.length - 5} pencere daha` : "");
        const ok = await ankamon.ui.Dialog.confirm(
          `${dirty.length} pencerede kaydedilmemiş değişiklikler var:<br><br>${names}<br><br>` +
          "Bunlar da kaydedilmeden kapatılsın mı? (Vazgeç: bu pencereler açık kalır, ötekiler kapanır.)", "Hepsini kapat");
        if (!ok) {
          list = list.filter(w => !dirty.includes(w));
        }
      }
      // qx close() gizli (küçültülmüş) pencerede hiçbir şey yapmaz: önce görünür yapılır (aynı adımda kapandığından
      // ekrana çizilmez). Kendi beforeClose koruması kapanmayı durdurursa pencere yeniden küçültülür.
      list.forEach(w => {
        if (w.isDisposed()) {
          return;
        }
        const hidden = !w.isVisible();
        if (hidden) {
          w.show();
        }
        w.close();
        if (hidden && !w.isDisposed() && w.isVisible()) {
          w.minimize();
        }
      });
    },

    /**
     * Penceredeki (aynı kökenli) iframe'lerin belgesine tıklanınca pencereyi etkinleştirir. Belge her
     * yüklemede yenilendiğinden dinleyici "load"da yeniden eklenir; başka kökenli belgelere erişilemez
     * (onları kurucudaki "blur" dinleyicisi karşılar).
     */
    __watchIframes(win) {
      const el = win.getContentElement().getDomElement();
      if (!el) {
        return;
      }
      el.querySelectorAll("iframe").forEach(frame => {
        if (frame.__ankamonDock) {
          return;
        }
        frame.__ankamonDock = true;
        const hook = () => {
          try {
            frame.contentWindow.document.addEventListener("pointerdown", () => this.__activateFor(frame), true);
          } catch (e) {
            // başka kökenli belge — "blur" yolu yeter
          }
        };
        frame.addEventListener("load", hook);
        hook();
      });
    },

    /** Bir DOM öğesini (iframe) içeren qx penceresini etkinleştirir (öne getirir; odağı iframe'den almaz). */
    __activateFor(el) {
      let widget = qx.ui.core.Widget.getWidgetByElement(el);
      while (widget && !(widget instanceof qx.ui.window.Window)) {
        widget = widget.getLayoutParent();
      }
      if (widget && !widget.isActive()) {
        widget.setActive(true);
      }
    }
  }
});
