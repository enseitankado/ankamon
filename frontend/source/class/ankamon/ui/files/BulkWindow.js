/**
 * "Dosyaları dağıt/topla" (sağ menü → Dosyalar): iki sekmeli pencere — "Dağıt" (bu bilgisayardan
 * tahtalara) ve "Topla" (tahtalardan bu bilgisayara). Her sekme kendi tahta/kullanıcı/konum seçimini ve
 * işini taşır (bkz. ui.files.BulkPanel); iki sekmede aynı anda birer iş yürüyebilir.
 */
qx.Class.define("ankamon.ui.files.BulkWindow", {
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
        // Tahta listesi okunamadı (ör. "boards" yetkisi yok): yalnız seçili tahtalar sunulur.
      }
      all.sort((a, b) => a.name.localeCompare(b.name, "tr", { numeric: true }));
      const win = new ankamon.ui.files.BulkWindow(all, boards.filter(b => b.online).map(b => b.id), user);
      qx.core.Init.getApplication().getRoot().add(win);
      win.open();
    }
  },

  construct(boards, selected, user) {
    super("Dosyaları dağıt/topla");
    const root = qx.core.Init.getApplication().getRoot();
    const bounds = root.getBounds() || { width: 1280, height: 760 };
    this.set({
      layout: new qx.ui.layout.Grow(),
      contentPadding: 10,
      showMinimize: false,
      width: Math.min(1180, bounds.width - 30),
      height: Math.min(920, bounds.height - 30)
    });
    const tabs = new qx.ui.tabview.TabView().set({ contentPadding: [10, 0, 0, 0] });
    const ICON = ankamon.ui.Shell.ICON;
    this.__panels = [["distribute", ICON.distribute + " Dağıt"], ["collect", ICON.collect + " Topla"]].map(([mode, label]) => {
      const page = new qx.ui.tabview.Page(label).set({ layout: new qx.ui.layout.Grow() });
      const panel = new ankamon.ui.files.BulkPanel(mode, boards, selected, user);
      panel.addListener("closeRequest", () => this.close());
      page.add(panel);
      tabs.add(page);
      return panel;
    });
    this.add(tabs);

    this.addListenerOnce("appear", () => this.center());
    this.addListener("beforeClose", this.__beforeClose, this);
    this.addListener("close", () => {
      this.__panels.forEach(p => p.shutdown());
      qx.event.Timer.once(() => this.destroy(), null, 0);
    });
  },

  members: {
    __panels: null,
    __forceClose: false,

    async __beforeClose(e) {
      const running = this.__panels.filter(p => p.isRunning());
      if (this.__forceClose || !running.length) {
        return;
      }
      e.preventDefault();
      const ok = await ankamon.ui.Dialog.confirm("İşlem sürüyor. İptal edilip pencere kapatılsın mı?", "İptal et ve kapat");
      if (ok) {
        await Promise.all(running.map(p => p.cancelJob()));
        this.__forceClose = true;
        this.close();
      }
    }
  }
});
