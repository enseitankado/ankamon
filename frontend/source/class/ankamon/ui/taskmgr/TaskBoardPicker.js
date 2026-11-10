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
 * Görev yöneticisinin "Bilgisayar" süzgeci (birden çok tahtayla açılan pencerede üst çubukta, arama kutusunun
 * yanında): onay kutulu tahta listesi — birden çok seçim (VEYA), "Tümü" (üç durumlu), "Temizle"; seçim
 * hemen uygulanır ve bütün sekmelere (tablolardaki "Bilgisayar" sütunu, Performans'taki tahta seçici) yansır.
 * Hiçbiri seçili değilse bütün tahtalar gösterilir. Listede her tahtanın bağlantı durumu ve işlem sayısı görünür;
 * bağlanamayan tahta listeden yeniden bağlanabilir. Satır sağ menüsündeki "Yalnız bu bilgisayarı göster" de
 * buraya yazar (bkz. ui.taskmgr.Tab._rowMenu).
 */
qx.Class.define("ankamon.ui.taskmgr.TaskBoardPicker", {
  extend: qx.ui.form.Button,

  /** @param win {ankamon.ui.taskmgr.Window} */
  construct(win) {
    super("");
    this.__win = win;
    this.set({ padding: [3, 10], maxWidth: 320, toolTipText: "Gösterilecek bilgisayarları seçin (birden çok seçilebilir)" });
    this.addListener("execute", () => this.__openPopup());
    this.sync();
  },

  members: {
    __win: null,
    __popup: null,

    /** Düğme etiketi: seçim özeti. */
    sync() {
      const win = this.__win;
      const links = win.getLinks();
      const chosen = links.filter(l => win.isBoardChosen(l.getId()));
      let text;
      if (!win.hasBoardFilter()) {
        text = `Tümü (${links.length})`;
      } else if (chosen.length === 1) {
        text = chosen[0].getDisplay();
      } else {
        text = `${chosen.length} / ${links.length} bilgisayar`;
      }
      this.setLabel(`🖥 Bilgisayar: ${text} ▾`);
    },

    __openPopup() {
      const win = this.__win;
      const F = ankamon.ui.taskmgr.Fmt;
      const popup = new qx.ui.popup.Popup(new qx.ui.layout.VBox(4)).set({ padding: 6, minWidth: 420, maxWidth: 820 });
      const checks = [];
      const all = new qx.ui.form.CheckBox("Tümü").set({ triState: true, font: "bold" });
      // Toplu değişiklikte (Tümü, Temizle) süzgeç bir kez uygulansın: her kutu ayrı ayrı tabloyu yeniden kurmasın.
      let batch = false;
      const apply = () => batch || win.setBoardFilter(checks.filter(c => c.getValue()).map(c => c.getUserData("id")));
      const syncAll = () => {
        const visible = checks.filter(c => !c.getUserData("row") || c.getUserData("row").isVisible());
        const n = visible.filter(c => c.getValue()).length;
        all.setValue(n === 0 ? false : (n === visible.length ? true : null));
      };
      const list = new qx.ui.container.Composite(new qx.ui.layout.VBox(2));
      win.getLinks().forEach(link => {
        const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
        const m = link.getModel();
        const state = link.getState();
        const info = state === "open" ? (m.snap ? `${m.procs.size} işlem` : "bağlı")
          : (state === "connecting" ? "bağlanıyor…" : "bağlanamadı");
        // Satır kırılmasın (kullanıcı isteği): ad + durum tek satırda; pencere genişliği içeriğe göre büyür.
        const check = new qx.ui.form.CheckBox(`<span style="white-space:nowrap">${state === "closed" ? "⚠ " : ""}` +
          `${F.esc(link.getDisplay())}  <span style="opacity:.6">(${F.esc(info)})</span></span>`).set({ value: win.hasBoardFilter() && win.isBoardChosen(link.getId()), rich: true });
        check.setUserData("id", link.getId());
        check.setUserData("row", row);
        check.setUserData("text", ankamon.page.Base.filterText(link.getDisplay()));
        if (state === "closed" && link.getError()) {
          check.setToolTipText(link.getError());
        }
        check.addListener("changeValue", () => {
          syncAll();
          apply();
        });
        checks.push(check);
        row.add(check, { flex: 1 });
        if (state === "closed") {
          const again = new qx.ui.form.Button("Yeniden bağlan").set({ padding: [1, 6], toolTipText: link.getError() || null });
          again.addListener("execute", () => {
            win.reconnect(link);
            popup.hide();
          });
          row.add(again);
          check.setUserData("again", true);
        }
        list.add(row);
      });
      // Listede ara (kullanıcı isteği 2026-11-10 — bütün hazır seçenek listeleri gibi, bkz. page.Base __choicePopup): uymayan
      // bilgisayarlar gizlenir, "Tümü" yalnız görünenlere uygulanır.
      const shown = () => checks.filter(c => c.getUserData("row").isVisible());
      const search = new qx.ui.form.TextField().set({ placeholder: "Listede ara…", liveUpdate: true });
      search.addListener("changeValue", e => {
        const text = ankamon.page.Base.filterText(e.getData() || "").trim();
        checks.forEach(c => c.getUserData("row").setVisibility(!text || c.getUserData("text").includes(text) ? "visible" : "excluded"));
        syncAll();
      });
      popup.add(search);
      all.addListener("execute", () => {
        // Üç durumluda tıklama sırası null → true: kısmi seçimden "hepsi"; hepsi seçiliyken "hiçbiri". Yalnız görünenler.
        const visible = shown();
        const on = visible.some(c => !c.getValue());
        batch = true;
        visible.forEach(c => c.setValue(on));
        batch = false;
        syncAll();
        apply();
      });
      syncAll();
      popup.add(all);
      // Kaydırma alanı içeriğe göre büyümez (qx): yükseklik tahta sayısından, en çok 600 px.
      // Genişlik de içeriğe göre büyümez: en uzun satırın (ad + durum [+ Yeniden bağlan]) ölçülen genişliği
      // + kaydırma çubuğu; 420–820 px arası (satırlar kırılmasın/kesilmesin — kullanıcı isteği).
      const textW = html => qx.bom.Label.getHtmlSize(html, { fontSize: "13px" }).width;
      const widest = Math.max(0, ...checks.map(c => textW(c.getLabel()) + (c.getUserData("again") ? 120 : 0)));
      popup.add(new qx.ui.container.Scroll(list).set({
        height: Math.min(600, checks.length * 28 + 6), maxHeight: 600,
        width: Math.max(420, Math.min(820, Math.ceil(widest) + 60))
      }), { flex: 1 });
      const foot = new qx.ui.container.Composite(new qx.ui.layout.HBox(6));
      foot.add(new qx.ui.basic.Label("Hiçbiri seçili değilse hepsi gösterilir.").set({ textColor: "app-muted", alignY: "middle" }), { flex: 1 });
      const clear = new qx.ui.form.Button("Temizle");
      clear.addListener("execute", () => {
        batch = true;
        checks.forEach(c => c.setValue(false));
        batch = false;
        win.setBoardFilter([]);
        popup.hide();
      });
      foot.add(clear);
      popup.add(foot);
      popup.addListener("disappear", () => qx.event.Timer.once(() => !popup.isDisposed() && popup.dispose(), null, 0));
      // Canlı konumlama yok: pencere liste açıkken kapanırsa (düğme yok edilince) konum güncellemesi hata veriyordu.
      popup.placeToWidget(this, false);
      this.__popup = popup;
      popup.show();
      qx.event.Timer.once(() => !search.isDisposed() && search.focus(), null, 50);
    }
  },

  destruct() {
    // Pencere kapanırken açık kalmış liste de gitsin.
    if (this.__popup && !this.__popup.isDisposed()) {
      this.__popup.dispose();
    }
    this.__popup = null;
  }
});
