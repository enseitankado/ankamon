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
 * Geri al sekmesi: yedek dosyası sunucuya yüklenir (/home-restore-api/, bkz. worker files HomeRestoreUploadHandler),
 * hesap özeti gösterilir, seçilen tahtalarda hesap + ev dizini + parola + PIN anahtarı yeniden oluşturulur
 * ("restore_home" görevi, bkz. worker executor/home_restore.py). Yüklenen dosya görevle birlikte sunucudan silinir;
 * yeniden geri almak için dosya yeniden seçilir.
 */
qx.Class.define("ankamon.ui.homebackup.RestorePanel", {
  extend: qx.ui.container.Composite,

  /**
   * @param boards {Array} [{id, name}] çevrim içi tahtalar
   * @param selected {Array} başta işaretli tahta kimlikleri
   */
  construct(boards, selected) {
    super(new qx.ui.layout.VBox(10));
    this.__boards = boards;

    const step1 = ankamon.ui.StepBox.create(1, "Yedek dosyasını seç", "Yedekle sekmesiyle alınmış .tar.gz");
    const pick = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__pickButton = new qx.ui.form.Button("Dosya seç…").set({ minWidth: 110 });
    this.__pickButton.addListener("execute", () => this.__pick());
    pick.add(this.__pickButton);
    this.__bar = new qx.ui.indicator.ProgressBar(0, 100).set({ width: 200, height: 14, visibility: "excluded" });
    pick.add(this.__bar);
    this.__info = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true, selectable: true, alignY: "middle" });
    pick.add(this.__info, { flex: 1 });
    step1.add(pick);
    this.add(step1);

    const step2 = ankamon.ui.StepBox.create(2, "Tahtaları seç", "hesap bu tahtalarda yeniden oluşturulur");
    this.__boardList = new ankamon.ui.homebackup.CheckColumn();
    step2.add(this.__boardList, { flex: 1 });
    this.add(step2, { flex: 1 });

    const step3 = ankamon.ui.StepBox.create(3, "Geri al");
    const head = step3.getChildren()[0];
    this.__overwrite = new qx.ui.form.CheckBox("Hesap zaten varsa üzerine yaz").set({
      alignY: "middle", marginLeft: 10,
      toolTipText: "Yedekteki dosyalar eskilerin üstüne yazılır, yedekte olmayanlar kalır; parola ve PIN anahtarı yedektekiyle değişir. " +
        "Açık oturumu olan hesaba yazılmaz. İşaretli değilse var olan hesap hiç değiştirilmez."
    });
    head.add(this.__overwrite);
    head.add(new qx.ui.core.Spacer(), { flex: 1 });
    this.__start = new qx.ui.form.Button("Geri al").set({ minWidth: 120, font: "bold", enabled: false });
    this.__start.addListener("execute", () => this.__run());
    head.add(this.__start);
    this.add(step3);

    this.__boardList.addListener("changeChecked", () => this.__update());
    this.__boardList.setItems(boards.map(b => ({ value: b.id, label: b.name, checked: selected.includes(b.id) })), "Çevrim içi tahta yok.");
  },

  members: {
    __boards: null,
    __pickButton: null,
    __bar: null,
    __info: null,
    __boardList: null,
    __overwrite: null,
    __start: null,
    __summary: null,
    __xhr: null,

    __update() {
      const n = this.__boardList.getChecked().length;
      this.__start.setEnabled(!!this.__summary && n > 0);
      this.__start.setLabel(this.__summary && n ? `Geri al (${n} tahta)` : "Geri al");
    },

    async __pick() {
      const picked = await ankamon.ui.files.BulkIo.pick(false);
      if (picked.length) {
        this.__upload(picked[0].file);
      }
    },

    __upload(file) {
      this.__summary = null;
      this.__update();
      this.__pickButton.setEnabled(false);
      this.__bar.setValue(0);
      this.__bar.show();
      this.__info.setValue(`${qx.bom.String.escape(file.name)} yükleniyor…`);
      const xhr = this.__xhr = new XMLHttpRequest();
      xhr.open("PUT", "/home-restore-api/upload");
      xhr.setRequestHeader("X-Requested-With", "ankamon");
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = e => this.__bar.setValue(e.lengthComputable ? Math.round(e.loaded * 100 / e.total) : 0);
      const finish = (summary, error) => {
        this.__xhr = null;
        if (this.isDisposed()) {
          return;
        }
        this.__bar.exclude();
        this.__pickButton.setEnabled(true);
        this.__summary = summary;
        this.__info.setValue(summary ? this.__describe(summary, file.name)
          : `<span style="color:${qx.theme.manager.Color.getInstance().resolve("error")}">${qx.bom.String.escape(error)}</span>`);
        this.__update();
      };
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch (e) {
          // gövde JSON değil (ör. nginx hata sayfası): açıklama durum kodundan
        }
        if (xhr.status >= 200 && xhr.status < 300 && data) {
          finish(data, null);
        } else {
          finish(null, (data && data.error) || (xhr.status === 403 ? "Bu işlem için yetkiniz yok." : ankamon.ui.files.Api.describe(xhr.status)));
        }
      };
      xhr.onerror = () => finish(null, ankamon.ui.files.Api.describe(0));
      xhr.send(file);
    },

    __describe(s, fileName) {
      const esc = qx.bom.String.escape;
      const F = ankamon.util.Format;
      const who = s.full_name && s.full_name !== s.username ? `${esc(s.full_name)} (${esc(s.username)})` : esc(s.username);
      const source = (s.hostname ? esc(s.hostname) + ", " : "") + (s.created_at ? F.dateTime(s.created_at * 1000) : "tarih yok");
      return `<b>${who}</b> — ${esc(s.home)} · ${F.bytes(s.size)}<br>` +
        `Parola: ${s.has_password ? "var" : "yok"} · PIN anahtarı: ${s.has_otp ? "var" : "yok"} · ` +
        `Kaynak: ${source} · <span style="opacity:.65">${esc(fileName)}</span>`;
    },

    async __run() {
      const s = this.__summary;
      const ids = this.__boardList.getChecked();
      const overwrite = this.__overwrite.getValue();
      const names = this.__boards.filter(b => ids.includes(b.id)).map(b => b.name);
      const esc = qx.bom.String.escape;
      const ok = await ankamon.ui.Dialog.confirm(
        `<b>${esc(s.username)}</b> hesabı <b>${esc(names.join(", "))}</b> tahtasında yedekten yeniden oluşturulsun mu?` +
        (overwrite ? "<br><br>Hesap varsa <b>üzerine yazılır</b>: dosyaları, parolası ve PIN anahtarı yedektekiyle değişir." : ""),
        "Geri al");
      if (!ok || this.__summary !== s) {
        return;
      }
      this.__summary = null;
      this.__info.setValue("");
      this.__update();
      ankamon.ui.BoardOps.forgetAccounts(ids.map(id => ({ id })));
      ankamon.ui.Jobs.show(
        ankamon.io.Api.post("/jobs", { type: "restore_home", token: s.token, username: s.username, overwrite, board_ids: ids }).then(res => res.id),
        `Geri al — ${s.username}` + (ids.length > 1 ? ` (${ids.length} tahta)` : ""),
        { progress: true });
    }
  },

  destruct() {
    if (this.__xhr) {
      this.__xhr.abort();
    }
  }
});
