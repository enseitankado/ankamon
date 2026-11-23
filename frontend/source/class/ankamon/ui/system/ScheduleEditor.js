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
 * Zamanlanmış görev ekleme/düzenleme penceresi (Sistem ▸ Zamanlanmış görevler ▸ Görevler; kullanıcı isteği 2026-11-13).
 * Bölümler: ad · görev (tür + türe göre ayarlar: hazır işlem ve alanları, serbest komut (Linux/Windows/macOS), anomali
 * türleri) · hedef (seçili cihazlar — aranabilir onay kutulu liste — ya da çalışma anında çevrimiçi tüm cihazlar) ·
 * zaman (bir kez / seçili günlerde saatinde / aralıkla). Kaydederken sunucu görevi elle başlatılanla AYNI kurallarla
 * doğrular (SchedulesApi → JobsApi::spec). Parola isteyen hazır işlemler zamanlanamaz (gizli değer saklanmaz).
 * Hazır işlem seçicisinde Komut çalıştır'daki bütün hazır komutlar ve eklentilerin hazır komutları (ör. TiHA adımları —
 * ankamon.ext.Extensions.addReadyCommandSource "schedule") görünür (kullanıcı isteği 2026-11-23); zamanlanamayanlar
 * (kendi penceresi olan, parola isteyen) gerekçesiyle soluk.
 */
qx.Class.define("ankamon.ui.system.ScheduleEditor", {
  type: "static",

  statics: {
    DAYS: ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"],

    /** Türlerin pencerede gösterilen açıklaması (ayar istemeyen türler için). */
    HINTS: {
      diagnose: "Haftalık otomatik SSH denetiminin aynısı: sonuç Sağlık ▸ Denetle (SSH denetim raporları) ve Sağlık ▸ Durum'a yansır. Kapalı cihazlar denetlenemez.",
      anomaly_scan: "Seçilen sürekli izleme denetimlerinin cihazda anlık yoklaması: sonuç Sağlık ▸ Denetle'ye yansır.",
      wol: "Kapalı cihazları Wake-on-LAN ile açar (cihazın BIOS'unda WoL açık olmalı).",
      wake: "Güç tasarrufuna girmiş (kararmış) ekranı uyandırır.",
      sleep: "Ekranı DPMS ile kapatır; dokunulunca açılır.",
      logout: "Cihazda açık kullanıcı oturumunu kapatır.",
      screen_lock: "Cihaz ekranını 'Kilidi aç'a dek kilitler (klavye/fare/dokunmatik yakalanır).",
      screen_unlock: "Ekran kilidini açar."
    },

    /**
     * @param schedule {Map|null} düzenlenecek zamanlama (null: yeni)
     * @param types {Map} tür → ad (SchedulesApi::TYPES)
     * @param onSaved {Function} kaydedildikten sonra
     */
    async open(schedule, types, onSaved) {
      let loaded;
      try {
        loaded = await Promise.all([
          ankamon.io.Api.get("/actions").then(r => r.actions),
          ankamon.io.Api.get("/devices").then(r => r.devices),
          ankamon.io.Api.get("/anomalies", { limit: 1 }).then(r => r.kinds || {}),
          ankamon.ext.Extensions.readyCommands().catch(() => [])
        ]);
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      const actions = loaded[0];
      const devices = loaded[1];
      const kinds = loaded[2];
      const extEntries = loaded[3];
      const esc = qx.bom.String.escape;
      const s = schedule || {};
      const req = s.job_request || {};
      const root = qx.core.Init.getApplication().getRoot().getBounds() || { height: 800 };
      const win = ankamon.ui.Dialog.window(schedule ? `Zamanlanmış görev — ${s.name}` : "Yeni zamanlanmış görev", 720,
        { maximizable: true });
      win.set({ contentPadding: 10, height: Math.min(760, root.height - 40) });
      win.getLayout().setSpacing(6);
      const scroll = new qx.ui.container.Scroll();
      const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({ paddingRight: 8 });
      scroll.add(body);
      win.add(scroll, { flex: 1 });
      const section = text => body.add(new qx.ui.basic.Label(`<b>${esc(text)}</b>`).set({ rich: true, marginTop: 4 }));
      const row = (label, widget) => {
        const r = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
        r.add(new qx.ui.basic.Label(label).set({ width: 110 }));
        r.add(widget, { flex: 1 });
        body.add(r);
        return r;
      };

      // --- Ad ve görev --------------------------------------------------------------------------------------------
      const name = new qx.ui.form.TextField(s.name || "").set({ placeholder: "ör. Her akşam tahtaları kapat", maxLength: 120 });
      row("Görev adı", name);
      const typeBox = new qx.ui.form.SelectBox();
      Object.entries(types).forEach(([key, label]) => {
        const item = new qx.ui.form.ListItem(label, null, key);
        typeBox.add(item);
        if (key === (s.job_type || "action")) {
          typeBox.setSelection([item]);
        }
      });
      row("Görev türü", typeBox);
      const typeBody = new qx.ui.container.Composite(new qx.ui.layout.VBox(4)).set({ marginLeft: 118 });
      body.add(typeBody);

      let current = null; // {values(): job isteği gövdesi | null (eksik) }
      const drawType = () => {
        typeBody.removeAll().forEach(w => w.dispose());
        const type = typeBox.getSelection()[0].getModel();
        const same = type === req.type;
        if (type === "action") {
          current = this.__actionBody(typeBody, actions, same ? req : null, extEntries);
        } else if (type === "command") {
          current = this.__commandBody(typeBody, same ? req : null);
        } else if (type === "anomaly_scan") {
          current = this.__kindsBody(typeBody, kinds, same ? req : null);
        } else {
          typeBody.add(new qx.ui.basic.Label(esc(this.HINTS[type] || "")).set({ rich: true, wrap: true, textColor: "app-muted" }));
          current = { values: () => ({ type }) };
        }
      };
      typeBox.addListener("changeSelection", drawType);
      drawType();

      // --- Hedef --------------------------------------------------------------------------------------------------
      section("Hedef");
      const targetAll = new qx.ui.form.RadioButton("Çalışma anında çevrimiçi olan bütün cihazlar");
      const targetSel = new qx.ui.form.RadioButton("Seçili cihazlar");
      new qx.ui.form.RadioGroup(targetSel, targetAll);
      (s.target_mode === "all_online" ? targetAll : targetSel).setValue(true);
      body.add(targetSel);
      const picker = this.__devicePicker(devices, new Set(s.device_ids || []));
      picker.box.set({ marginLeft: 22 });
      body.add(picker.box);
      body.add(targetAll);
      const syncTarget = () => picker.box.setEnabled(targetSel.getValue());
      targetSel.addListener("changeValue", syncTarget);
      syncTarget();

      // --- Zaman --------------------------------------------------------------------------------------------------
      section("Zaman");
      const repeatBox = new qx.ui.form.SelectBox();
      [["weekly", "Seçili günlerde, belirli saatte"], ["once", "Bir kez"], ["interval", "Belirli aralıkla"]].forEach(([key, label]) => {
        const item = new qx.ui.form.ListItem(label, null, key);
        repeatBox.add(item);
        if (key === (s.repeat || "weekly")) {
          repeatBox.setSelection([item]);
        }
      });
      row("Yineleme", repeatBox);
      const when = new qx.ui.container.Composite(new qx.ui.layout.VBox(4)).set({ marginLeft: 118 });
      body.add(when);

      const pad = n => String(n).padStart(2, "0");
      const runAt = s.run_at ? new Date(s.run_at * 1000) : null;
      // Bir kez / aralık başlangıcı: tarih + saat.
      const date = new qx.ui.form.DateField().set({ value: runAt || new Date(), width: 140,
        dateFormat: new qx.util.format.DateFormat("dd.MM.yyyy") });
      const timeText = (d, fallback) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : fallback);
      const onceTime = new qx.ui.form.TextField(timeText(runAt, "17:00")).set({ width: 70, placeholder: "SS:DD" });
      const dayTime = new qx.ui.form.TextField(s.time_of_day || "17:00").set({ width: 70, placeholder: "SS:DD" });
      const days = this.DAYS.map((label, i) => new qx.ui.form.CheckBox(label).set({
        value: (s.weekdays && s.weekdays.length ? s.weekdays : [1, 2, 3, 4, 5]).includes(i + 1) }));
      const minutes = s.interval_minutes || 60;
      const unitOf = m => (m % 1440 === 0 ? 1440 : m % 60 === 0 ? 60 : 1);
      const every = new qx.ui.form.Spinner(1, minutes / unitOf(minutes), 9999).set({ width: 80 });
      const unit = new qx.ui.form.SelectBox().set({ width: 90 });
      [[1, "dakika"], [60, "saat"], [1440, "gün"]].forEach(([m, label]) => {
        const item = new qx.ui.form.ListItem(label, null, m);
        unit.add(item);
        if (m === unitOf(minutes)) {
          unit.setSelection([item]);
        }
      });
      const line = (...widgets) => {
        const r = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
        widgets.forEach(w => r.add(typeof w === "string" ? new qx.ui.basic.Label(w) : w));
        return r;
      };
      const quick = (label, list) => {
        const b = new qx.ui.form.Button(label).set({ padding: [2, 8] });
        b.addListener("execute", () => days.forEach((c, i) => c.setValue(list.includes(i + 1))));
        return b;
      };
      const drawWhen = () => {
        when.removeAll(); // alanlar yeniden kullanılır (dispose edilmez)
        const repeat = repeatBox.getSelection()[0].getModel();
        if (repeat === "once") {
          when.add(line("Tarih", date, "Saat", onceTime));
        } else if (repeat === "weekly") {
          when.add(line("Saat", dayTime));
          when.add(line(...days));
          when.add(line(quick("Her gün", [1, 2, 3, 4, 5, 6, 7]), quick("Hafta içi", [1, 2, 3, 4, 5]), quick("Hafta sonu", [6, 7])));
        } else {
          when.add(line("Her", every, unit));
          when.add(line("İlk çalışma", date, "Saat", onceTime));
          when.add(new qx.ui.basic.Label("İlk çalışma geçmişte kalırsa sonraki çalışmalar ondan aralık adımlarıyla hesaplanır.")
            .set({ textColor: "app-muted", font: "small" }));
        }
      };
      repeatBox.addListener("changeSelection", drawWhen);
      drawWhen();

      const enabled = new qx.ui.form.CheckBox("Etkin (zamanı gelince çalışır)").set({ value: s.enabled !== false, marginTop: 6 });
      body.add(enabled);

      const save = new qx.ui.form.Button("Kaydet");
      save.getChildControl("label").setFont("bold");
      save.addListener("execute", async () => {
        const job = current && current.values();
        if (!job) {
          return; // gövde kendi uyarısını gösterdi
        }
        const repeat = repeatBox.getSelection()[0].getModel();
        const stamp = (d, t) => {
          const m = /^(\d{1,2}):(\d{2})$/.exec((t || "").trim());
          if (!d || !m) {
            return null;
          }
          const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(m[1]), Number(m[2]), 0);
          return Math.floor(x.getTime() / 1000);
        };
        const payload = {
          id: s.id || undefined, name: (name.getValue() || "").trim(), enabled: enabled.getValue(), job,
          target_mode: targetAll.getValue() ? "all_online" : "devices", device_ids: [...picker.chosen()], repeat
        };
        if (repeat === "once") {
          payload.run_at = stamp(date.getValue(), onceTime.getValue());
        } else if (repeat === "weekly") {
          payload.time_of_day = (dayTime.getValue() || "").trim().padStart(5, "0");
          payload.weekdays = days.map((c, i) => (c.getValue() ? i + 1 : 0)).filter(Boolean);
        } else {
          payload.interval_minutes = every.getValue() * unit.getSelection()[0].getModel();
          payload.run_at = stamp(date.getValue(), onceTime.getValue());
        }
        save.setEnabled(false);
        try {
          await ankamon.io.Api.post("/schedules", payload);
          win.setUserData("saved", true);
          win.close();
          onSaved && onSaved();
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        } finally {
          save.setEnabled(true);
        }
      });
      ankamon.ui.Dialog.buttons(win, [save]);
      win.setUserData("escDirty", () => false);
      win.open();
      name.focus();
    },

    /**
     * Hazır işlem seçici + işlemin alanları. Eklentilerin hazır komutları ({extEntry}) listenin sonunda; zamanlanabilen
     * eklenti komutu kendi alanlarını çizer ve görev gövdesini kendisi verir (schedule.form), kayıtlı görevi schedule.matches tanır.
     */
    __actionBody(box, actions, req, extEntries = []) {
      const esc = qx.bom.String.escape;
      const select = new qx.ui.form.SelectBox();
      const secret = a => (a.params || []).some(p => p.type === "password");
      const tip = (item, text) => item.set({ enabled: false, toolTipText: text });
      // Bütün hazır komutlar görünür; zamanlanamayanlar gerekçesiyle soluk (sunucu da reddeder — SchedulesApi).
      actions.forEach(a => {
        const item = new qx.ui.form.ListItem(`${a.category} — ${a.title}`, null, a);
        if (a.ui) {
          tip(item, `${a.title} kendi penceresinde çalışır; zamanlanamaz.`);
        } else if (secret(a)) {
          tip(item, "Parola isteyen işlemler zamanlanamaz (gizli değer saklanmaz).");
        }
        select.add(item);
        if (req && req.action === a.id && item.getEnabled()) {
          select.setSelection([item]);
        }
      });
      extEntries.forEach(e => {
        const item = new qx.ui.form.ListItem(`${e.category || "Eklenti"} — ${e.label}`, null, { extEntry: e });
        if (!e.schedule) {
          tip(item, "Bu hazır komut zamanlanamaz (yalnız kendi penceresinden çalışır).");
        }
        select.add(item);
        if (req && e.schedule && e.schedule.matches(req)) {
          select.setSelection([item]);
        }
      });
      // Yeni görevde ya da kayıtlı görev listede yoksa (ör. eklentisi kapatıldı) ilk seçilebilir komut.
      const chosen = select.getSelection()[0];
      if (!req || !chosen || !chosen.getEnabled()) {
        const first = select.getChildren().find(i => i.getEnabled());
        first && select.setSelection([first]);
      }
      box.add(select);
      const desc = new qx.ui.basic.Label("").set({ rich: true, wrap: true, textColor: "app-muted" });
      box.add(desc);
      const fields = new qx.ui.container.Composite(new qx.ui.layout.VBox());
      box.add(fields);
      let form = null;
      let extForm = null; // eklenti komutunun kendi alanları ({values()})
      const draw = () => {
        fields.removeAll().forEach(w => w.dispose());
        form = null;
        extForm = null;
        const a = select.getSelection()[0].getModel();
        if (a.extEntry) {
          desc.setValue(esc(String(a.extEntry.hint || "").slice(0, 600)));
          if (a.extEntry.schedule) {
            extForm = a.extEntry.schedule.form(fields, req && a.extEntry.schedule.matches(req) ? req : null);
          }
          return;
        }
        desc.setValue(esc(a.description || "").slice(0, 600));
        if ((a.params || []).length) {
          form = new ankamon.ui.Form();
          const vals = req && req.action === a.id ? req.values || {} : {};
          a.params.forEach(p => {
            const v = vals[p.key] !== undefined ? vals[p.key] : p.default;
            if (p.type === "select") {
              form.select(p.key, p.label, p.options, v);
            } else {
              form.text(p.key, p.label, v);
            }
          });
          fields.add(form);
        }
      };
      select.addListener("changeSelection", draw);
      draw();
      return {
        values: () => {
          const a = select.getSelection()[0].getModel();
          if (a.extEntry) {
            if (!extForm) {
              ankamon.ui.Dialog.alert("Bu hazır komut zamanlanamaz.");
              return null;
            }
            return extForm.values();
          }
          return { type: "action", action: a.id, values: form ? form.values() : {} };
        }
      };
    },

    /** Serbest komut: işletim sistemi ailesi başına kutu (boş bırakılan ailedeki cihazlar atlanır). */
    __commandBody(box, req) {
      const prev = (req && req.commands) || (req && req.command ? { linux: req.command } : {});
      const areas = {};
      [["linux", "Linux (bash)"], ["windows", "Windows (PowerShell)"], ["macos", "macOS (bash)"]].forEach(([f, label]) => {
        box.add(new qx.ui.basic.Label(label));
        areas[f] = new qx.ui.form.TextArea(prev[f] || "").set({ font: "app-mono", height: f === "linux" ? 90 : 50 });
        box.add(areas[f]);
      });
      box.add(new qx.ui.basic.Label("Her cihaza kendi işletim sisteminin kutusundaki komut gider; kutusu boş sistemdeki cihazlar atlanır.")
        .set({ textColor: "app-muted", font: "small", rich: true, wrap: true }));
      return {
        values: () => {
          const commands = {};
          Object.entries(areas).forEach(([f, a]) => {
            const t = (a.getValue() || "").trim();
            if (t) {
              commands[f] = t;
            }
          });
          if (!Object.keys(commands).length) {
            ankamon.ui.Dialog.alert("Komut boş.");
            return null;
          }
          return { type: "command", commands };
        }
      };
    },

    /** Anomali taraması: anlık taranabilen sürekli izleme denetimleri. */
    __kindsBody(box, kinds, req) {
      const prev = new Set((req && req.kinds) || []);
      const checks = {};
      const grid = new qx.ui.container.Composite(new qx.ui.layout.Grid(12, 2));
      Object.entries(kinds).filter(entry => entry[1].scan).forEach(([key, k], i) => {
        checks[key] = new qx.ui.form.CheckBox(k.label).set({ value: req ? prev.has(key) : true,
          toolTipText: k.description ? String(k.description).slice(0, 300) : null });
        grid.add(checks[key], { row: Math.floor(i / 2), column: i % 2 });
      });
      box.add(new qx.ui.basic.Label(qx.bom.String.escape(this.HINTS.anomaly_scan)).set({ rich: true, wrap: true, textColor: "app-muted" }));
      box.add(grid);
      return {
        values: () => {
          const chosen = Object.keys(checks).filter(k => checks[k].getValue());
          if (!chosen.length) {
            ankamon.ui.Dialog.alert("En az bir anomali türü seçin.");
            return null;
          }
          return { type: "anomaly_scan", kinds: chosen };
        }
      };
    },

    /** Aranabilir, onay kutulu cihaz listesi. @return {Map} {box, chosen} */
    __devicePicker(devices, initial) {
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(4));
      const top = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
      const search = new qx.ui.form.TextField().set({ placeholder: "Cihaz ara (ad, bilgisayar adı, IP)…", liveUpdate: true });
      top.add(search, { flex: 1 });
      const count = new qx.ui.basic.Label("").set({ textColor: "app-muted", minWidth: 70 });
      const btn = (label, fn) => {
        const b = new qx.ui.form.Button(label).set({ padding: [2, 8] });
        b.addListener("execute", fn);
        top.add(b);
      };
      const list = new qx.ui.container.Composite(new qx.ui.layout.VBox(0));
      const scroll = new qx.ui.container.Scroll(list).set({ height: 170 });
      const name = d => d.label || d.hostname || d.ip || `#${d.id}`;
      const sorted = devices.slice().sort((a, b) => name(a).localeCompare(name(b), "tr"));
      const checks = sorted.map(d => {
        const c = new qx.ui.form.CheckBox(`${name(d)}${d.hostname && d.label ? " · " + d.hostname : ""}${d.ip ? " · " + d.ip : ""}` +
          (d.online ? "" : "  (kapalı)")).set({ value: initial.has(d.id) });
        c.setUserData("device", d);
        c.setUserData("text", `${d.label || ""} ${d.hostname || ""} ${d.ip || ""}`.toLocaleLowerCase("tr"));
        c.addListener("changeValue", () => sync());
        list.add(c);
        return c;
      });
      const visible = () => checks.filter(c => c.getVisibility() === "visible");
      const sync = () => count.setValue(`${checks.filter(c => c.getValue()).length} seçili`);
      btn("Görünenleri seç", () => visible().forEach(c => c.setValue(true)));
      btn("Çevrimiçiler", () => visible().forEach(c => c.setValue(!!c.getUserData("device").online)));
      btn("Hiçbiri", () => visible().forEach(c => c.setValue(false)));
      top.add(count);
      search.addListener("changeValue", e => {
        const t = (e.getData() || "").trim().toLocaleLowerCase("tr");
        checks.forEach(c => c.setVisibility(!t || c.getUserData("text").includes(t) ? "visible" : "excluded"));
      });
      box.add(top);
      box.add(scroll);
      sync();
      return { box, chosen: () => new Set(checks.filter(c => c.getValue()).map(c => c.getUserData("device").id)) };
    }
  }
});
