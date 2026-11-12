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
 * Sağ menü Ekran ▸ "Ekranı başka bilgisayara aktar": sağ tıklanan cihazın ekranı işaretlenen cihazlarda tam ekran görünür
 * (bkz. worker executor/relay.py). Çoklu seçimde öteki seçili cihazlar işaretli gelir. "Ekran aktarımını durdur" normale döndürür.
 */
qx.Class.define("ankamon.ui.devices.RelayDialog", {
  type: "static",

  statics: {
    /**
     * @param source {Map} görüntüsü aktarılacak cihaz
     * @param selected {Array} sağ menünün uygulandığı cihazlar
     * @param user {Map?} oturum sahibi (çıktı penceresindeki "bir daha gösterme" tercihi)
     */
    async open(source, selected, user) {
      const name = b => b.label || b.hostname || b.ip || "#" + b.id;
      let devices;
      try {
        devices = (await ankamon.io.Api.get("/devices")).devices.filter(b => b.online && b.id !== source.id);
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      devices.sort((a, b) => name(a).localeCompare(name(b), "tr", { numeric: true }));
      const win = ankamon.ui.Dialog.window(`Ekranı aktar — ${name(source)}`, 460);
      win.add(new qx.ui.basic.Label(
        `<b>${qx.bom.String.escape(name(source))}</b> ekranı işaretlenen bilgisayarlarda tam ekran gösterilir; o bilgisayarlar ` +
        "izleme ekranına döner. Normale dönmek için sağ menü <b>Ekran ▸ Ekran aktarımını durdur</b>."
      ).set({ rich: true, wrap: true }));
      const list = new ankamon.ui.homebackup.CheckColumn().set({ height: 300 });
      win.add(list, { flex: 1 });
      const go = new qx.ui.form.Button("Aktar").set({ enabled: false });
      list.addListener("changeChecked", () => {
        const n = list.getChecked().length;
        go.setEnabled(n > 0);
        go.setLabel(n ? `Aktar (${n} bilgisayar)` : "Aktar");
      });
      const preset = selected.map(b => b.id).filter(id => id !== source.id);
      list.setItems(devices.map(b => ({ value: b.id, label: name(b), checked: preset.includes(b.id) })), "Başka çevrim içi bilgisayar yok.");
      go.addListener("execute", () => {
        const ids = list.getChecked();
        win.close();
        ankamon.ui.DeviceOps.hideableJob({ type: "relay_start", source_device_id: source.id, device_ids: ids },
          `Ekranı aktar — ${name(source)}`, "relay_start", "aktarım", user);
      });
      ankamon.ui.Dialog.buttons(win, [go]);
      win.open();
    }
  }
});
