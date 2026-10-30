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
 * "Yedekle/Geri al" (sağ menü → Dosyalar): iki sekmeli pencere — "Yedekle" (seçilen tahtalardan seçilen hesapların
 * ev dizini + hesap bilgisi + PIN anahtarı, tar.gz) ve "Geri al" (yedek dosyasından hesabı yeniden oluşturma).
 * Sekmeler yetkiye göre: boards.backup / boards.restore. İşler görev penceresinde yürür (bkz. ui.Jobs).
 */
qx.Class.define("ankamon.ui.homebackup.Window", {
  extend: qx.ui.window.Window,

  statics: {
    /**
     * @param boards {Array} sağ menünün uygulandığı tahtalar (çoklu seçim) — iki sekmede de işaretli gelir
     * @param user {Map} oturum sahibi
     */
    async open(boards, user) {
      const name = b => b.label || b.hostname || b.ip || "#" + b.id;
      let all = boards.filter(b => b.online).map(b => ({ id: b.id, name: name(b) }));
      try {
        const res = await ankamon.io.Api.get("/boards");
        const online = res.boards.filter(b => b.online).map(b => ({ id: b.id, name: name(b) }));
        all = online.concat(all.filter(b => !online.some(o => o.id === b.id)));
      } catch (e) {
        // Tahta listesi okunamadı: yalnız seçili tahtalar sunulur.
      }
      all.sort((a, b) => a.name.localeCompare(b.name, "tr", { numeric: true }));
      const win = new ankamon.ui.homebackup.Window(all, boards.filter(b => b.online).map(b => b.id), user);
      qx.core.Init.getApplication().getRoot().add(win);
      win.open();
    }
  },

  construct(boards, selected, user) {
    super("Yedekle/Geri al");
    const root = qx.core.Init.getApplication().getRoot();
    const bounds = root.getBounds() || { width: 1280, height: 760 };
    this.set({
      layout: new qx.ui.layout.Grow(),
      contentPadding: 10,
      width: Math.min(980, bounds.width - 30),
      height: Math.min(680, bounds.height - 30)
    });
    const can = feature => user.is_admin || user.features.includes(feature);
    const tabs = new qx.ui.tabview.TabView().set({ contentPadding: [10, 0, 0, 0] });
    const addTab = (label, panel) => {
      const page = new qx.ui.tabview.Page(label).set({ layout: new qx.ui.layout.Grow() });
      page.add(panel);
      tabs.add(page);
    };
    if (can("boards.backup")) {
      addTab("Yedekle", new ankamon.ui.homebackup.BackupPanel(boards, selected));
    }
    if (can("boards.restore")) {
      addTab("Geri al", new ankamon.ui.homebackup.RestorePanel(boards, selected));
    }
    this.add(tabs);
    this.addListenerOnce("appear", () => this.center());
    this.addListener("close", () => qx.event.Timer.once(() => this.destroy(), null, 0));
  }
});
