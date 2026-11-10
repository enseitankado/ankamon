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
 * Sağlık ▸ Yardım ▸ Denetim türleri: satıra çift tıklayınca açılan pencere. Grid'de sığmayan uzun metinler (nasıl
 * bakılır, ne arar) burada tam okunur; yönetici denetimin ayarlarını değiştirebilir (kullanıcı isteği):
 *   - Sürekli izleme türü: sıklık, bulgu düzeyi, anlık taranır (yalnız anlık yoklaması olan türde) —
 *     PUT /api/anomaly-kinds (bkz. backend AnomaliesApi::updateKind; worker anomaly._due sıklığı uygular).
 *   - SSH denetimi başlığı: otomatik denetim aralığı (gün). Bütün SSH başlıkları tek denetimde birlikte bakıldığından
 *     aralık hepsi için ortaktır; düzey sonuca göre değişir, anlık denetim her zaman Tara ▸ Tam SSH denetimi'nden —
 *     PUT /api/diagnose/interval (bkz. DiagnoseApi::setInterval, worker tasks/diagnose_schedule).
 * Varsayılan değer seçeneklerde "(varsayılan)" diye işaretli; varsayılana dönülen alan sunucuda ayarsız (null) saklanır.
 */
qx.Class.define("ankamon.ui.health.CheckTypeWindow", {
  type: "static",

  statics: {
    /** Sürekli izleme sıklık seçenekleri (sn); worker turu 60 sn olduğundan en az 60. */
    EVERY_CHOICES: [60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400],

    everyText(seconds) {
      if (seconds < 120) {
        return `${seconds} sn`;
      }
      if (seconds % 3600 === 0) {
        return `${seconds / 3600} saat`;
      }
      return `${Math.round(seconds / 60)} dk`;
    },

    /**
     * @param row {Map} Catalog satırı: {type: "watch", kind, k} ya da {type: "ssh", group, level, what, how, every,
     *   days, daysDefault}; ortak: check, path, source
     * @param canEdit {Boolean} yönetici mi
     * @param onSaved {Function} kayıttan sonra (sayfayı tazelemek için)
     */
    open(row, canEdit, onSaved) {
      const C = ankamon.ui.health.CheckTypeWindow;
      const L = ankamon.page.Diagnose.LEVEL;
      const esc = s => qx.bom.String.escape(String(s ?? ""));
      const win = ankamon.ui.Dialog.window(`Denetim türü — ${row.check}`, 640);
      const grid = new qx.ui.container.Composite(new qx.ui.layout.Grid(12, 8).setColumnFlex(1, 1).setColumnAlign(0, "left", "top"));
      let r = 0;
      const info = (label, value) => {
        grid.add(new qx.ui.basic.Label(label).set({ font: "bold" }), { row: r, column: 0 });
        grid.add(new qx.ui.basic.Label(esc(value) || "—").set({ rich: true, wrap: true, selectable: true, allowGrowX: true }),
          { row: r++, column: 1 });
      };
      const field = (label, widget, note) => {
        grid.add(new qx.ui.basic.Label(label).set({ font: "bold", alignY: "middle" }), { row: r, column: 0 });
        const box = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
        box.add(widget);
        if (note) {
          box.add(new qx.ui.basic.Label(note).set({ rich: true, wrap: true, textColor: "app-muted" }), { flex: 1 });
        }
        grid.add(box, { row: r++, column: 1 });
      };
      info("Denetim", row.check);
      info("Yol", row.path);
      info("Kaynak", row.source);
      info("Nasıl bakılır", row.how);
      info("Ne arar", row.what);

      let collect = null;
      let reset = null;
      if (row.type === "watch") {
        const k = row.k;
        const def = k.defaults || { every_s: k.every_s || 60, level: k.level || "warn", scan: !!k.scan };
        const every = new qx.ui.form.SelectBox().set({ width: 180 });
        const choices = C.EVERY_CHOICES.includes(def.every_s) ? C.EVERY_CHOICES : C.EVERY_CHOICES.concat([def.every_s]).sort((a, b) => a - b);
        choices.forEach(s => {
          const item = new qx.ui.form.ListItem(C.everyText(s) + (s === def.every_s ? " (varsayılan)" : ""), null, s);
          every.add(item);
          if (s === (k.every_s || def.every_s)) {
            every.setSelection([item]);
          }
        });
        field("Sıklık", every, "Ankamon bu denetimi ne sıklıkla yeniden hesaplar (tahtaya bağlanmaz).");
        const level = new qx.ui.form.SelectBox().set({ width: 180 });
        ["bad", "warn", "info"].forEach(l => {
          const item = new qx.ui.form.ListItem(L[l].text + (l === def.level ? " (varsayılan)" : ""), null, l);
          level.add(item);
          if (l === (k.level || def.level)) {
            level.setSelection([item]);
          }
        });
        field("Bulgu düzeyi", level, "Durum'da tahtanın genel durumunu ve sıralamayı belirler.");
        const scan = new qx.ui.form.CheckBox("Tara sekmesinde anlık yoklanabilir").set({
          value: !!k.scan, enabled: !!k.scan_supported
        });
        field("Anlık taranır", scan, k.scan_supported ? "" : "Bu denetimin tahtada anlık yoklaması yok (yalnız sürekli izlemede).");
        const pick = box => box.getSelection()[0].getModel();
        collect = () => ({
          path: "/anomaly-kinds",
          body: {
            kind: row.kind,
            every_s: pick(every) === def.every_s ? null : pick(every),
            level: pick(level) === def.level ? null : pick(level),
            scan: !k.scan_supported || scan.getValue() === def.scan ? null : scan.getValue()
          }
        });
        reset = () => {
          every.setSelection([every.getChildren().find(it => it.getModel() === def.every_s)]);
          level.setSelection([level.getChildren().find(it => it.getModel() === def.level)]);
          scan.setValue(def.scan);
        };
        [every, level, scan].forEach(w => w.setEnabled(canEdit && (w !== scan || !!k.scan_supported)));
      } else {
        const days = new qx.ui.form.Spinner(1, row.days || row.daysDefault || 7, 60).set({ width: 90 });
        field("Sıklık", days, `gün: her tahta en az bu kadar günde bir kendiliğinden denetlenir (varsayılan ${row.daysDefault} gün). ` +
          "<b>Bütün SSH denetimi başlıkları için ortaktır</b> (hepsine aynı bağlantıda bakılır).");
        info("Bulgu düzeyi", `${row.level} — denetimin sonucuna göre (ölçülen değer ve eşiklerle)`);
        info("Anlık taranır", "Evet — Tara sekmesinde \"Tam SSH denetimi\" ya da Denetle ▸ Şimdi tara");
        collect = () => ({ path: "/diagnose/interval", body: { days: days.getValue() === row.daysDefault ? null : days.getValue() } });
        reset = () => days.setValue(row.daysDefault);
        days.setEnabled(canEdit);
      }
      win.add(grid, { flex: 1 });
      if (!canEdit) {
        win.add(new qx.ui.basic.Label("Ayarları yalnız yönetici değiştirebilir.").set({ textColor: "app-muted" }));
      }

      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      const buttons = [close];
      if (canEdit) {
        const defaults = new qx.ui.form.Button("Varsayılana dön");
        defaults.addListener("execute", () => reset());
        const save = new qx.ui.form.Button("Kaydet");
        save.addListener("execute", async () => {
          const { path, body } = collect();
          save.setEnabled(false);
          try {
            await ankamon.io.Api.put(path, body);
          } catch (e) {
            save.setEnabled(true);
            ankamon.ui.Dialog.error(e);
            return;
          }
          win.close();
          if (onSaved) {
            onSaved();
          }
        });
        buttons.unshift(defaults, save);
      }
      ankamon.ui.Dialog.buttons(win, buttons);
      win.open();
      return win;
    }
  }
});
