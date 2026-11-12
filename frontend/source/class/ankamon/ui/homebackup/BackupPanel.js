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
 * Yedekle sekmesi: cihazlar × hesaplar. Hesap listesi seçili cihazların birleşimidir (önbellekli, bkz.
 * DeviceOps.accountsOf); bir hesap bazı cihazlarda yoksa o cihazlarda atlanır. Görev: "backup_home" (bkz. worker
 * executor/backup.py); canlı rapor, ilerleme ve sırayla indirme görev penceresinde (bkz. ui.Jobs).
 */
qx.Class.define("ankamon.ui.homebackup.BackupPanel", {
  extend: qx.ui.container.Composite,

  /**
   * @param devices {Array} [{id, name}] çevrim içi cihazlar
   * @param selected {Array} başta işaretli cihaz kimlikleri
   */
  construct(devices, selected) {
    super(new qx.ui.layout.VBox(10));
    this.__devices = devices;
    const body = new qx.ui.container.Composite(new qx.ui.layout.HBox(10));

    const step1 = ankamon.ui.StepBox.create(1, "Cihazları seç");
    this.__deviceList = new ankamon.ui.homebackup.CheckColumn();
    step1.add(this.__deviceList, { flex: 1 });
    body.add(step1, { flex: 1 });

    const step2 = ankamon.ui.StepBox.create(2, "Hesapları seç", "seçili cihazlardaki hesaplar");
    this.__accountList = new ankamon.ui.homebackup.CheckColumn();
    step2.add(this.__accountList, { flex: 1 });
    this.__note = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true, wrap: true, allowGrowX: true });
    step2.add(this.__note);
    body.add(step2, { flex: 1 });
    this.add(body, { flex: 1 });

    const step3 = ankamon.ui.StepBox.create(3, "Yedekle");
    const head = step3.getChildren()[0];
    head.add(new qx.ui.basic.Label(
      "Ev dizini (izin ve sahiplik bilgisiyle), hesap bilgileri, parola özeti ve varsa PIN anahtarı tek .tar.gz dosyasına alınır. " +
      "<b>Dosyayı gizli tutun.</b>"
    ).set({ textColor: "app-muted", rich: true, wrap: true, alignY: "middle", marginLeft: 10 }), { flex: 1 });
    this.__start = new qx.ui.form.Button("Yedekle").set({ minWidth: 120, font: "bold", enabled: false });
    this.__start.addListener("execute", () => this.__run());
    head.add(this.__start);
    this.add(step3);

    this.__deviceList.addListener("changeChecked", () => this.__loadAccounts());
    this.__accountList.addListener("changeChecked", () => this.__update());
    this.__deviceList.setItems(devices.map(b => ({ value: b.id, label: b.name, checked: selected.includes(b.id) })), "Çevrim içi cihaz yok.");
  },

  members: {
    __devices: null,
    __deviceList: null,
    __accountList: null,
    __note: null,
    __start: null,
    __loadSeq: 0,

    __chosenDevices() {
      const ids = this.__deviceList.getChecked();
      return this.__devices.filter(b => ids.includes(b.id));
    },

    async __loadAccounts() {
      const seq = ++this.__loadSeq;
      const devices = this.__chosenDevices();
      this.__update();
      if (!devices.length) {
        this.__note.setValue("");
        this.__accountList.setItems([], "Önce cihaz seçin.");
        return;
      }
      this.__note.setValue("Hesaplar yükleniyor…");
      const results = await Promise.allSettled(devices.map(b => ankamon.ui.DeviceOps.accountsOf(b)));
      if (seq !== this.__loadSeq || this.isDisposed()) {
        return; // bu arada cihaz seçimi değişti: yeni yükleme sonucu geçerli
      }
      const union = new Map();
      const failed = [];
      results.forEach((res, i) => {
        if (res.status !== "fulfilled") {
          failed.push(devices[i].name);
          return;
        }
        res.value.forEach(acc => {
          const row = union.get(acc.name) || { acc, count: 0 };
          row.count++;
          union.set(acc.name, row);
        });
      });
      const reached = devices.length - failed.length;
      const show = sizes => {
        const items = [...union.values()]
          .sort((a, b) => ((sizes && sizes[b.acc.name]) || 0) - ((sizes && sizes[a.acc.name]) || 0) ||
            a.acc.name.localeCompare(b.acc.name, "tr", { numeric: true }))
          .map(({ acc, count }) => {
            const label = acc.full_name && acc.full_name !== acc.name ? `${acc.full_name} (${acc.name})` : acc.name;
            const mb = sizes && sizes[acc.name];
            return {
              value: acc.name, label: label + (reached > 1 && count < reached ? ` — ${count}/${reached} cihazda` : ""),
              side: sizes ? (mb === undefined ? "—" : `${mb} MB`) : "…"
            };
          });
        this.__accountList.setItems(items, "Seçili cihazlarda kullanıcı hesabı yok.");
      };
      show(null);
      this.__note.setValue((failed.length ? "Hesapları alınamayan cihazlar: " + qx.bom.String.escape(failed.join(", ")) + ". " : "") +
        (union.size ? ankamon.ui.JobSpinner.label("Boyutlar ölçülüyor…") : ""));
      const failNote = failed.length ? "Hesapları alınamayan cihazlar: " + qx.bom.String.escape(failed.join(", ")) : "";
      let sizes = null;
      try {
        sizes = union.size ? await this.__homeSizes(devices.filter(b => !failed.includes(b.name))) : {};
      } catch (e) {
        // boyutlar okunamazsa liste yine kullanılabilir
      }
      if (seq !== this.__loadSeq || this.isDisposed()) {
        return;
      }
      if (sizes) {
        show(sizes);
      }
      this.__note.setValue(failNote + (sizes ? "" : (failNote ? " " : "") + "Ev dizini boyutları okunamadı."));
    },

    /**
     * Ev dizini boyutları (MB): "home_sizes" görevi cihazlarda du çalıştırır (bkz. worker executor/homesize.py).
     * Birden çok cihazda hesap başına toplam: yedeğin kaplayacağı alan.
     * @return {Map} {hesap: MB}
     */
    async __homeSizes(devices) {
      const id = (await ankamon.io.Api.post("/jobs", { type: "home_sizes", device_ids: devices.map(b => b.id) })).id;
      for (let i = 0; i < 300; i++) {
        const res = await ankamon.io.Api.get(`/jobs/${id}`);
        const targets = (res.job && res.job.targets) || [];
        if (targets.length && !targets.some(t => ["queued", "running"].includes(t.status))) {
          const sum = {};
          targets.filter(t => t.status === "ok").forEach(t => Object.entries(JSON.parse(t.output || "{}")).forEach(([name, mb]) => {
            sum[name] = (sum[name] || 0) + mb;
          }));
          return sum;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      throw new Error("zaman aşımı");
    },

    __update() {
      const devices = this.__deviceList.getChecked().length;
      const accounts = this.__accountList.getChecked().length;
      this.__start.setEnabled(devices > 0 && accounts > 0);
      this.__start.setLabel(devices && accounts ? `Yedekle (${devices} cihaz, ${accounts} hesap)` : "Yedekle");
    },

    __run() {
      const devices = this.__deviceList.getChecked();
      const usernames = this.__accountList.getChecked();
      ankamon.ui.Jobs.show(
        ankamon.io.Api.post("/jobs", { type: "backup_home", usernames, device_ids: devices }).then(res => res.id),
        `Yedekle — ${usernames.length === 1 ? usernames[0] : usernames.length + " hesap"}` + (devices.length > 1 ? ` (${devices.length} cihaz)` : ""),
        { progress: true, downloads: (jobId, name) => `/api/home-backups/${jobId}?file=${encodeURIComponent(name)}` });
    }
  }
});
