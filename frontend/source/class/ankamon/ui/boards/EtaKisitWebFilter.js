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
 * Sağ menü Yönet ▸ "Web filtresi": ETAP Pardus'taki eta-kisit uygulamasıyla kara/beyaz liste ve adres başına DNS sayıları
 * (bkz. worker executor/eta_kisit_webfilter.py). Çoklu seçimde liste ilk uygun tahtadan yüklenir, sayılar toplanır, uygulama bütün
 * uygun tahtalara gider. ETAP dışı ya da eta-kisit'siz tahta atlanır, nedeni pencerede yazar.
 */
qx.Class.define("ankamon.ui.boards.EtaKisitWebFilter", {
  type: "static",

  statics: {
    // JobsApi::webFilterJob ve worker DOMAIN_RE ile AYNI kural.
    DOMAIN_RE: /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/,
    MAX_DOMAINS: 500,
    MODE_LABEL: { none: "Kapalı", off: "Kapalı", denylist: "Kara liste", allowlist: "Beyaz liste" },
    UNSUPPORTED: {
      not_etap: "ETAP Pardus değil, Web Filtre uygulanmaz.",
      no_eta_kisit: "eta-kisit kurulu değil, Web Filtre uygulanmaz."
    },
    COUNT_NOTE: "Sayılar tahtanın DNS sorgularıdır, sayfa ziyareti değil: tek sayfa birkaç sorgu üretir, tarayıcı önbelleği sorguyu " +
      "azaltır, Chrome kara listedeki adresi kendisi de keser. Alt alan adları dahildir. Kayıtlar onar onar yazılır: son birkaç sorgu " +
      "henüz görünmeyebilir. Tahtada son 8 MB kayıt tutulur; filtre kapatılınca silinir.",
    LIST_NOTE: "ntp.org, eba.gov.tr ve etap.org.tr hep açıktır: kara listede etkisiz, beyaz listeye kendiliğinden eklenir. Beyaz " +
      "listede youtubekids.com ve turkiye.gov.tr gereken alan adlarını da açar. Filtre açıkken eta-kisit DNS olarak sabit " +
      "195.175.37.137/138 kullanır.",

    /**
     * Girilen adresi alan adına indirir: düzen, yol, kapı ve baştaki www. atılır (alt alan adları zaten kapsanır).
     * @return {String|null} geçersizse null
     */
    normalizeDomain(raw) {
      let text = String(raw || "").trim().toLowerCase().replace(/^\*\./, "");
      if (!text) {
        return null;
      }
      try {
        text = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : "https://" + text).hostname;
      } catch (e) {
        return null;
      }
      text = text.replace(/\.$/, "").replace(/^www\./, "");
      return this.DOMAIN_RE.test(text) ? text : null;
    },

    /** Görevi başlatır, bütün hedefler bitene dek bekler. @return {Array} job_targets */
    async __runJob(body) {
      const id = (await ankamon.io.Api.post("/jobs", body)).id;
      for (let i = 0; i < 400; i++) {
        const res = await ankamon.io.Api.get(`/jobs/${id}`);
        const targets = (res.job && res.job.targets) || [];
        if (targets.length && !targets.some(t => ["queued", "running"].includes(t.status))) {
          return targets;
        }
        await new Promise(r => setTimeout(r, 600));
      }
      throw new Error("Tahtalardan yanıt alınamadı (zaman aşımı).");
    },

    /** "Web filtresini kapat": pencere açmadan, onayla (listeler tahtada saklı kalır). */
    async turnOff(boards) {
      const ok = await ankamon.ui.Dialog.confirm(
        `<b>${boards.length} bilgisayarda</b> Web Filtre kapatılsın mı?<br>Sayım kayıtları silinir, adres listeleri eta-kisit profilinde kalır. ` +
        "ETAP dışı ya da eta-kisit'siz tahtada işlem yapılmaz.", "Kapat");
      if (ok) {
        ankamon.ui.Jobs.show(
          ankamon.io.Api.post("/jobs", { type: "webfilter_apply", mode: "off", board_ids: boards.map(b => b.id) }).then(res => res.id),
          "Web Filtre — kapat");
      }
    },

    /**
     * @param online {Array} uygulanacak (çevrim içi) tahtalar
     * @param selected {Array} sağ menünün uygulandığı bütün tahtalar (çevrim dışı olanlar pencerede yazılır)
     * @param mode {String?} açılışta seçili mod ("denylist", "allowlist"); verilmezse tahtadaki mod
     */
    open(online, selected, mode) {
      const esc = qx.bom.String.escape;
      const name = b => b.label || b.hostname || b.ip || "#" + b.id;
      const title = online.length === 1 ? name(online[0]) : `${online.length} bilgisayar`;
      const win = ankamon.ui.Dialog.window(`Web Filtre — ${title}`, 780, { maximizable: true });
      win.setHeight(680);

      const boardStates = new qx.ui.basic.Label(ankamon.ui.JobSpinner.label("Tahtalar okunuyor…")).set({ rich: true, wrap: true, selectable: true, allowGrowX: true });
      win.add(boardStates);

      const modeRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(16));
      const modeButtons = {};
      Object.entries({ off: "Kapalı", denylist: "Kara liste (bu adresler engellenir)", allowlist: "Beyaz liste (yalnız bu adresler açık)" }).forEach(([key, label]) => {
        modeButtons[key] = new qx.ui.form.RadioButton(label);
        modeRow.add(modeButtons[key]);
      });
      const modeGroup = new qx.ui.form.RadioGroup(modeButtons.off, modeButtons.denylist, modeButtons.allowlist);
      win.add(modeRow);

      const addRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(8));
      const field = new qx.ui.form.TextField().set({ placeholder: "Adres ya da alan adı, ör. https://ornek.com/sayfa (birkaç adres boşlukla ayrılabilir)" });
      const addBtn = new qx.ui.form.Button("Ekle");
      const delBtn = new qx.ui.form.Button("Seçileni sil").set({ enabled: false });
      addRow.add(field, { flex: 1 });
      addRow.add(addBtn);
      addRow.add(delBtn);
      win.add(addRow);

      const model = new qx.ui.table.model.Simple();
      model.setColumns(["Adres", "Ziyaret", "Engellendi"]);
      const table = new qx.ui.table.Table(model, {
        tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj)
      }).set({ statusBarVisible: false, minHeight: 170 });
      const behavior = table.getTableColumnModel().getBehavior();
      behavior.setWidth(0, "1*");
      behavior.setWidth(1, 90);
      behavior.setWidth(2, 90);
      table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
      win.add(table, { flex: 1 });

      const small = text => new qx.ui.basic.Label(text).set({ rich: true, wrap: true, allowGrowX: true, font: "small", opacity: 0.8 });
      const other = small("").set({ visibility: "excluded", selectable: true });
      win.add(other);
      win.add(small(esc(this.COUNT_NOTE)));
      win.add(small(esc(this.LIST_NOTE)));

      const refreshBtn = new qx.ui.form.Button("Yenile");
      const applyBtn = new qx.ui.form.Button("Uygula").set({ enabled: false });
      const closeBtn = new qx.ui.form.Button("Kapat");
      closeBtn.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [refreshBtn, applyBtn, closeBtn]);

      let closed = false;
      win.addListener("close", () => {
        closed = true;
      });
      const lists = { denylist: [], allowlist: [] };
      let counts = {};
      let usable = [];   // eta-kisit'i olan tahtalar
      let wanted = mode || null; // kullanıcının seçtiği mod; yenileme bunu ezmez
      let setting = false;

      const currentMode = () => Object.keys(modeButtons).find(key => modeGroup.getSelection()[0] === modeButtons[key]);
      const renderTable = () => {
        const list = lists[currentMode()] || [];
        model.setData(list.map(domain => {
          const c = counts[domain] || {};
          return [domain, c.visits || 0, c.blocked || 0];
        }));
        table.getSelectionModel().resetSelection();
        const on = currentMode() !== "off";
        field.setEnabled(on);
        addBtn.setEnabled(on);
      };
      const selectMode = key => {
        setting = true;
        modeGroup.setSelection([modeButtons[key]]);
        setting = false;
        renderTable();
      };
      modeGroup.addListener("changeSelection", () => {
        if (!setting) {
          wanted = currentMode();
          renderTable();
        }
      });
      table.getSelectionModel().addListener("changeSelection", () => {
        delBtn.setEnabled(!table.getSelectionModel().isSelectionEmpty());
      });

      const addDomains = () => {
        const list = lists[currentMode()];
        if (!list) {
          return;
        }
        const bad = [];
        (field.getValue() || "").split(/[\s,;]+/).filter(Boolean).forEach(item => {
          const domain = this.normalizeDomain(item);
          if (!domain) {
            bad.push(item);
          } else if (!list.includes(domain)) {
            list.push(domain);
          }
        });
        if (list.length > this.MAX_DOMAINS) {
          list.length = this.MAX_DOMAINS;
          ankamon.ui.Dialog.alert(`Listede en çok ${this.MAX_DOMAINS} adres olabilir.`);
        }
        field.setValue(bad.join(" "));
        if (bad.length) {
          ankamon.ui.Dialog.alert("Geçersiz adres: " + esc(bad.join(", ")));
        }
        renderTable();
      };
      addBtn.addListener("execute", addDomains);
      field.addListener("keypress", e => {
        if (e.getKeyIdentifier() === "Enter") {
          addDomains();
        }
      });
      delBtn.addListener("execute", () => {
        const remove = [];
        table.getSelectionModel().iterateSelection(row => remove.push(model.getValue(0, row)));
        const key = currentMode();
        lists[key] = lists[key].filter(domain => !remove.includes(domain));
        renderTable();
      });

      const offlineLines = () => selected.filter(b => !b.online).map(b => `<b>${esc(name(b))}</b>: çevrim dışı, atlandı.`);
      const describe = d => {
        if (d.reason) {
          return this.UNSUPPORTED[d.reason] || d.reason;
        }
        const parts = [`${this.MODE_LABEL[d.mode] || d.mode}`];
        if (d.mode !== "none") {
          parts.push(d.active ? "devrede" : d.ogrenci
            ? `beklemede, ogrenci oturumu açılınca devreye girer${d.session ? ` (şu an ${esc(d.session)} oturumu)` : ""}` : "devrede değil");
          parts.push(d.ogrenci ? "yalnız ogrenci oturumunda geçerli, başka hesap girişinde eta-kisit kaldırır" : "ogrenci hesabı yok, bütün oturumlarda geçerli");
        }
        if (d.locked) {
          parts.push("profil merkezden yönetiliyor, değiştirilemez");
        }
        return parts.join(", ") + ".";
      };
      const failText = t => t.status === "unreachable" ? "ulaşılamadı." : `okunamadı: ${esc(t.output || "")}`;

      const setBusy = busy => {
        refreshBtn.setEnabled(!busy);
        addRow.setEnabled(!busy);
        applyBtn.setEnabled(!busy && usable.length > 0);
        applyBtn.setLabel(usable.length > 1 ? `Uygula (${usable.length} bilgisayar)` : "Uygula");
      };

      const load = async notes => {
        setBusy(true);
        let targets;
        try {
          targets = await this.__runJob({ type: "webfilter_status", board_ids: online.map(b => b.id) });
        } catch (e) {
          if (!closed) {
            boardStates.setValue(`<span style="color:#c5221f">${esc(e.message || String(e))}</span>`);
            setBusy(false);
          }
          return;
        }
        if (closed) {
          return;
        }
        const results = targets.map(t => {
          let data = null;
          if (t.status === "ok") {
            try {
              data = JSON.parse(t.output || "null");
            } catch (e) {
              data = null;
            }
          }
          return { t, data };
        });
        const ready = results.filter(r => r.data && !r.data.reason);
        usable = ready.map(r => r.t.board_id);
        counts = {};
        const blockedOther = {};
        ready.forEach(({ data }) => {
          Object.entries(data.counts || {}).forEach(([domain, c]) => {
            const sum = counts[domain] || (counts[domain] = { visits: 0, blocked: 0 });
            sum.visits += c.visits;
            sum.blocked += c.blocked;
          });
          (data.other_blocked || []).forEach(o => {
            blockedOther[o.domain] = (blockedOther[o.domain] || 0) + o.blocked;
          });
        });
        if (ready.length) {
          const first = ready[0].data;
          lists.denylist = [...first.denylist];
          lists.allowlist = [...first.allowlist];
          const signature = d => JSON.stringify([d.mode, [...d.denylist].sort(), [...d.allowlist].sort()]);
          const differ = ready.some(r => signature(r.data) !== signature(first));
          const lines = results.map(({ t, data }) => `<b>${esc(t.board)}</b>: ${data ? describe(data) : failText(t)}`).concat(offlineLines());
          if (differ) {
            lines.unshift(`<span style="color:#e37400">Tahtalardaki mod ya da listeler farklı: gösterilen ${esc(ready[0].t.board)} tahtasınınki, sayılar toplam. Uygula hepsine bunu yazar.</span>`);
          }
          boardStates.setValue((notes ? notes.concat(lines) : lines).join("<br>"));
          const key = wanted || (first.mode === "none" ? "off" : first.mode);
          selectMode(modeButtons[key] ? key : "off");
        } else {
          const lines = results.map(({ t, data }) => `<b>${esc(t.board)}</b>: ${data ? describe(data) : failText(t)}`).concat(offlineLines());
          boardStates.setValue((notes ? notes.concat(lines) : lines).join("<br>"));
          selectMode(wanted && modeButtons[wanted] ? wanted : "off");
        }
        const top = Object.entries(blockedOther).sort((a, b) => b[1] - a[1]).slice(0, 15);
        other.setVisibility(top.length ? "visible" : "excluded");
        other.setValue("Liste dışı engellenen: " + top.map(([domain, n]) => `${esc(domain)} (${n})`).join(", "));
        setBusy(false);
      };

      refreshBtn.addListener("execute", () => load());
      applyBtn.addListener("execute", async () => {
        const key = currentMode();
        if (key !== "off" && !lists[key].length) {
          ankamon.ui.Dialog.alert("Liste boş: önce adres ekleyin ya da Kapalı seçin.");
          return;
        }
        const warning = key === "off"
          ? "Sayım kayıtları silinir."
          : "Etkinleştirme ogrenci oturumundaki tarayıcıları kapatır, liste değişikliği NetworkManager'ı yeniden başlatır (birkaç saniye DNS kesilir)." +
            (key === "allowlist" ? " Beyaz listede listelenmeyen bütün alan adları kapanır." : "");
        const ok = await ankamon.ui.Dialog.confirm(
          `<b>${usable.length} bilgisayara</b> uygulansın mı: <b>${this.MODE_LABEL[key]}</b>` +
          (key === "off" ? "" : `, ${lists[key].length} adres`) + `.<br>${warning}`, "Uygula");
        if (!ok || closed) {
          return;
        }
        setBusy(true);
        boardStates.setValue(ankamon.ui.JobSpinner.label("Uygulanıyor…"));
        try {
          const targets = await this.__runJob({
            type: "webfilter_apply", mode: key, denylist: lists.denylist, allowlist: lists.allowlist, board_ids: usable
          });
          if (!closed) {
            wanted = key;
            await load(targets.filter(t => t.status !== "ok").map(t =>
              `<span style="color:#c5221f"><b>${esc(t.board)}</b>: uygulanamadı: ${esc(t.output || t.status)}</span>`));
          }
        } catch (e) {
          if (!closed) {
            setBusy(false);
            ankamon.ui.Dialog.error(e);
          }
        }
      });

      selectMode(mode && modeButtons[mode] ? mode : "off");
      win.open();
      load();
    }
  }
});
