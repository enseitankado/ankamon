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
 * Ağ ▸ sağ menü ▸ Ping...: seçili cihazlara sunucudan sistem ping aracıyla 4'er paket, çoklu seçimde paralel
 * (bkz. backend DevicePing). Üstte cihaz başına özet; seçili cihazın ham ping çıktısı altta.
 */
qx.Class.define("ankamon.ui.network.PingWindow", {
  type: "static",

  statics: {
    /** @param devices {Array} IP'si olan Ağ grid'i cihazları. */
    show(devices) {
      const Ops = ankamon.ui.network.Ops;
      const win = ankamon.ui.Dialog.window(devices.length > 1 ? `Ping — ${devices.length} cihaz` : "Ping", 720);
      const model = new qx.ui.table.model.Simple();
      model.setColumns(["Cihaz", "IP adresi", "Sonuç", "Alınan", "Kayıp", "Ortalama"]);
      const table = new qx.ui.table.Table(model).set({
        height: Math.min(300, 60 + devices.length * 28), statusBarVisible: false, columnVisibilityButtonVisible: false
      });
      [190, 120, 150, 70, 60, 90].forEach((width, col) => table.getTableColumnModel().setColumnWidth(col, width));
      win.add(table, { flex: 1 });

      const output = new qx.ui.form.TextArea("").set({ readOnly: true, font: "app-mono", height: 140 });
      win.add(output);

      let results = new Map();
      const showOutput = () => {
        const row = table.getSelectionModel().getAnchorSelectionIndex();
        const device = row >= 0 ? devices[row] : null;
        const result = device ? results.get(device.id) : null;
        output.setValue(result ? result.output : "");
      };
      table.getSelectionModel().addListener("changeSelection", showOutput);

      const fill = pending => model.setData(devices.map(d => {
        const r = results.get(d.id);
        if (!r) {
          return [Ops.deviceName(d), d.ip, pending ? "Ping atılıyor…" : "Sonuç yok", "", "", ""];
        }
        return [Ops.deviceName(d), d.ip, r.ok ? "✓ Yanıt veriyor" : "✗ Yanıt yok", `${r.received}/${r.transmitted}`,
          r.loss === null ? "" : `%${r.loss}`, r.avg === null ? "" : `${r.avg} ms`];
      }));

      const again = new qx.ui.form.Button("Yeniden ping");
      const run = async () => {
        again.setEnabled(false);
        results = new Map();
        output.setValue("");
        fill(true);
        try {
          const data = await ankamon.io.Api.post("/network/ping", { ids: devices.map(d => d.id) });
          results = new Map(data.results.map(r => [r.id, r]));
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
        if (win.isDisposed()) {
          return;
        }
        fill(false);
        table.getSelectionModel().setSelectionInterval(0, 0);
        showOutput();
        again.setEnabled(true);
      };
      again.addListener("execute", run);
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [again, close]);
      win.open();
      run();
    }
  }
});
