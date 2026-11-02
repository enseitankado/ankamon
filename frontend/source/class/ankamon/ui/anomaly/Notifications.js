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
 * Anomaliler ▸ Bildirimler: seçilen bilgisayarlar ve anomali türleri için telefona ntfy bildirimi (bkz. worker tasks/ntfy_notify.py).
 * Üstte konu (öneri: kuruluş adının baş harfleri + kodun son 3 karakteri + rastgele 2 karakter), ortada kurallar, altta
 * gönderilen bildirimler. Konu adını bilen herkes bildirimleri okuyabilir: kısa konu için ekranda uyarı görünür.
 */
qx.Class.define("ankamon.ui.anomaly.Notifications", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Anomalies} */
  construct(page) {
    super("Bildirimler");
    this.setUserData("key", "notifications");
    this.__page = page;
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);
    const canEdit = page._can("anomalies.notify");

    const box = new qx.ui.groupbox.GroupBox("ntfy konusu").set({ layout: new qx.ui.layout.VBox(6) });
    box.add(new qx.ui.basic.Label(
      "Telefona kurulan <b>ntfy</b> uygulamasından aynı konuya abone olduğunuzda bildirimler telefonunuza anında ulaştırılır. " +
      "Konu adı parola gibidir: adı bilen herkes bildirimleri görebilir. " +
      "<b>Öner</b>, Ayarlar ▸ Kuruluş'taki adın baş harfleri, kodun son 3 karakteri ve rastgele 2 karakterden kısa bir ad üretir (ör. afl456k7). " +
      "Bildirim metni (bilgisayar adı ve anomali türü) seçilen sunucuya gönderilir."
    ).set({ rich: true, wrap: true, textColor: "app-muted", allowGrowX: true }));
    const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
    row.add(new qx.ui.basic.Label("Sunucu:").set({ alignY: "middle" }));
    this.__server = new qx.ui.form.TextField("https://ntfy.sh").set({ width: 190 });
    row.add(this.__server);
    row.add(new qx.ui.basic.Label("Konu:").set({ alignY: "middle", marginLeft: 8 }));
    this.__topic = new qx.ui.form.TextField("").set({ liveUpdate: true, placeholder: "ör. afl456k7" });
    this.__topic.addListener("changeValue", () => this.__showStrength());
    row.add(this.__topic, { flex: 1 });
    const suggest = new qx.ui.form.Button("Öner");
    suggest.addListener("execute", () => this.__suggest());
    const save = new qx.ui.form.Button("Kaydet");
    save.addListener("execute", () => this.__saveConfig());
    const test = new qx.ui.form.Button("Deneme gönder");
    test.addListener("execute", () => this.__test());
    [suggest, save, test].forEach(b => row.add(b.set({ enabled: canEdit })));
    box.add(row);
    this.__strength = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true });
    box.add(this.__strength);
    this.add(box);

    const split = new qx.ui.splitpane.Pane("vertical");
    const rulesBox = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
    const ruleBar = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
    ruleBar.add(new qx.ui.basic.Label("Kurallar").set({ font: "bold", alignY: "middle" }));
    const add = new qx.ui.form.Button("Yeni kural").set({ enabled: canEdit });
    add.addListener("execute", () => this.__edit(null));
    this.__editBtn = new qx.ui.form.Button("Düzenle").set({ enabled: false });
    this.__editBtn.addListener("execute", () => this.__edit(this.__selectedRule()));
    this.__delBtn = new qx.ui.form.Button("Sil").set({ enabled: false });
    this.__delBtn.addListener("execute", () => this.__deleteRule(this.__selectedRule()));
    [add, this.__editBtn, this.__delBtn].forEach(b => ruleBar.add(b));
    rulesBox.add(ruleBar);
    this.__ruleTable = page._createTable([
      { id: "name", label: "Kural", width: 180 },
      { id: "boards", label: "Bilgisayarlar", width: 200 },
      { id: "kinds", label: "Anomali türleri" },
      { id: "mode", label: "Gönderim", width: 130 },
      { id: "interval", label: "Sıklık / sınır", width: 190 },
      { id: "max", label: "Saatte en çok", width: 100 },
      { id: "on", label: "Durum", width: 70 }
    ], { prefsKey: "ntfy.rules.columns" });
    this.__ruleTable.getSelectionModel().addListener("changeSelection", () => {
      const has = !!this.__selectedRule() && canEdit;
      this.__editBtn.setEnabled(has);
      this.__delBtn.setEnabled(has);
    });
    rulesBox.add(this.__ruleTable, { flex: 1 });

    const msgBox = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({ paddingTop: 6 });
    const msgBar = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
    msgBar.add(new qx.ui.basic.Label("Gönderilen bildirimler").set({ font: "bold", alignY: "middle" }));
    this.__delMsg = new qx.ui.form.Button("Seçilenleri sil").set({ enabled: false });
    this.__delMsg.addListener("execute", () => this.__deleteMessages(false));
    const delAll = new qx.ui.form.Button("Tümünü sil").set({ enabled: canEdit });
    delAll.addListener("execute", () => this.__deleteMessages(true));
    msgBar.add(this.__delMsg);
    msgBar.add(delAll);
    msgBox.add(msgBar);
    this.__msgTable = page._createTable([
      { id: "time", label: "Zaman", width: 150 },
      { id: "rule", label: "Kural", width: 160 },
      { id: "title", label: "Başlık", width: 240 },
      { id: "body", label: "Metin" },
      { id: "status", label: "Durum", width: 150 }
    ], { prefsKey: "ntfy.messages.columns" });
    this.__msgTable.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
    this.__msgTable.getSelectionModel().addListener("changeSelection", () =>
      this.__delMsg.setEnabled(canEdit && !this.__msgTable.getSelectionModel().isSelectionEmpty()));
    msgBox.add(this.__msgTable, { flex: 1 });
    split.add(rulesBox, 1);
    split.add(msgBox, 1);
    this.add(split, { flex: 1 });
    this.addListener("appear", () => this.load());
  },

  statics: {
    MODES: {
      live: ["Anomali başlayınca", "Her yeni anomali için hemen bir bildirim gönderilir. Tekrar sınırı, aynı bilgisayar ve türde ne kadar sık bildirim gidebileceğidir.", "Tekrar sınırı:"],
      summary: ["Düzenli özet", "Anomaliler tek tek gönderilmez; seçilen aralıkta süren anomaliler bilgisayar ve tür başına sayılarak tek bildirimde gönderilir.", "Özet sıklığı:"]
    },

    /** "15 dakikada bir", "1 saatte bir", "1 günde bir": ek, birime göre. */
    every(n) {
      if (n < 60) {
        return `${n} dakikada bir`;
      }
      return n < 1440 ? `${n / 60} saatte bir` : `${n / 1440} günde bir`;
    },

    intervalText(mode, n) {
      if (mode === "live") {
        return n ? `Aynı bilgisayar + tür: ${this.every(n)}` : "Tekrar sınırı yok";
      }
      return this.every(n);
    },

    /** Türkçe harfler sadeleşir, yalnız a-z0-9, kelimeler - ile (baş harfler ve kodun sonu buradan alınır). */
    slug(text) {
      const map = { "İ": "i", "I": "i", "ı": "i", "Ç": "c", "ç": "c", "Ğ": "g", "ğ": "g", "Ö": "o", "ö": "o", "Ş": "s", "ş": "s", "Ü": "u", "ü": "u" };
      return String(text || "").replace(/[İIıÇçĞğÖöŞşÜü]/g, c => map[c]).normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    },

    /** Karıştırılan harfler (l, 1, o, 0) yok: telefona elle yazılabilsin. */
    randomSuffix(length = 2) {
      const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
      const bytes = new Uint8Array(length);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
    }
  },

  members: {
    __page: null,
    __server: null,
    __topic: null,
    __strength: null,
    __ruleTable: null,
    __msgTable: null,
    __editBtn: null,
    __delBtn: null,
    __delMsg: null,
    __data: null,
    __boards: null,

    async load() {
      try {
        const [data, boards] = await Promise.all([ankamon.io.Api.get("/ntfy"), ankamon.io.Api.get("/boards")]);
        if (this.isDisposed()) {
          return;
        }
        this.__data = data;
        this.__boards = boards.boards;
        if (!this.__topic.getValue()) {
          this.__server.setValue(data.config.server || "https://ntfy.sh");
          this.__topic.setValue(data.config.topic || "");
        }
        this.__render();
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    __boardName(id) {
      const b = (this.__boards || []).find(x => x.id === id);
      return b ? b.label || b.hostname || b.ip : "#" + id;
    },

    __render() {
      const N = ankamon.ui.anomaly.Notifications;
      const F = ankamon.util.Format;
      const d = this.__data;
      this.__ruleTable.getTableModel().setData(d.rules.map(r => [
        r.id, r.name,
        r.board_ids.length ? r.board_ids.map(id => this.__boardName(id)).join(", ") : "Tümü",
        r.kinds.length ? r.kinds.map(k => (d.kinds[k] || {}).label || k).join(", ") : "Tümü",
        N.MODES[r.mode][0], N.intervalText(r.mode, r.interval_minutes), r.max_per_hour, r.enabled ? "Açık" : "Kapalı"
      ]));
      this.__msgTable.getTableModel().setData(d.messages.map(m => [
        m.id, F.dateTime(m.sent_at * 1000), m.rule_name, m.title, m.body.replace(/\n/g, " · "),
        m.status === "ok" ? "Gönderildi" : "Hata: " + (m.error || "")
      ]));
      this.__showStrength();
    },

    __showStrength() {
      const t = (this.__topic.getValue() || "").trim();
      if (!t) {
        this.__strength.setValue('<span style="color:#b06000">Konu seçilmedi: kural olsa da bildirim gönderilmez.</span>');
      } else if (!/^[A-Za-z0-9_-]{1,64}$/.test(t)) {
        this.__strength.setValue('<span style="color:#c42b1c">Yalnız harf, rakam, - ve _ kullanılabilir (en çok 64 karakter).</span>');
      } else if (t.length < 16) {
        this.__strength.setValue(`<span style="color:#b06000">Telefonda ntfy ▸ + ▸ konu adı: <b>${qx.bom.String.escape(t)}</b> — kısa konu tahmin edilebilir; genel sunucuda bildirimleri başkası da okuyabilir. Sonuna ekleme yaparak uzatabilirsiniz.</span>`);
      } else {
        this.__strength.setValue(`<span style="color:#2fa84a">Telefonda ntfy ▸ + ▸ konu adı: <b>${qx.bom.String.escape(t)}</b></span>`);
      }
    },

    /** Kuruluş sayfa açıkken Ayarlar'dan kaydedilmiş olabilir: yüklenmiş kopya değil, sunucudaki güncel değer okunur. */
    async __suggest() {
      const N = ankamon.ui.anomaly.Notifications;
      let org = (this.__data && this.__data.organization) || {};
      try {
        const fresh = await ankamon.io.Api.get("/ntfy");
        if (this.isDisposed()) {
          return;
        }
        this.__data = fresh;
        org = fresh.organization || {};
      } catch (e) {
        // Okunamazsa eldeki değerle sürülür: öneri yine üretilir.
      }
      const initials = N.slug(org.name).split("-").filter(Boolean).map(word => word[0]).join("");
      const prefix = initials + N.slug(org.code).replace(/-/g, "").slice(-3);
      if (!prefix) {
        ankamon.ui.Dialog.alert("Ayarlar ▸ Kuruluş'ta ad ve kod tanımlı değil; \"ankamon\" ve rastgele 2 karakter önerildi. Tanımlarsanız konu kuruluşunuzdan türetilir.");
      }
      this.__topic.setValue((prefix || "ankamon").slice(0, 62) + N.randomSuffix());
    },

    async __saveConfig() {
      try {
        await ankamon.io.Api.put("/ntfy/config", { server: this.__server.getValue(), topic: (this.__topic.getValue() || "").trim() });
        ankamon.ui.Dialog.alert("Konu kaydedildi. Telefondaki ntfy uygulamasından bu konuya abone olun, sonra <b>Deneme gönder</b>.");
        this.load();
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async __test() {
      try {
        await ankamon.io.Api.put("/ntfy/config", { server: this.__server.getValue(), topic: (this.__topic.getValue() || "").trim() });
        const id = (await ankamon.io.Api.post("/jobs", { type: "ntfy_test" })).id;
        for (let i = 0; i < 40; i++) {
          const job = (await ankamon.io.Api.get(`/jobs/${id}`)).job;
          if (!["queued", "running"].includes(job.status)) {
            ankamon.ui.Dialog.alert(job.status === "failed" ? "Gönderilemedi: " + qx.bom.String.escape(job.summary || "") : "Deneme bildirimi gönderildi.");
            break;
          }
          await new Promise(r => setTimeout(r, 500));
        }
        this.load();
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    __selectedRule() {
      const sm = this.__ruleTable.getSelectionModel();
      if (sm.isSelectionEmpty() || !this.__data) {
        return null;
      }
      const id = this.__ruleTable.getTableModel().getValue(0, sm.getSelectedRanges()[0].minIndex);
      return this.__data.rules.find(r => r.id === id) || null;
    },

    __edit(rule) {
      const N = ankamon.ui.anomaly.Notifications;
      const d = this.__data;
      const win = ankamon.ui.Dialog.window(rule ? `Kural — ${rule.name}` : "Yeni bildirim kuralı", 820);
      const top = new qx.ui.container.Composite(new qx.ui.layout.Grid(10, 8));
      top.getLayout().setColumnFlex(1, 1);
      const name = new qx.ui.form.TextField(rule ? rule.name : "");
      const mode = new qx.ui.form.SelectBox();
      Object.entries(N.MODES).forEach(([key, [label]]) => mode.add(new qx.ui.form.ListItem(label, null, key)));
      const interval = new qx.ui.form.SelectBox();
      const max = new qx.ui.form.Spinner(1, rule ? rule.max_per_hour : 20, 600);
      const enabled = new qx.ui.form.CheckBox("Kural açık").set({ value: rule ? rule.enabled : true });
      const intervalLabel = new qx.ui.basic.Label("").set({ alignY: "middle" });
      [["Kural adı:", name], ["Ne zaman gönderilsin:", mode], [intervalLabel, interval], ["Saatte en çok:", max]].forEach(([text, widget], i) => {
        top.add(text instanceof qx.ui.basic.Label ? text : new qx.ui.basic.Label(text).set({ alignY: "middle" }), { row: i, column: 0 });
        top.add(widget, { row: i, column: 1 });
      });
      top.add(enabled, { row: 4, column: 1 });
      win.add(top);
      const hint = new qx.ui.basic.Label("").set({ rich: true, wrap: true, textColor: "app-muted", allowGrowX: true });
      win.add(hint);
      const fillIntervals = keep => {
        const key = mode.getSelection()[0].getModel();
        hint.setValue(qx.bom.String.escape(N.MODES[key][1]));
        intervalLabel.setValue(N.MODES[key][2]);
        interval.removeAll().forEach(i => i.dispose());
        d.intervals[key].forEach(n => interval.add(new qx.ui.form.ListItem(N.intervalText(key, n), null, n)));
        const hit = interval.getSelectables(true).find(i => i.getModel() === keep);
        interval.setSelection([hit || interval.getSelectables(true)[Math.min(1, d.intervals[key].length - 1)]]);
      };
      const lists = new qx.ui.container.Composite(new qx.ui.layout.HBox(10)).set({ height: 300 });
      const left = ankamon.ui.StepBox.create(1, "Bilgisayarlar", "hiçbiri işaretli değilse tümü");
      const boardList = new ankamon.ui.homebackup.CheckColumn();
      left.add(boardList, { flex: 1 });
      const right = ankamon.ui.StepBox.create(2, "Anomali türleri", "hiçbiri işaretli değilse tümü");
      const kindList = new ankamon.ui.homebackup.CheckColumn();
      right.add(kindList, { flex: 1 });
      lists.add(left, { flex: 1 });
      lists.add(right, { flex: 1 });
      win.add(lists, { flex: 1 });
      boardList.setItems(this.__boards.map(b => ({
        value: b.id, label: b.label || b.hostname || b.ip || "#" + b.id, checked: !!rule && rule.board_ids.includes(b.id)
      })), "Kayıtlı bilgisayar yok.");
      kindList.setItems(Object.entries(d.kinds).map(([key, k]) => ({ value: key, label: k.label, checked: !!rule && rule.kinds.includes(key) })), "Tür yok.");
      if (rule) {
        mode.setSelection([mode.getSelectables(true).find(i => i.getModel() === rule.mode)]);
      }
      fillIntervals(rule ? rule.interval_minutes : null);
      mode.addListener("changeSelection", () => fillIntervals(null));
      const ok = new qx.ui.form.Button("Kaydet");
      ok.addListener("execute", async () => {
        const body = {
          name: name.getValue() || "", mode: mode.getSelection()[0].getModel(), interval_minutes: interval.getSelection()[0].getModel(),
          max_per_hour: max.getValue(), enabled: enabled.getValue(), board_ids: boardList.getChecked(), kinds: kindList.getChecked()
        };
        try {
          await (rule ? ankamon.io.Api.put(`/ntfy/rules/${rule.id}`, body) : ankamon.io.Api.post("/ntfy/rules", body));
          win.close();
          this.load();
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
      });
      ankamon.ui.Dialog.buttons(win, [ok]);
      win.open();
    },

    async __deleteRule(rule) {
      if (rule && await ankamon.ui.Dialog.confirm(`<b>${qx.bom.String.escape(rule.name)}</b> kuralı silinsin mi?`, "Sil")) {
        try {
          await ankamon.io.Api.del(`/ntfy/rules/${rule.id}`);
          this.load();
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
      }
    },

    async __deleteMessages(all) {
      const tm = this.__msgTable.getTableModel();
      const ids = [];
      if (!all) {
        this.__msgTable.getSelectionModel().iterateSelection(i => ids.push(tm.getValue(0, i)));
      }
      const what = all ? "Gönderilen bütün bildirim kayıtları" : `${ids.length} bildirim kaydı`;
      if (!(all || ids.length) || !await ankamon.ui.Dialog.confirm(`${what} silinsin mi? (Telefona ulaşmış bildirimler etkilenmez.)`, "Sil")) {
        return;
      }
      try {
        await ankamon.io.Api.del("/ntfy/messages?" + (all ? "all=1" : "ids=" + ids.join(",")));
        this.load();
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    }
  }
});
