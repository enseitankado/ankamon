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
 * "Bilgisayarlar arasında kopyala" (sağ menü → Dosyalar): iki panelli dosya gezgini. Sol panel sağ tıklanan
 * tahtanın /home'u (kullanıcıların dizinleri), sağ panel hedef tahta + dizin. Soldaki seçili öğeler
 * "Kopyala →" ile sağdaki dizine (dolayısıyla hedef tahtaya) kopyalanır; ters yön de var. Her iki
 * panelde silme, ad değiştirme, klasör oluşturma; sahip/grup/izin/boyut sütunları (bkz. ui.files.Pane).
 *
 * Kopyalama sunucuda sürer (worker/ankamon/files/copy.py): tahtadan tahtaya tar akışı, ilerleme
 * yarım saniyede bir okunur. Hedef dizin bir kullanıcıya aitse kopyalananlar o kullanıcıya verilir;
 * root'a aitse (ör. /home) özgün sahiplik korunur. Pencere kapatılırsa kopyalama sunucuda sürer.
 */
qx.Class.define("ankamon.ui.files.CopyWindow", {
  extend: qx.ui.window.Window,

  statics: {
    /**
     * @param board {Map} sağ tıklanan tahta {id, label|hostname|ip}
     * @param user {Map?} oturum sahibi (tablo sütun sırası/gizleme tercihleri için)
     */
    async open(board, user) {
      const name = b => b.label || b.hostname || b.ip || "#" + b.id;
      let boards = [{ id: board.id, name: name(board), online: true }];
      try {
        const res = await ankamon.io.Api.get("/boards");
        boards = res.boards.filter(b => b.online || b.id === board.id).map(b => ({ id: b.id, name: name(b) }));
      } catch (e) {
        // Tahta listesi okunamadı (ör. "boards" yetkisi yok): yalnız bu tahta arasında kopyalanır.
      }
      const win = new ankamon.ui.files.CopyWindow(boards, board.id, user);
      qx.core.Init.getApplication().getRoot().add(win);
      win.open();
    }
  },

  construct(boards, sourceId, user) {
    super("Bilgisayarlar arasında kopyala");
    const root = qx.core.Init.getApplication().getRoot();
    const bounds = root.getBounds() || { width: 1280, height: 760 };
    this.set({
      layout: new qx.ui.layout.VBox(8),
      contentPadding: 10,
      width: Math.min(1500, bounds.width - 30),
      height: Math.min(820, bounds.height - 30)
    });
    // Hedef: kaynaktan farklı ilk tahta (yoksa aynı tahta — tahta içinde dizinler arası kopyalama).
    const other = boards.find(b => b.id !== sourceId) || boards[0];
    this.__left = new ankamon.ui.files.Pane("Kaynak", boards, sourceId, "/home", user);
    this.__right = new ankamon.ui.files.Pane("Hedef", boards, other.id, "/home", user);

    const middle = new qx.ui.container.Composite(new qx.ui.layout.VBox(8).set({ alignY: "middle" }));
    this.__toRight = new qx.ui.form.Button("Kopyala →").set({ toolTipText: "Soldaki seçili öğeleri sağdaki dizine kopyalar" });
    this.__toLeft = new qx.ui.form.Button("← Kopyala").set({ toolTipText: "Sağdaki seçili öğeleri soldaki dizine kopyalar" });
    this.__toRight.addListener("execute", () => this.__copy(this.__left, this.__right));
    this.__toLeft.addListener("execute", () => this.__copy(this.__right, this.__left));
    middle.add(this.__toRight);
    middle.add(this.__toLeft);

    // İki panel her zaman eşit genişlikte: HBox flex yalnız ARTAN alanı paylaştırır, tercih edilen genişlik
    // ise içerikten (durum satırındaki yol, tahta adı) gelir ve her dizin yüklenişinde değişir — paneller
    // eşit olmuyor, ayırma noktası kayıyordu. Aynı sabit tercih genişliğiyle kalan alan yarı yarıya bölünür.
    [this.__left, this.__right].forEach(p => p.set({ width: 300, minWidth: 300 }));
    const panes = new qx.ui.container.Composite(new qx.ui.layout.HBox(10));
    panes.add(this.__left, { flex: 1 });
    panes.add(middle);
    panes.add(this.__right, { flex: 1 });
    this.add(panes, { flex: 1 });

    // İlerleme satırı (yalnız kopyalama sürerken/bitince görünür).
    this.__progressRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }))
      .set({ visibility: "excluded" });
    this.__bar = new qx.ui.indicator.ProgressBar(0, 100).set({ width: 320 });
    this.__progressText = new qx.ui.basic.Label("").set({ rich: true });
    this.__cancel = new qx.ui.form.Button("İptal");
    this.__cancel.addListener("execute", this.__cancelCopy, this);
    this.__progressRow.add(this.__bar);
    this.__progressRow.add(this.__progressText, { flex: 1 });
    this.__progressRow.add(this.__cancel);
    this.add(this.__progressRow);

    [this.__left, this.__right].forEach(p => p.addListener("changeState", this.__updateButtons, this));
    this.addListenerOnce("appear", () => {
      this.center();
      // Ekranın tamamını kullanır (kullanıcı isteği; ekran boyutu değişince de izler). Başlık çubuğundaki
      // düğmeyle küçültülüp taşınabilir, çift tıklamayla yeniden büyür.
      this.maximize();
      this.__left.reload();
      this.__right.reload();
    });
    this.addListener("close", () => {
      this.__stopPolling();
      qx.event.Timer.once(() => this.destroy(), null, 0);
    });
    this.__updateButtons();
  },

  members: {
    __left: null,
    __right: null,
    __toRight: null,
    __toLeft: null,
    __progressRow: null,
    __bar: null,
    __progressText: null,
    __cancel: null,
    __jobId: null,
    __timer: null,
    __target: null,

    __updateButtons() {
      const busy = this.__jobId !== null;
      this.__toRight.setEnabled(!busy && this.__left.getSelectedNames().length > 0);
      this.__toLeft.setEnabled(!busy && this.__right.getSelectedNames().length > 0);
    },

    async __copy(from, to) {
      const names = from.getSelectedNames();
      if (!names.length) {
        return;
      }
      const esc = qx.bom.String.escape;
      const clash = names.filter(n => to.getNames().includes(n));
      if (clash.length) {
        const ok = await ankamon.ui.Dialog.confirm(
          `Hedefte aynı adlı ${clash.length} öğe var; <b>üzerine yazılacak</b>:<br>` +
          clash.slice(0, 8).map(n => "• " + esc(n)).join("<br>") +
          (clash.length > 8 ? `<br>… ve ${clash.length - 8} öğe daha` : ""), "Üzerine yaz");
        if (!ok) {
          return;
        }
      }
      try {
        const res = await ankamon.ui.files.Api.post("/copy", {
          src_board: from.getBoardId(), src_dir: from.getPath(), names,
          dst_board: to.getBoardId(), dst_dir: to.getPath()
        });
        this.__jobId = res.id;
        this.__target = to;
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      this.__progressRow.setVisibility("visible");
      this.__cancel.setEnabled(true);
      this.__bar.setValue(0);
      this.__progressText.setValue(
        `${esc(from.getBoardName())}:${esc(from.getPath())} → ${esc(to.getBoardName())}:${esc(to.getPath())} — başlıyor…`);
      this.__updateButtons();
      this.__timer = new qx.event.Timer(500);
      this.__timer.addListener("interval", this.__poll, this);
      this.__timer.start();
    },

    async __poll() {
      if (this.__jobId === null) {
        return;
      }
      let job;
      try {
        job = await ankamon.ui.files.Api.request("GET", "/copy/" + this.__jobId);
      } catch (e) {
        return; // geçici hata: bir sonraki turda yeniden denenir
      }
      const fmt = ankamon.util.Format.bytes;
      const pct = job.total ? Math.min(job.state === "done" ? 100 : 99, Math.floor((job.bytes / job.total) * 100)) : 0;
      this.__bar.setValue(job.state === "done" ? 100 : pct);
      const elapsed = Math.max(1, ((job.finished || Date.now() / 1000) - job.started));
      const speed = job.bytes / elapsed;
      const sizes = job.total ? `${fmt(Math.min(job.bytes, job.total))} / ${fmt(job.total)}` : "";
      const esc = qx.bom.String.escape;
      if (job.state === "running") {
        const left = speed > 0 && job.total ? Math.max(0, (job.total - job.bytes) / speed) : null;
        this.__progressText.setValue(`%${pct} · ${sizes}` + (speed ? ` · ${fmt(speed)}/sn` : "") +
          (left !== null && job.bytes ? ` · kalan ~${ankamon.util.Format.duration(Math.round(left))}` : "") +
          ` — ${esc(job.message)}`);
        return;
      }
      this.__stopPolling();
      this.__progressText.setValue(job.state === "done"
        ? `Tamamlandı · ${sizes} · ${ankamon.util.Format.duration(Math.round(elapsed))}`
        : `<span style="color:#c42b1c">${esc(job.message)}</span>`);
      this.__cancel.setEnabled(false);
      if (this.__target) {
        this.__target.reload();
      }
    },

    async __cancelCopy() {
      if (this.__jobId === null) {
        return;
      }
      try {
        await ankamon.ui.files.Api.post("/copy/" + this.__jobId + "/cancel", {});
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    __stopPolling() {
      if (this.__timer) {
        this.__timer.stop();
        this.__timer.dispose();
        this.__timer = null;
      }
      const wasRunning = this.__jobId !== null;
      this.__jobId = null;
      if (wasRunning) {
        this.__updateButtons();
      }
    }
  }
});
