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
 * Varlık grubu oluşturma günlüğü (kullanıcı isteği 2026-11-24): «Grup oluştur» / Gruba ekle ▸ Yeni grup… verilince
 * modal pencere işin aşamalarını satır satır yazar (süren adımda dönen halka — ui.JobSpinner; biten ✓ + süre + ayrıntı;
 * hata ✗ kırmızı). Her şey başarılıysa HOLD_MS bekler, FADE_MS'lik CSS opaklık geçişiyle solup kendiliğinden kapanır;
 * hata olursa kaybolmaz, Kapat düğmesi çıkar. ESC her zaman kapatır (ui.WindowEscClose); kapanmış pencereye yazılmaz,
 * süren istek yine tamamlanır.
 */
qx.Class.define("ankamon.ui.network.GroupBuildLog", {
  extend: qx.core.Object,

  /** @param title {String} pencere başlığı */
  construct(title) {
    super();
    const win = this.__win = ankamon.ui.Dialog.window(title, 480);
    // Kipli kalsın: ui.WindowDock pencereleri küçültülebilir yapıp kipliliği kaldırır; ankamon.keepModal istisnası.
    win.setUserData("ankamon.keepModal", true);
    win.set({ modal: true, showMinimize: false, showMaximize: false, allowMinimize: false, allowMaximize: false });
    win.addListenerOnce("appear", () => win.set({ showMinimize: false, allowMinimize: false }));
    this.__list = new qx.ui.container.Composite(new qx.ui.layout.VBox(5));
    win.add(this.__list);
    win.addListener("close", () => {
      this.__closed = true;
      qx.event.Timer.once(() => this.dispose(), null, 0);
    });
    // Geçiş baştan tanımlı: opaklık değişince (bkz. __fade) tarayıcı onu yumuşak uygular.
    win.getContentElement().setStyle("transition", `opacity ${ankamon.ui.network.GroupBuildLog.FADE_MS}ms ease`);
    win.open();
  },

  statics: {
    /** Başarıdan sonra pencerenin okunabilir kaldığı süre. */
    HOLD_MS: 2500,
    /** Solma süresi. */
    FADE_MS: 600
  },

  members: {
    __win: null,
    __list: null,
    __closed: false,

    /** Pencere ESC/Kapat ile kapandı mı. */
    isClosed() {
      return this.__closed;
    },

    getWindow() {
      return this.__win;
    },

    __line(html, color) {
      const label = new qx.ui.basic.Label(html).set({ rich: true, wrap: true, selectable: true });
      if (color) {
        label.setTextColor(color);
      }
      if (!this.__closed) {
        this.__list.add(label);
      }
      return label;
    },

    /**
     * Bir aşama: satır dönen halkayla açılır, fn bitince ✓ (süre ve detail(sonuç) ile), hata verirse ✗ kırmızı ve hata
     * yeniden atılır. @return {Promise} fn'in sonucu
     */
    async step(text, fn, detail) {
      const esc = s => qx.bom.String.escape(String(s ?? ""));
      const label = this.__line(`${ankamon.ui.JobSpinner.html()} ${esc(text)}…`);
      const started = Date.now();
      try {
        const result = await fn();
        const more = detail ? detail(result) : "";
        label.setValue(`<span style="color:#1e8e3e;font-weight:bold">✓</span> ${esc(text)}` +
          (more ? ` — ${esc(more)}` : "") + ` <span style="opacity:.6">(${Date.now() - started} ms)</span>`);
        return result;
      } catch (e) {
        label.set({ value: `✗ ${esc(text)} — ${esc((e && (e.message || e.error)) || e)}`, textColor: "#d93025" });
        throw e;
      }
    },

    /** Bilgi satırı (soluk). */
    info(text) {
      this.__line(`· ${qx.bom.String.escape(text)}`, "app-muted");
    },

    /** Hata: pencere açık kalır, Kapat düğmesi eklenir. */
    fail(text) {
      if (this.__closed) {
        return;
      }
      this.__line(`<b>${qx.bom.String.escape(text)}</b>`, "#d93025");
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => this.__win.close());
      ankamon.ui.Dialog.buttons(this.__win, [close]);
      close.focus();
    },

    /** Başarı: son satır, HOLD_MS sonra solar ve kapanır. */
    finish(text) {
      if (this.__closed) {
        return;
      }
      this.__line(`<b>✓ ${qx.bom.String.escape(text)}</b>`, "#1e8e3e");
      qx.event.Timer.once(this.__fade, this, ankamon.ui.network.GroupBuildLog.HOLD_MS);
    },

    __fade() {
      if (this.__closed) {
        return;
      }
      this.__win.setOpacity(0);
      qx.event.Timer.once(() => {
        if (!this.__closed) {
          this.__win.close();
        }
      }, null, ankamon.ui.network.GroupBuildLog.FADE_MS + 50);
    }
  }
});
