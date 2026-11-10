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
 * Alt çubuğun (ui.StatusBar) bir mini paneli (kullanıcı isteği 2026-11-10): CPU, RAM, disk, ağ trafiği, ağ taraması,
 * SSH bağlantıları … Tek satırlık, ince çerçeveli kutu — çubuğun yüksekliğini artırmaz. Metin sığmazsa kırpılır
 * (genişlik kullanıcınındır). Sağ kenarındaki tutamaç sürüklenerek genişlik ayarlanır ("resized" olayı); kutunun
 * kendisi sürüklenerek çubukta yeri değiştirilir — sürükleme yönetimi kapsayıcıda (StatusBar), panel yalnız
 * "dragStart" bildirir. Sürüklemeden tıklanırsa "activate" (ör. SSH penceresini aç).
 */
qx.Class.define("ankamon.ui.statusbar.MiniPanel", {
  extend: qx.ui.container.Composite,

  events: {
    /** Tıklandı (sürüklenmeden). */
    activate: "qx.event.type.Event",
    /** Sürükleme başlasın: veri = pointerdown olayı (kapsayıcı yakalar). */
    dragStart: "qx.event.type.Data",
    /** Genişlik tutamaçla değişti (bırakıldı). */
    resized: "qx.event.type.Event"
  },

  statics: {
    MIN_WIDTH: 36,
    MAX_WIDTH: 700
  },

  /**
   * @param id {String} kalıcı kimlik (ui_prefs "statusbar.panels")
   * @param title {String} sağ menüde görünen ad
   * @param width {Number} varsayılan genişlik
   */
  construct(id, title, width) {
    super(new qx.ui.layout.HBox(0).set({ alignY: "middle" }));
    this.__id = id;
    this.__title = title;
    this.__defaultWidth = width;
    this.set({
      width, minWidth: ankamon.ui.statusbar.MiniPanel.MIN_WIDTH, allowGrowX: false, allowShrinkX: false,
      height: 18, allowGrowY: false, padding: [0, 0, 0, 4], cursor: "grab",
      decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 3 })
    });
    // Zengin metin (renkli uyarı) ama sarmaz: sığmayan kısım kırpılır.
    this.__label = new qx.ui.basic.Label("").set({
      font: "app-mono", textColor: "app-muted", rich: true, wrap: false, allowGrowX: true, allowShrinkX: true,
      minWidth: 0, anonymous: true
    });
    this.add(this.__label, { flex: 1 });
    // Genişlik tutamacı (sağ kenar).
    this.__grip = new qx.ui.core.Widget().set({ width: 5, allowGrowY: true, cursor: "ew-resize" });
    this.add(this.__grip);
    this.__grip.addListener("pointerdown", this.__onGripDown, this);
    this.addListener("pointerdown", e => {
      if (e.isLeftPressed() && e.getTarget() !== this.__grip) {
        this.fireDataEvent("dragStart", e);
      }
    });
  },

  members: {
    __id: null,
    __title: null,
    __defaultWidth: null,
    __label: null,
    __grip: null,
    __gripX: null,
    __gripWidth: null,

    getPanelId() {
      return this.__id;
    },

    getTitle() {
      return this.__title;
    },

    getDefaultWidth() {
      return this.__defaultWidth;
    },

    /** @param html {String} panel metni (zengin; kırpılır) */
    setText(html) {
      if (this.__label.getValue() !== html) {
        this.__label.setValue(html);
      }
    },

    __onGripDown(e) {
      if (!e.isLeftPressed()) {
        return;
      }
      e.stopPropagation();
      this.__gripX = e.getDocumentLeft();
      this.__gripWidth = this.getBounds() ? this.getBounds().width : this.getWidth();
      this.__grip.capture();
      this.__grip.addListener("pointermove", this.__onGripMove, this);
      this.__grip.addListenerOnce("pointerup", () => {
        this.__grip.releaseCapture();
        this.__grip.removeListener("pointermove", this.__onGripMove, this);
        this.fireEvent("resized");
      });
    },

    __onGripMove(e) {
      const P = ankamon.ui.statusbar.MiniPanel;
      const width = Math.round(this.__gripWidth + e.getDocumentLeft() - this.__gripX);
      this.setWidth(Math.max(P.MIN_WIDTH, Math.min(P.MAX_WIDTH, width)));
    }
  }
});
