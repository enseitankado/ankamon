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
 * ESC ile pencere kapatma (kullanıcı isteği 2026-11-10): Ankamon'da açılan HER pencerede (Dialog.window, Window'dan
 * türeyen sınıflar, eklentilerin pencereleri) ön plandaki pencerede ESC'ye basılınca pencere kapanır; kaydedilmemiş
 * veri varsa önce onay sorulur.
 *
 * Uygulama açılışında bir kez kurulur (bkz. Application.main): kök bileşende tek bir keypress dinleyicisi. Tuş
 * olayı odaktaki bileşenden köke kabarcıklanır; odak bir pencerenin içindeyse o pencere (ve yalnız ön plandaki
 * etkin pencere) kapanır. Açık menü, açılır liste (SelectBox/ComboBox) ve tarih seçici ESC'yi kendisi işleyip
 * durdurduğundan önce onlar kapanır, pencere kapanmaz. Uzak ekran ve web terminal iframe içinde olduğundan oradaki
 * ESC tahtaya/kabuğa gider. Kapatma win.close() ile — pencerenin kendi beforeClose korumaları (ör. süren toplu
 * işlem) geçerli kalır; kapatılamayan (allowClose: false) pencereye dokunulmaz.
 *
 * Kaydedilmemiş veri: kullanıcı bir form alanına (metin kutusu, onay kutusu, seçim listesi…) dokunduğu ANDA
 * (pointerdown / keydown — değer değişmeden önce) alanın değeri bir kez saklanır; ESC'de saklanan değerlerden biri
 * değişmişse "kaydedilmemiş değişiklik" sayılır. Böylece pencere açıldıktan sonra verisini sunucudan yükleyip
 * dolduran formlar yanlışlıkla "değişmiş" görünmez. Yalnız kaydetme düğmesi olan pencerelerde sorulur (SAVE_LABELS);
 * süzgeç/arama kutuları (ipucu "Süz…", "Ara…") veri sayılmaz. Bir pencere kendi kuralını
 * win.setUserData("escDirty", () => bool) ile verebilir.
 */
qx.Class.define("ankamon.ui.WindowEscClose", {
  type: "static",

  statics: {
    /** Bu etiketle başlayan bir düğmesi olan pencere "kaydedilecek veri" taşır. */
    SAVE_LABELS: /^(Kaydet|Ekle|Uygula|Oluştur|Gönder|Değiştir|Güncelle)/,
    /** Bu ipucuyla başlayan alanlar süzgeçtir, veri değil. */
    FILTER_HINT: /^(Süz|Ara\b|Ara…)/,

    __installed: false,
    __asking: null, // onayı sorulan pencere (onay açıkken o pencereye ikinci kez sorulmaz)

    install() {
      if (this.__installed) {
        return;
      }
      this.__installed = true;
      const root = qx.core.Init.getApplication().getRoot();
      // Alanın ilk değeri: dokunulduğu an (değer değişmeden önce) — bkz. sınıf notu.
      const remember = e => {
        const field = this.__fieldOf(e.getTarget());
        const win = field && this.__windowOf(field);
        if (!win) {
          return;
        }
        const base = win.getUserData("escBase") || new Map();
        if (!base.has(field)) {
          base.set(field, this.__valueOf(field));
          win.setUserData("escBase", base);
        }
      };
      root.addListener("pointerdown", remember, this, true);
      root.addListener("keydown", remember, this, true);
      root.addListener("keypress", e => {
        if (e.getKeyIdentifier() !== "Escape" || e.isCtrlPressed() || e.isAltPressed() || e.isShiftPressed()) {
          return;
        }
        // Odak bir pencerenin içindeyse (ya da hiçbir bileşende değilse) ön plandaki etkin pencere kapanır: yeni açılan
        // pencere (ör. onay) odağı her zaman almıyor, tuş arkadaki pencerenin alanından gelebilir. Odak sayfadaysa
        // (ör. grid süzgeci) ESC sayfanındır.
        const target = e.getTarget();
        if (target !== root && !this.__windowOf(target)) {
          return;
        }
        const win = root.getActiveWindow();
        if (!win || !win.isAllowClose() || !win.isVisible() || this.__asking === win) {
          return;
        }
        e.stop();
        this.__close(win);
      });
    },

    async __close(win) {
      if (this.__dirty(win)) {
        this.__asking = win;
        let ok = false;
        try {
          ok = await ankamon.ui.Dialog.confirm("Bu pencerede kaydedilmemiş değişiklikler var. Kaydetmeden kapatılsın mı?", "Kapat");
        } finally {
          this.__asking = null;
        }
        if (!ok || win.isDisposed()) {
          return;
        }
      }
      win.close();
    },

    __dirty(win) {
      const custom = win.getUserData("escDirty");
      if (typeof custom === "function") {
        return !!custom();
      }
      const base = win.getUserData("escBase");
      if (!base || !base.size || !this.__hasSave(win)) {
        return false;
      }
      for (const [field, value] of base) {
        if (!field.isDisposed() && this.__valueOf(field) !== value) {
          return true;
        }
      }
      return false;
    },

    /** Pencerede görünür bir kaydetme düğmesi var mı (bkz. SAVE_LABELS). */
    __hasSave(win) {
      const walk = widget => {
        if (widget instanceof qx.ui.form.Button && widget.isVisible() && this.SAVE_LABELS.test(String(widget.getLabel() || "").trim())) {
          return true;
        }
        const kids = widget._getChildren ? widget._getChildren() : [];
        return kids.some(walk);
      };
      return walk(win);
    },

    /** Olayın hedefinden yukarı: içinde bulunduğu pencere (yoksa null). */
    __windowOf(widget) {
      for (let w = widget; w; w = w.getLayoutParent()) {
        if (w instanceof qx.ui.window.Window) {
          return w;
        }
      }
      return null;
    },

    /** Olayın hedefinden yukarı: veri taşıyan form alanı (süzgeç kutuları hariç; yoksa null). */
    __fieldOf(widget) {
      for (let w = widget; w && !(w instanceof qx.ui.window.Window); w = w.getLayoutParent()) {
        if (w instanceof qx.ui.form.AbstractField) {
          return this.FILTER_HINT.test(String(w.getPlaceholder() || "")) ? null : w;
        }
        if (w instanceof qx.ui.form.CheckBox || w instanceof qx.ui.form.RadioButton || w instanceof qx.ui.form.SelectBox ||
            w instanceof qx.ui.form.Spinner || w instanceof qx.ui.form.Slider) {
          return w;
        }
      }
      return null;
    },

    __valueOf(field) {
      if (field instanceof qx.ui.form.SelectBox) {
        const item = field.getSelection()[0];
        return item ? String(item.getModel() ?? item.getLabel()) : "";
      }
      const value = field.getValue();
      return value === null || value === undefined ? "" : String(value);
    }
  }
});
