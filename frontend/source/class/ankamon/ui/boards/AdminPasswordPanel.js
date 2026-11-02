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
 * Parola ayarla penceresinin "Yönetici hesapları" sekmesi: seçilen TEK bilgisayarda root ve etapadmin parolası (bkz. worker
 * executor/board_password.py). Tahtadaki parola genel paroladan (Ayarlar ▸ SSH erişimi) farklıysa mevcut parola kutusu çıkar:
 * "Doğrula" tahtada sınar, doğrulanmadan yeni parola verilemez. Hesaplar yetkiye göre (boards.passwords.<hesap>).
 */
qx.Class.define("ankamon.ui.boards.AdminPasswordPanel", {
  extend: qx.ui.tabview.Page,

  /**
   * @param boards {Array} çevrim içi tahtalar (birden çoksa seçim kutusu)
   * @param accounts {Array} yetkili hesaplar ("root", "etapadmin")
   */
  construct(boards, accounts) {
    super("Yönetici hesapları");
    this.setLayout(new qx.ui.layout.VBox(10));
    this.setPadding(10);
    this.__boards = boards;

    const top = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    top.add(new qx.ui.basic.Label("Bilgisayar:").set({ alignY: "middle" }));
    this.__select = new qx.ui.form.SelectBox();
    boards.forEach(b => this.__select.add(new qx.ui.form.ListItem(b.label || b.hostname || b.ip || "#" + b.id, null, b)));
    this.__select.setEnabled(boards.length > 1);
    this.__select.addListener("changeSelection", () => this.__loadStatus());
    top.add(this.__select, { flex: 1 });
    this.add(top);
    this.add(new qx.ui.basic.Label("Parola yalnız bu bilgisayarda değişir. Genel parola (Ayarlar ▸ SSH erişimi) ve öteki bilgisayarlar etkilenmez.")
      .set({ rich: true, wrap: true, textColor: "app-muted" }));

    this.__sections = accounts.map(name => this.__section(name));
    this.addListenerOnce("appear", () => this.__loadStatus());
  },

  members: {
    __boards: null,
    __select: null,
    __sections: null,
    __seq: 0,

    __board() {
      return this.__select.getSelection()[0].getModel();
    },

    /** Görevi başlatır, bitene dek bekler; hedef sonucunu döner. Parola görevleri kısadır, pencere açılmaz. */
    async __run(body) {
      const id = (await ankamon.io.Api.post("/jobs", body)).id;
      for (let i = 0; i < 90; i++) {
        const res = await ankamon.io.Api.get(`/jobs/${id}`);
        const t = ((res.job && res.job.targets) || [])[0];
        if (t && !["queued", "running"].includes(t.status)) {
          return t;
        }
        await new Promise(r => setTimeout(r, 400));
      }
      throw new Error("Zaman aşımı.");
    },

    __section(name) {
      const group = new qx.ui.groupbox.GroupBox(name === "root" ? "⚠ root (sistem yöneticisi)" : "⚠ etapadmin (tahtanın yönetici hesabı)")
        .set({ layout: new qx.ui.layout.VBox(6) });
      const state = new qx.ui.basic.Label("Durum okunuyor…").set({ rich: true, wrap: true, textColor: "app-muted", allowGrowX: true });
      group.add(state);

      const grid = new qx.ui.container.Composite(new qx.ui.layout.Grid(8, 6));
      grid.getLayout().setColumnFlex(1, 1);
      const current = new qx.ui.form.PasswordField().set({ placeholder: "Mevcut parola", liveUpdate: true });
      const verify = new qx.ui.form.Button("Doğrula").set({ enabled: false });
      const verifyNote = new qx.ui.basic.Label("").set({ rich: true });
      const first = new qx.ui.form.PasswordField().set({ placeholder: "Yeni parola", liveUpdate: true });
      const second = new qx.ui.form.PasswordField().set({ placeholder: "Yeni parola (tekrar)", liveUpdate: true });
      [current, first, second].forEach(f => f.getContentElement().setAttribute("autocomplete", "new-password"));
      const currentLabel = new qx.ui.basic.Label("Mevcut:");
      grid.add(currentLabel, { row: 0, column: 0 });
      grid.add(current, { row: 0, column: 1 });
      grid.add(verify, { row: 0, column: 2 });
      grid.add(verifyNote, { row: 1, column: 1, colSpan: 2 });
      grid.add(new qx.ui.basic.Label("Yeni:"), { row: 2, column: 0 });
      grid.add(first, { row: 2, column: 1, colSpan: 2 });
      grid.add(new qx.ui.basic.Label("Tekrar:"), { row: 3, column: 0 });
      grid.add(second, { row: 3, column: 1, colSpan: 2 });
      group.add(grid);

      const note = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true });
      group.add(note);
      const apply = new qx.ui.form.Button(`${name} parolasını ayarla`).set({ enabled: false });
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8, "right"));
      row.add(apply);
      group.add(row);
      this.add(group);

      const sec = { name, state, current, currentLabel, verify, verifyNote, first, second, note, apply, differs: null, verified: false, busy: false };
      const red = t => `<span style="color:#c42b1c">${qx.bom.String.escape(t)}</span>`;
      const green = t => `<span style="color:#2fa84a">${qx.bom.String.escape(t)}</span>`;
      sec.red = red;
      sec.green = green;
      const refresh = () => {
        const a = first.getValue() || "";
        const b = second.getValue() || "";
        let err = null;
        if (a || b) {
          if (a.length > 128) {
            err = "Parola en çok 128 karakter olabilir.";
          } else if (a !== a.trim()) {
            err = "Parola boşlukla başlayıp bitemez.";
          } else if (/[\x00-\x1f\x7f]/.test(a)) {
            err = "Parola denetim karakteri içeremez.";
          } else if (a !== b) {
            err = "İki kutudaki parolalar aynı değil.";
          }
          note.setValue(err ? red(err) : green("✓ Parolalar eşleşiyor"));
        } else {
          note.setValue("");
        }
        verify.setEnabled(!sec.busy && !!current.getValue());
        const ready = !!a && !err && sec.differs !== null && (!sec.differs || sec.verified);
        apply.setEnabled(!sec.busy && ready);
      };
      sec.refresh = refresh;
      [first, second].forEach(f => f.addListener("changeValue", refresh));
      current.addListener("changeValue", () => {
        // Parola değişti: önceki doğrulama geçersiz.
        sec.verified = false;
        verifyNote.setValue("");
        refresh();
      });
      verify.addListener("execute", () => this.__verify(sec));
      apply.addListener("execute", () => this.__apply(sec));
      return sec;
    },

    __showCurrent(sec, visible) {
      [sec.current, sec.currentLabel, sec.verify, sec.verifyNote].forEach(w => w.setVisibility(visible ? "visible" : "excluded"));
    },

    async __loadStatus() {
      const seq = ++this.__seq;
      const board = this.__board();
      this.__sections.forEach(sec => {
        sec.differs = null;
        sec.verified = false;
        [sec.current, sec.first, sec.second].forEach(f => f.setValue(""));
        sec.verifyNote.setValue("");
        sec.note.setValue("");
        sec.state.setValue("Durum okunuyor…");
        this.__showCurrent(sec, false);
        sec.refresh();
      });
      let target;
      try {
        target = await this.__run({ type: "password_status", board_ids: [board.id] });
      } catch (e) {
        target = { status: "failed", output: e.message || String(e) };
      }
      if (seq !== this.__seq || this.isDisposed()) {
        return;
      }
      let data = null;
      if (target.status === "ok") {
        try {
          data = JSON.parse(target.output);
        } catch (e) {
          // aşağıda hata gösterilir
        }
      }
      this.__sections.forEach(sec => {
        if (!data) {
          sec.state.setValue(sec.red("Durum okunamadı: " + (target.output || "tahtaya ulaşılamadı")));
          return;
        }
        const info = data[sec.name] || {};
        if (info.exists === false) {
          sec.state.setValue(`Bu bilgisayarda ${sec.name} hesabı yok.`);
          return;
        }
        sec.differs = !!info.differs;
        this.__showCurrent(sec, sec.differs);
        let text = sec.differs ? "Bu bilgisayardaki parola <b>genel paroladan farklı</b>: yeni parola için önce mevcut parolayı doğrulayın."
          : "Bu bilgisayardaki parola genel parolayla aynı.";
        if (!data.ssh) {
          text = sec.name === "root" ? "Genel parolayla bağlanılamıyor: root'un mevcut parolasını doğrulayın; Ankamon bu bilgisayara o parolayla bağlanır."
            : "Genel parolayla bağlanılamıyor: önce root'un mevcut parolasını doğrulayın, sonra bu bölüm kullanılabilir.";
        } else if (sec.name === "root") {
          text += " Yeni parola Ankamon'a kaydedilir, bağlantı bu bilgisayarda onunla sürer.";
        }
        sec.state.setValue(text);
        sec.refresh();
      });
    },

    async __verify(sec) {
      sec.busy = true;
      sec.refresh();
      sec.verifyNote.setValue("Doğrulanıyor…");
      const board = this.__board();
      let target;
      try {
        target = await this.__run({ type: "password_verify", account: sec.name, current: sec.current.getValue(), board_ids: [board.id] });
      } catch (e) {
        target = { status: "failed", output: e.message || String(e) };
      }
      if (this.isDisposed()) {
        return;
      }
      sec.busy = false;
      sec.verified = target.status === "ok";
      sec.verifyNote.setValue(sec.verified ? sec.green("✓ " + (target.output || "Doğru")) : sec.red("✗ " + (target.output || "Yanlış")));
      sec.refresh();
    },

    async __apply(sec) {
      const board = this.__board();
      const esc = qx.bom.String.escape;
      const ok = await ankamon.ui.Dialog.confirm(
        `<b>${esc(board.label || board.hostname || board.ip)}</b> bilgisayarında <b>${sec.name}</b> parolası değiştirilsin mi?` +
        (sec.name === "root" ? "<br><br>Ankamon bu bilgisayara bundan sonra yeni parolayla bağlanır." : ""), "Parolayı ayarla");
      if (!ok) {
        return;
      }
      sec.busy = true;
      sec.refresh();
      sec.note.setValue("Ayarlanıyor…");
      let target;
      try {
        target = await this.__run({
          type: "password_change", account: sec.name, current: sec.current.getValue() || "", new: sec.first.getValue(), board_ids: [board.id]
        });
      } catch (e) {
        target = { status: "failed", output: e.message || String(e) };
      }
      if (this.isDisposed()) {
        return;
      }
      sec.busy = false;
      if (target.status === "ok") {
        const done = target.output || "Parola değiştirildi.";
        await this.__loadStatus();
        sec.note.setValue(sec.green("✓ " + done));
      } else {
        sec.note.setValue(sec.red("✗ " + (target.output || "Başarısız.")));
        sec.refresh();
      }
    }
  }
});
