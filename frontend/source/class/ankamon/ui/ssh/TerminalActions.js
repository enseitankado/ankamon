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
 * Web terminal penceresinin "Hazır komutlar" menüsü (kullanıcı isteği 2026-11-23): Komut çalıştır'daki hazır işlemler
 * terminalin içinden uygulanır — seçilen işlemin parametreleri sorulur, sunucu (POST /api/actions/terminal —
 * ActionsApi::terminal) değerleri görevdeki kurallarla doğrulayıp cihaz başına tek satırlık komut üretir, satır
 * terminale yazılıp Enter'lanır; çıktı terminalde akar. Toplu (çoklu) terminalde her panoya kendi cihazının
 * işletim sistemine göre komutu gider (Linux/macOS bash, Windows PowerShell).
 *
 * Terminalden uygulanamayanlar menüde soluk: cihaza araç kopyalayan işlemler ("tools" — Komut çalıştır ile görev
 * olarak çalışır) ve seçili cihazların sisteminde uygulaması olmayanlar. Kendi arayüzü olan hazır komut ("ui", ör.
 * Disk editörü) terminale yazılmaz, tek cihazlı terminalde o pencereyi açar.
 *
 * Gönderim: webssh sayfası pencere düzeyinde "wssh" nesnesi bırakır (bkz. docker/rootfs/multishell/index.html);
 * JSON dizgesi {data} ham iletilir. Tekli terminalde iframe'in kendisi, çoklu terminalde multishell'in iç
 * iframe'leri (cihaz sırasıyla) hedeftir.
 */
qx.Class.define("ankamon.ui.ssh.TerminalActions", {
  type: "static",

  statics: {
    /**
     * Terminal penceresinin üst çubuğuna konan menü düğmesi.
     * @param devices {Array} terminaldeki cihazlar (çoklu terminalde pano sırasıyla)
     * @param frame {qx.ui.embed.Iframe} terminal iframe'i (webssh ya da multishell)
     * @return {qx.ui.form.MenuButton}
     */
    button(devices, frame) {
      const menu = new qx.ui.menu.Menu();
      const button = new qx.ui.form.MenuButton("Hazır komutlar", null, menu).set({ padding: [1, 8],
        toolTipText: devices.length > 1
          ? `Seçilen hazır komut ${devices.length} panonun her birine kendi cihazının sistemine göre yazılıp çalıştırılır.`
          : "Seçilen hazır komut terminale yazılıp çalıştırılır; çıktısı terminalde görünür." });
      const info = text => menu.add(new qx.ui.menu.Button(text).set({ enabled: false }));
      info("Yükleniyor…");
      Promise.all([ankamon.io.Api.get("/actions"), ankamon.ui.devices.Platforms.load().catch(() => null)]).then(([res]) => {
        menu.removeAll().forEach(w => w.dispose());
        this.__fill(menu, res.actions || [], devices, frame);
        if (!menu.getChildren().length) {
          info("Çalıştırabileceğiniz hazır komut yok");
        }
      }).catch(e => {
        menu.removeAll().forEach(w => w.dispose());
        info("Hazır komutlar alınamadı: " + (e.message || e));
      });
      return button;
    },

    /** Kategori alt menüleri; her madde uygunluğuna göre etkin/soluk. */
    __fill(menu, actions, devices, frame) {
      const P = ankamon.ui.devices.Platforms;
      const present = [...new Set(devices.map(d => P.familyOf(d)))];
      const groups = new Map();
      actions.forEach(a => {
        if (!groups.has(a.category)) {
          groups.set(a.category, new qx.ui.menu.Menu());
          menu.add(new qx.ui.menu.Button(a.category, null, null, groups.get(a.category)));
        }
        const item = new qx.ui.menu.Button(a.title + (a.params.length || a.ui ? "…" : ""));
        const families = a.platforms || ["linux"];
        let why = null;
        if (a.ui) {
          why = devices.length !== 1 ? "Tek cihazda çalışır — bu cihazın tekli terminalinden ya da Komut çalıştır'dan açın." : null;
        } else if (a.tools && a.tools.length) {
          why = "Cihaza araç kopyaladığı için terminalden uygulanamaz — Komut çalıştır ile görev olarak çalıştırın.";
        } else if (!present.some(f => families.includes(f))) {
          why = `Terminaldeki cihazların sisteminde (${present.map(f => P.label(f)).join(", ")}) uygulaması yok.`;
        }
        item.set({ enabled: !why, toolTipText: why || a.description || null });
        item.addListener("execute", () => this.__pick(a, devices, frame));
        groups.get(a.category).add(item);
      });
    },

    /** Parametreleri sorar (yoksa ve onay istemiyorsa doğrudan gönderir). */
    async __pick(action, devices, frame) {
      if (action.ui) {
        ankamon.ui.DeviceOps.openActionUi(action, devices[0]);
        return;
      }
      const form = ankamon.ui.DeviceOps.actionForm(action);
      if (!form && !action.confirm) {
        this.__send(action, {}, devices, frame);
        return;
      }
      const win = ankamon.ui.Dialog.window(`Terminalde çalıştır — ${action.title}`, 520);
      win.add(new qx.ui.basic.Label(qx.bom.String.escape(action.description || "") +
        `<br><span style="opacity:.8">Hedef: ${devices.length > 1 ? devices.length + " pano (her birine kendi cihazının komutu)" : "bu terminal"}` +
        " — komut terminale yazılıp çalıştırılır, çıktısı terminalde görünür.</span>").set({ rich: true, wrap: true }));
      if (form) {
        win.add(form);
      }
      const cancel = new qx.ui.form.Button("Vazgeç");
      cancel.addListener("execute", () => win.close());
      const run = new qx.ui.form.Button("Terminalde çalıştır");
      run.addListener("execute", async () => {
        run.setEnabled(false);
        const ok = await this.__send(action, form ? form.values() : {}, devices, frame);
        if (ok) {
          win.close();
        } else {
          run.setEnabled(true);
        }
      });
      ankamon.ui.Dialog.buttons(win, [cancel, run]);
      win.open();
    },

    /** Sunucudan komut satırlarını alır, panolara yazar. @return {Boolean} istek başarılı mı */
    async __send(action, values, devices, frame) {
      let res;
      try {
        res = await ankamon.io.Api.post("/actions/terminal", { action: action.id, values, device_ids: devices.map(d => d.id) });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return false;
      }
      const targets = this.__targets(frame, devices.length);
      const problems = [];
      res.commands.forEach((c, i) => {
        const name = devices[i] ? devices[i].label || devices[i].hostname || devices[i].ip : "#" + c.device_id;
        if (!c.text) {
          problems.push(`${name}: ${c.skipped}`);
          return;
        }
        const w = targets[i];
        try {
          if (!w || !w.wssh || typeof w.wssh.send !== "function") {
            throw new Error("terminal bağlı değil");
          }
          w.wssh.send(JSON.stringify({ data: c.text + "\r" }));
        } catch (e) {
          problems.push(`${name}: ${e.message || e}`);
        }
      });
      if (problems.length) {
        ankamon.ui.Dialog.alert(`<b>${qx.bom.String.escape(res.title)}</b> şu panolara gönderilemedi:<br>` +
          problems.map(p => "• " + qx.bom.String.escape(p)).join("<br>"));
      }
      try {
        frame.getContentElement().getDomElement().contentWindow.focus();
      } catch (e) {
        // odak verilemedi — önemsiz
      }
      return true;
    },

    /** Pano pencereleri cihaz sırasıyla: tekli terminalde iframe'in kendisi, çoklu terminalde iç iframe'ler. */
    __targets(frame, count) {
      const el = frame.getContentElement().getDomElement();
      const w = el && el.contentWindow;
      if (!w) {
        return [];
      }
      if (count === 1 && w.wssh) {
        return [w];
      }
      const out = [];
      try {
        for (let i = 0; i < w.frames.length; i++) {
          out.push(w.frames[i]);
        }
      } catch (e) {
        // erişilemeyen çerçeve
      }
      return out;
    }
  }
});
