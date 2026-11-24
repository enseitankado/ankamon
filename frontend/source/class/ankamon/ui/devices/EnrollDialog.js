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
 * "Ankamon'a katılım komutu" penceresi (kullanıcı isteği 2026-11-24): ağda görünen ama Ankamon'un yönetemediği bir
 * bilgisayarda çalıştırılacak TEK kısa komut. Komut Ankamon'dan süreli bir betik çeker (bkz. backend Api/EnrollApi.php):
 * yönetici değilse sudo ister, OpenSSH'i kurar, SSH kullanıcısının (genelde root) parolasını Ayarlar ▸ Cihaz erişimi'ndeki
 * parola yapar, sonunda cihazı Ankamon'a bildirir. Kod belirli süre geçerlidir (betikte parola özeti var); iptal edilebilir.
 *
 * Önşart (öncelikli): Cihaz erişimi parolası tanımlı olmalı — değilse pencere yalnız uyarı + "Cihaz erişimini aç" gösterir.
 * Açıkken 5 sn'de bir tazelenir: betiği kaç kez çekildiği ve katılan cihazlar canlı görünür.
 */
qx.Class.define("ankamon.ui.devices.EnrollDialog", {
  extend: qx.core.Object,

  statics: {
    __instance: null,
    DURATIONS: [[15, "15 dakika"], [60, "1 saat"], [240, "4 saat"], [1440, "24 saat"]],

    open() {
      const W = ankamon.ui.devices.EnrollDialog;
      if (!W.__instance || W.__instance.isDisposed()) {
        W.__instance = new W();
      }
      W.__instance.__win.open();
      W.__instance.__win.setActive(true);
      return W.__instance;
    }
  },

  construct() {
    super();
    const win = this.__win = ankamon.ui.Dialog.window("Ankamon'a katılım komutu", 760);
    win.set({ contentPadding: 12, layout: new qx.ui.layout.VBox(10), resizable: true, minWidth: 460 });
    this.__body = new qx.ui.container.Composite(new qx.ui.layout.VBox(10));
    win.add(this.__body, { flex: 1 });
    const close = new qx.ui.form.Button("Kapat");
    close.addListener("execute", () => win.close());
    ankamon.ui.Dialog.buttons(win, [close]);
    this.__timer = new qx.event.Timer(5000);
    this.__timer.addListener("interval", () => this.__load(false));
    this.__timer.start();
    win.addListener("close", () => this.dispose());
    this.__load(true);
  },

  destruct() {
    this.__timer.stop();
    this.__timer.dispose();
    if (ankamon.ui.devices.EnrollDialog.__instance === this) {
      ankamon.ui.devices.EnrollDialog.__instance = null;
    }
  },

  members: {
    __win: null,
    __body: null,
    __timer: null,
    __sig: null,
    __minutes: 60,

    async __load(force) {
      let res;
      try {
        res = await ankamon.io.Api.get("/enroll");
      } catch (e) {
        if (force && !this.isDisposed()) {
          this.__body.removeAll().forEach(w => w.dispose());
          this.__body.add(new qx.ui.basic.Label(qx.bom.String.escape(e.message || String(e))).set({ rich: true, textColor: "error" }));
        }
        return;
      }
      if (this.isDisposed()) {
        return;
      }
      // Yalnız değişince yeniden çiz (seçili metin / odak kaybolmasın).
      const sig = JSON.stringify(res);
      if (!force && sig === this.__sig) {
        return;
      }
      this.__sig = sig;
      this.__render(res);
    },

    __render(res) {
      const esc = qx.bom.String.escape;
      const F = ankamon.util.Format;
      const body = this.__body;
      body.removeAll().forEach(w => w.dispose());
      const label = (html, extra = {}) => new qx.ui.basic.Label(html).set(Object.assign({ rich: true, wrap: true, selectable: true }, extra));

      if (!res.password_set) {
        const warn = new qx.ui.container.Composite(new qx.ui.layout.VBox(8)).set({
          padding: 10, decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "#c62828", radius: 6 })
        });
        warn.add(label("<b style=\"color:#c62828\">Önce Cihaz erişimi parolasını tanımlayın (önşart).</b><br>" +
          "Ankamon cihazlara SSH ile <b>Sistem ▸ Ayarlar ▸ Cihaz erişimi</b>'ndeki kullanıcı ve parolayla bağlanır. Katılım " +
          "betiği bilgisayarın root parolasını o parola yapar; parola tanımlanmadan komut üretilemez."));
        const go = new qx.ui.form.Button("Cihaz erişimini aç").set({ allowGrowX: false });
        go.addListener("execute", () => {
          this.__win.close();
          qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_PAGE, { page: "settings", tab: "Cihaz erişimi" });
        });
        warn.add(go);
        body.add(warn);
        return;
      }

      body.add(label("Ağda görünen ama Ankamon'un yönetemediği bir bilgisayarı Ankamon'a katmak için o bilgisayarda bir " +
        "<b>terminal</b> açıp aşağıdaki komutu yazın. Komut Ankamon'dan bir betik çeker: gerekirse yönetici (sudo) parolası " +
        `sorar, <b>OpenSSH</b>'i kurar, <b>${esc(res.ssh_user)}</b> parolasını Cihaz erişimi parolası yapar ve cihazı Ankamon'a ` +
        "bildirir. Birkaç dakika içinde cihaz Ankamon'da yönetilebilir görünür.<br><span style=\"opacity:.75\">Betikte parola " +
        "(Linux'ta yalnız özeti) bulunduğundan komut belirli süre geçerlidir; işiniz bitince iptal edebilirsiniz.</span>"));

      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      bar.add(new qx.ui.basic.Label("Geçerlilik:"));
      const dur = new qx.ui.form.SelectBox().set({ width: 110 });
      ankamon.ui.devices.EnrollDialog.DURATIONS.forEach(([m, text]) => {
        const item = new qx.ui.form.ListItem(text, null, m);
        dur.add(item);
        if (m === this.__minutes) {
          dur.setSelection([item]);
        }
      });
      dur.addListener("changeSelection", e => (this.__minutes = e.getData()[0].getModel()));
      bar.add(dur);
      const make = new qx.ui.form.Button(res.tokens.length ? "Yeni komut üret" : "Komut üret");
      make.addListener("execute", async () => {
        make.setEnabled(false);
        try {
          await ankamon.io.Api.post("/enroll", { minutes: this.__minutes });
          await this.__load(true);
        } catch (e) {
          ankamon.ui.Dialog.error(e);
          make.setEnabled(true);
        }
      });
      bar.add(make);
      body.add(bar);

      res.tokens.forEach(t => {
        const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({
          padding: 10, decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 6 })
        });
        const left = Math.max(0, t.expires_at - Math.floor(Date.now() / 1000));
        box.add(label(`<b>Kod ${esc(t.code)}</b> — ${left >= 3600 ? Math.floor(left / 3600) + " sa " : ""}${Math.ceil(left % 3600 / 60)} dk ` +
          `daha geçerli (${F.dateTime(t.expires_at * 1000)}'e kadar) · betik ${t.fetches} kez çekildi` +
          (t.created_by ? ` · üreten: ${esc(t.created_by)}` : "")));
        const line = (title, cmd, tip) => {
          const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
          row.add(new qx.ui.basic.Label(title).set({ width: 150, toolTipText: tip }));
          const field = new qx.ui.form.TextField(cmd).set({ readOnly: true, font: "app-mono", toolTipText: tip });
          field.addListener("focusin", () => field.selectAllText());
          row.add(field, { flex: 1 });
          const copy = new qx.ui.form.Button("Kopyala");
          copy.addListener("execute", async () => {
            await ankamon.util.Clipboard.copy(cmd);
            copy.setLabel("Kopyalandı ✓");
            qx.event.Timer.once(() => !copy.isDisposed() && copy.setLabel("Kopyala"), null, 1500);
          });
          row.add(copy);
          box.add(row);
        };
        line("Linux (Pardus, Ubuntu…)", t.commands.linux, "Terminalde yazın. curl yoksa alttaki wget satırını kullanın.");
        line("Linux (wget ile)", t.commands.linux_wget, "curl kurulu olmayan Linux'ta");
        line("Windows", t.commands.windows, "PowerShell'de yazın (yönetici değilse yönetici penceresi açılır, onaylayın). " +
          `Windows'ta '${res.ssh_user}' adlı yerel yönetici hesabı açılır/ayarlanır.`);
        if (t.joined.length) {
          box.add(label("<b>Katılan cihazlar:</b><br>" + t.joined.map(j =>
            `• ${esc(j.hostname || j.ip)} (${esc(j.ip)}, ${esc(j.mac)}${j.os ? ", " + esc(j.os) : ""}) — ` +
            `${j.created ? "Ankamon'a eklendi" : "zaten kayıtlıydı"}, ${F.dateTime(j.at * 1000)}`).join("<br>")));
        }
        const revoke = new qx.ui.form.Button("Kodu iptal et").set({ allowGrowX: false, toolTipText: "Bu komut artık betik çekemez" });
        revoke.addListener("execute", async () => {
          await ankamon.io.Api.post("/enroll/revoke", { code: t.code });
          this.__load(true);
        });
        box.add(revoke);
        body.add(box);
      });
    }
  }
});
