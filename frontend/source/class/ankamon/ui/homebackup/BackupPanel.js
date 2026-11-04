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
 * Yedekle sekmesi: tahtalar × hesaplar. Hesap listesi seçili tahtaların birleşimidir (önbellekli, bkz.
 * BoardOps.accountsOf); bir hesap bazı tahtalarda yoksa o tahtalarda atlanır. Görev: "backup_home" (bkz. worker
 * executor/backup.py); canlı rapor, ilerleme ve sırayla indirme görev penceresinde (bkz. ui.Jobs).
 */
qx.Class.define("ankamon.ui.homebackup.BackupPanel", {
  extend: qx.ui.container.Composite,

  /**
   * @param boards {Array} [{id, name}] çevrim içi tahtalar
   * @param selected {Array} başta işaretli tahta kimlikleri
   */
  construct(boards, selected) {
    super(new qx.ui.layout.VBox(10));
    this.__boards = boards;
    const body = new qx.ui.container.Composite(new qx.ui.layout.HBox(10));

    const step1 = ankamon.ui.StepBox.create(1, "Tahtaları seç");
    this.__boardList = new ankamon.ui.homebackup.CheckColumn();
    step1.add(this.__boardList, { flex: 1 });
    body.add(step1, { flex: 1 });

    const step2 = ankamon.ui.StepBox.create(2, "Hesapları seç", "seçili tahtalardaki hesaplar");
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

    this.__boardList.addListener("changeChecked", () => this.__loadAccounts());
    this.__accountList.addListener("changeChecked", () => this.__update());
    this.__boardList.setItems(boards.map(b => ({ value: b.id, label: b.name, checked: selected.includes(b.id) })), "Çevrim içi tahta yok.");
  },

  members: {
    __boards: null,
    __boardList: null,
    __accountList: null,
    __note: null,
    __start: null,
    __loadSeq: 0,

    __chosenBoards() {
      const ids = this.__boardList.getChecked();
      return this.__boards.filter(b => ids.includes(b.id));
    },

    async __loadAccounts() {
      const seq = ++this.__loadSeq;
      const boards = this.__chosenBoards();
      this.__update();
      if (!boards.length) {
        this.__note.setValue("");
        this.__accountList.setItems([], "Önce tahta seçin.");
        return;
      }
      this.__note.setValue("Hesaplar yükleniyor…");
      const results = await Promise.allSettled(boards.map(b => ankamon.ui.BoardOps.accountsOf(b)));
      if (seq !== this.__loadSeq || this.isDisposed()) {
        return; // bu arada tahta seçimi değişti: yeni yükleme sonucu geçerli
      }
      const union = new Map();
      const failed = [];
      results.forEach((res, i) => {
        if (res.status !== "fulfilled") {
          failed.push(boards[i].name);
          return;
        }
        res.value.forEach(acc => {
          const row = union.get(acc.name) || { acc, count: 0 };
          row.count++;
          union.set(acc.name, row);
        });
      });
      const reached = boards.length - failed.length;
      const show = sizes => {
        const items = [...union.values()]
          .sort((a, b) => ((sizes && sizes[b.acc.name]) || 0) - ((sizes && sizes[a.acc.name]) || 0) ||
            a.acc.name.localeCompare(b.acc.name, "tr", { numeric: true }))
          .map(({ acc, count }) => {
            const label = acc.full_name && acc.full_name !== acc.name ? `${acc.full_name} (${acc.name})` : acc.name;
            const mb = sizes && sizes[acc.name];
            return {
              value: acc.name, label: label + (reached > 1 && count < reached ? ` — ${count}/${reached} tahtada` : ""),
              side: sizes ? (mb === undefined ? "—" : `${mb} MB`) : "…"
            };
          });
        this.__accountList.setItems(items, "Seçili tahtalarda kullanıcı hesabı yok.");
      };
      show(null);
      this.__note.setValue((failed.length ? "Hesapları alınamayan tahtalar: " + qx.bom.String.escape(failed.join(", ")) + ". " : "") +
        (union.size ? ankamon.ui.JobSpinner.label("Boyutlar ölçülüyor…") : ""));
      const failNote = failed.length ? "Hesapları alınamayan tahtalar: " + qx.bom.String.escape(failed.join(", ")) : "";
      let sizes = null;
      try {
        sizes = union.size ? await this.__homeSizes(boards.filter(b => !failed.includes(b.name))) : {};
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
     * Ev dizini boyutları (MB): "home_sizes" görevi tahtalarda du çalıştırır (bkz. worker executor/homesize.py).
     * Birden çok tahtada hesap başına toplam: yedeğin kaplayacağı alan.
     * @return {Map} {hesap: MB}
     */
    async __homeSizes(boards) {
      const id = (await ankamon.io.Api.post("/jobs", { type: "home_sizes", board_ids: boards.map(b => b.id) })).id;
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
      const boards = this.__boardList.getChecked().length;
      const accounts = this.__accountList.getChecked().length;
      this.__start.setEnabled(boards > 0 && accounts > 0);
      this.__start.setLabel(boards && accounts ? `Yedekle (${boards} tahta, ${accounts} hesap)` : "Yedekle");
    },

    __run() {
      const boards = this.__boardList.getChecked();
      const usernames = this.__accountList.getChecked();
      ankamon.ui.Jobs.show(
        ankamon.io.Api.post("/jobs", { type: "backup_home", usernames, board_ids: boards }).then(res => res.id),
        `Yedekle — ${usernames.length === 1 ? usernames[0] : usernames.length + " hesap"}` + (boards.length > 1 ? ` (${boards.length} tahta)` : ""),
        { progress: true, downloads: (jobId, name) => `/api/home-backups/${jobId}?file=${encodeURIComponent(name)}` });
    }
  }
});
