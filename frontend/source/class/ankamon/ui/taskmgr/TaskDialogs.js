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
 * Görev yöneticisinin ayrı pencereleri (ui.taskmgr.Window'u küçük tutmak için buradadır): Yeni görev çalıştır,
 * İşlemci benzeşimi, Özellikler. Her biri satırın / seçilen tahtanın bağına (ui.taskmgr.TaskBoardLink) komut
 * gönderir; pencere "her zaman üstte" ise diyaloglar da üstte açılır (win.dialog).
 */
qx.Class.define("ankamon.ui.taskmgr.TaskDialogs", {
  type: "static",

  statics: {
    /**
     * Yeni görev çalıştır. Çok tahtada hangi tahtada çalışacağı seçilir: varsayılan, Bilgisayar süzgecinde tek
     * tahta seçiliyse o (ya da süzgeçte tek bağlı tahta varsa o); değilse seçim istenir. "Süzgeçteki bütün bağlı
     * tahtalar" da seçilebilir (her birine ayrı "run" komutu; başlatılamayanlar sonra listelenir).
     * @param win {ankamon.ui.taskmgr.Window}
     */
    runTask(win) {
      const F = ankamon.ui.taskmgr.Fmt;
      const ALL = "*";
      const dlg = win.dialog("Yeni görev oluştur", 560);
      const info = new qx.ui.basic.Label("").set({ rich: true, wrap: true });
      dlg.add(info);
      let target = null;
      const describe = () => {
        const intro = "Tahtada çalıştırmak istediğiniz programın ya da komutun adını yazın " +
          "(ör. <i>firefox</i>, <i>nemo /home</i>, <i>xdg-open https://eba.gov.tr</i>). ";
        if (target === ALL) {
          info.setValue(intro + "Program seçili her tahtanın ekranında, oturum açmış kullanıcı olarak açılır (oturum açık değilse root olarak).");
          return;
        }
        const link = target ? win.getLink(target) : null;
        const s = link && link.getModel().session;
        info.setValue(intro + (!link ? "Önce görevin çalışacağı tahtayı seçin."
          : "Program tahtanın ekranında " + (s && s.user && s.user !== "lightdm" ? `<b>${F.esc(s.user)}</b> kullanıcısı olarak açılır.` : "açılır (oturum açık değil: root olarak).")));
      };
      let picker = null;
      const targets = win.getVisibleLinks().filter(l => l.isOpen());
      if (win.isMulti()) {
        const pickRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
        pickRow.add(new qx.ui.basic.Label("Tahta:"));
        picker = new qx.ui.form.SelectBox();
        picker.add(new qx.ui.form.ListItem("— Tahta seçin —", null, ""));
        targets.forEach(l => picker.add(new qx.ui.form.ListItem(l.getDisplay(), null, String(l.getId()))));
        if (targets.length > 1) {
          picker.add(new qx.ui.form.ListItem(`Süzgeçteki bütün bağlı tahtalar (${targets.length})`, null, ALL));
        }
        const single = win.getSingleChosen();
        const preset = single && single.isOpen() ? String(single.getId()) : (targets.length === 1 ? String(targets[0].getId()) : "");
        const item = picker.getSelectables().find(i => i.getModel() === preset);
        if (item) {
          picker.setSelection([item]);
        }
        const read = () => {
          const v = picker.getSelection()[0].getModel();
          target = v === ALL ? ALL : (v ? Number(v) : null);
          describe();
        };
        picker.addListener("changeSelection", read);
        pickRow.add(picker, { flex: 1 });
        dlg.add(pickRow);
        read();
      } else {
        target = win.getLinks()[0].getId();
        describe();
      }
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      row.add(new qx.ui.basic.Label("Aç:"));
      const field = new qx.ui.form.TextField();
      row.add(field, { flex: 1 });
      dlg.add(row);
      const admin = new qx.ui.form.CheckBox("Bu görevi yönetici (root) ayrıcalıklarıyla oluştur");
      dlg.add(admin);
      const ok = new qx.ui.form.Button("Tamam");
      const cancel = new qx.ui.form.Button("İptal");
      cancel.addListener("execute", () => dlg.close());
      const go = async () => {
        const cmd = (field.getValue() || "").trim();
        if (!cmd) {
          return;
        }
        if (!target) {
          ankamon.ui.Dialog.alert("Görevin çalışacağı tahtayı seçin.");
          return;
        }
        const links = target === ALL ? targets.filter(l => l.isOpen()) : [win.getLink(target)].filter(Boolean);
        const results = await Promise.allSettled(links.map(l => l.send("run", { cmd, admin: admin.getValue() })));
        const failed = results.map((r, i) => (r.status === "rejected" ? `${links[i].getDisplay()}: ${r.reason.message}` : null)).filter(Boolean);
        if (!failed.length) {
          dlg.close();
        } else if (links.length === 1) {
          ankamon.ui.Dialog.error(results[0].reason);
        } else {
          dlg.close();
          ankamon.ui.Dialog.alert(`${links.length - failed.length}/${links.length} tahtada başlatıldı. Başlatılamayanlar:<br><br>` +
            failed.map(t => F.esc(t)).join("<br>"), "Yeni görev");
        }
      };
      ok.addListener("execute", go);
      field.addListener("keypress", e => {
        if (e.getKeyIdentifier() === "Enter") {
          go();
        }
      });
      ankamon.ui.Dialog.buttons(dlg, [cancel, ok]);
      dlg.open();
      dlg.addListenerOnce("appear", () => (picker && !target ? picker : field).focus());
    },

    /** İşlemci benzeşimi: süreç hangi işlemcilerde çalışabilir (taskset). */
    async affinity(win, link, pid, name) {
      let res;
      try {
        res = await link.send("getaffinity", { pid });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      const dlg = win.dialog("İşlemci benzeşimi", 360);
      dlg.add(new qx.ui.basic.Label(`<b>${ankamon.ui.taskmgr.Fmt.esc(name)}</b> (${pid})${win.whereHtml(link)} hangi işlemcilerde çalışabilir?`).set({ rich: true, wrap: true }));
      const all = new qx.ui.form.CheckBox("<Tüm işlemciler>").set({ value: res.cpus.length === res.ncpu });
      dlg.add(all);
      const boxes = [];
      for (let i = 0; i < res.ncpu; i++) {
        const b = new qx.ui.form.CheckBox(`CPU ${i}`).set({ value: res.cpus.includes(i), marginLeft: 20 });
        boxes.push(b);
        dlg.add(b);
      }
      all.addListener("execute", () => boxes.forEach(b => b.setValue(all.getValue())));
      const ok = new qx.ui.form.Button("Tamam");
      const cancel = new qx.ui.form.Button("İptal");
      cancel.addListener("execute", () => dlg.close());
      ok.addListener("execute", async () => {
        const cpus = boxes.map((b, i) => (b.getValue() ? i : -1)).filter(i => i >= 0);
        if (!cpus.length) {
          ankamon.ui.Dialog.alert("İşlemin en az bir işlemcide çalışması gerekir.");
          return;
        }
        try {
          await link.send("affinity", { pid, cpus });
          dlg.close();
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
      });
      ankamon.ui.Dialog.buttons(dlg, [cancel, ok]);
      dlg.open();
    },

    /** Süreç özellikleri (ajanın "props" yanıtı). */
    async props(win, link, pid) {
      let res;
      try {
        res = await link.send("props", { pid });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      const F = ankamon.ui.taskmgr.Fmt;
      const multi = win.isMulti();
      const p = res.props;
      const row = (k, v) => `<tr><td style="opacity:.7;padding:3px 16px 3px 0;vertical-align:top;white-space:nowrap">${F.esc(k)}</td>` +
        `<td style="word-break:break-all">${F.esc(v ?? "—")}</td></tr>`;
      const dlg = win.dialog(`${p.name} Özellikleri` + (multi ? ` — ${link.getDisplay()}` : ""), 620);
      dlg.add(new qx.ui.embed.Html(`<table style="width:100%;border-collapse:collapse">` + [
        multi ? row("Bilgisayar", link.getDisplay()) : "",
        row("Ad", p.name), row("PID / Üst PID", `${p.pid} / ${p.ppid}`), row("Kullanıcı", p.user), row("Durum", p.state),
        row("Konum (yol)", p.exe), row("Çalışma dizini", p.cwd), row("Komut satırı", p.cmdline),
        row("Başlangıç", p.started ? new Date(p.started * 1000).toLocaleString("tr-TR") : null),
        row("CPU süresi", p.cpu_time !== null ? F.cpuTime(p.cpu_time) : null), row("Öncelik", `${F.priority(p.nice)} (nice ${p.nice})`),
        row("Disk önceliği (ionice)", p.ionice), row("İşlemci benzeşimi", (p.affinity || []).map(c => "CPU " + c).join(", ")),
        row("İş parçacıkları", p.threads), row("Bellek (RSS / sanal / tepe)", `${p.vm_rss} / ${p.vm_size} / ${p.vm_peak}`),
        row("Takas", p.vm_swap), row("Açık dosya tanıtıcıları", p.fds), row("Bağlam değişimi (gönüllü / zorunlu)", (p.ctx || []).join(" / ")),
        row("Bekleme kanalı (wchan)", p.wchan), row("Denetim grubu (cgroup)", (p.cgroup || []).join(" "))
      ].join("") + "</table>").set({ minHeight: 420, overflowY: "auto", selectable: true }));
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => dlg.close());
      ankamon.ui.Dialog.buttons(dlg, [close]);
      dlg.open();
    }
  }
});
