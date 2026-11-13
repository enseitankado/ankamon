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
 * Cihaz ayrıntıları — TOPLU düzenleme (kullanıcı isteği 2026-11-10): Ağ ▸ Varlıklar (ve varlık grupları) ile
 * Ağ ▸ Akıllı Tahtalar'da birden çok satır işaretliyken "Düzenle". Tek bilgisayar penceresinin (ui.network.DeviceWindow)
 * alanlarını taşır; her bilgisayara ÖZGÜ olanlar (takma ad, IP adresi, bilgisayar adı, kablolu/kablosuz MAC) salt okunur
 * ve devre dışıdır — topluca değiştirilemez. Toplu değişebilenler: varlık türü, marka/model, not (ağ envanteri kaydı) ve
 * cihaz kaydının konum, sensör portu, sensör toplama, not alanları.
 *
 * Alan bütün seçilenlerde aynıysa o değerle, değilse boş ve "farklı değerler" ipucuyla açılır; YALNIZ değiştirilen alanlar
 * seçilen her kayda yazılır (PATCH /network/devices/{id}, PATCH /devices/{id} — ikisi de kısmi gövde kabul eder).
 */
qx.Class.define("ankamon.ui.network.DeviceBulkEdit", {
  type: "static",

  statics: {
    MIXED: "— farklı değerler; boş bırakılırsa korunur —",

    /**
     * @param opts {Map} {assets?: ağ envanteri satırları, devices?: cihaz satırları (en az biri), user?, onSaved?}
     *   Varlıklar'dan gelen cihazların cihaz kayıtları ve Akıllı Tahtalar'dan gelen cihazların cihaz kayıtları burada bulunur.
     */
    async open(opts) {
      let { assets = [], devices = [], user = null } = opts;
      try {
        if (!user) {
          user = await ankamon.io.Api.get("/auth/me");
        }
        const can = f => user.is_admin || (user.features || []).includes(f);
        if (!assets.length && devices.length && can("network")) {
          const ids = new Set(devices.map(b => b.id));
          assets = (await ankamon.io.Api.get("/network/devices", { network: 0 })).devices.filter(d => ids.has(d.device_id));
        }
        if (can("devices")) {
          const want = new Set(devices.map(b => b.id).concat(assets.map(d => d.device_id).filter(Boolean)));
          devices = want.size ? (await ankamon.io.Api.get("/devices")).devices.filter(b => want.has(b.id)) : [];
        }
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      this.__show(assets, devices, user, opts.onSaved, (opts.assets || []).length || (opts.devices || []).length);
    },

    /** Ortak değer: hepsinde aynıysa o (null/undefined → ""), değilse undefined. */
    __common(rows, get) {
      const values = [...new Set(rows.map(r => String(get(r) ?? "")))];
      return values.length === 1 ? values[0] : undefined;
    },

    /** Topluca değiştirilemeyen alan: salt okunur + devre dışı; ortak değer ya da "her birinde farklı". */
    __fixed(form, key, label, rows, get) {
      const common = this.__common(rows, get);
      // Değer kutuya yazılır (devre dışı kutuda ipucu metni bazı temalarda görünmüyor); soluk: bir bakışta düzenlenemez.
      return form.text(key, label, common === undefined ? "— her bilgisayarda farklı —" : (common || "—"))
        .set({ readOnly: true, enabled: false, opacity: 0.6, toolTipText: "Her bilgisayara özgü — toplu düzenlemede değiştirilemez" });
    },

    /** Toplu değiştirilebilen metin alanı; başlangıç değeri değişiklik tespiti için saklanır. */
    __editable(form, key, label, rows, get, widget) {
      const common = this.__common(rows, get);
      const field = widget || new qx.ui.form.TextField();
      field.setValue(common === undefined ? "" : common);
      if (common === undefined && field.setPlaceholder) {
        field.setPlaceholder(this.MIXED);
      }
      field.setUserData("bulkInitial", common === undefined ? "" : common);
      return form.addField(key, label, field);
    },

    /** Değişen alanlar {anahtar: değer} (başlangıçtan farklı olanlar). */
    __changed(form, keys) {
      const out = {};
      keys.forEach(key => {
        const field = form.getField(key);
        if (field instanceof qx.ui.form.SelectBox) {
          // Seçim kutusu (ör. işletim sistemi): model null = "değiştirme".
          const item = field.getSelection()[0];
          const model = item ? item.getModel() : null;
          if (model !== null && model !== field.getUserData("bulkInitial")) {
            out[key] = model;
          }
          return;
        }
        const value = field instanceof qx.ui.form.CheckBox ? field.getValue() : String(field.getValue() ?? "").trim();
        if (field instanceof qx.ui.form.CheckBox ? value !== null && value !== field.getUserData("bulkInitial")
          : value !== field.getUserData("bulkInitial")) {
          out[key] = value;
        }
      });
      return out;
    },

    __show(assets, devices, user, onSaved, count) {
      const can = f => user.is_admin || (user.features || []).includes(f);
      const Ops = ankamon.ui.network.Ops;
      const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
      const win = ankamon.ui.Dialog.window(`Cihaz ayrıntıları — ${count} cihaz (toplu düzenleme)`, Math.min(720, root.width - 40));
      win.set({ height: Math.min(700, root.height - 40) });
      win.add(new qx.ui.basic.Label(
        `<b>${count} bilgisayar</b> birlikte düzenleniyor. Yalnız değiştirdiğiniz alanlar hepsine yazılır; boş bırakılan ` +
        "\"farklı değerler\" alanları korunur. Her bilgisayara özgü alanlar (takma ad, IP adresi, bilgisayar adı, MAC) " +
        "topluca değiştirilemez — tek tek düzenlemek için bilgisayarın kendi ayrıntılar penceresini açın.")
        .set({ rich: true, wrap: true, textColor: "app-muted", padding: [0, 0, 6, 0] }));
      const tabs = new qx.ui.tabview.TabView().set({ contentPadding: 0 });
      const page = label => new qx.ui.tabview.Page(label).set({ layout: new qx.ui.layout.VBox(6), padding: 8 });

      let assetForm = null;
      if (assets.length && can("network.manage")) {
        assetForm = new ankamon.ui.Form();
        this.__fixed(assetForm, "label", "Takma ad", assets, d => Ops.deviceName(d));
        this.__fixed(assetForm, "ip", "IP adresi", assets, d => d.ip);
        this.__fixed(assetForm, "hostname", "Bilgisayar adı", assets, d => d.hostname);
        this.__fixed(assetForm, "mac", "MAC", assets, d => d.mac);
        const typeBox = new qx.ui.form.ComboBox();
        Ops.TYPES.forEach(t => typeBox.add(new qx.ui.form.ListItem(t)));
        typeBox.setToolTipText("Seçilen bütün varlıkların türü. 'Akıllı tahta' türlü varlıklar Akıllı Tahtalar listesinde görünür.");
        this.__editable(assetForm, "device_type", "Varlık türü", assets, d => d.device_type_manual, typeBox);
        // Fiziksel konum (Tesis Envanteri kodu) topluca: ör. aynı salondaki cihazlar. Cihaza bağlı varlıkta cihaz kaydına da eşlenir (göç 054).
        const PL = ankamon.ui.network.PhysicalLocation;
        this.__editable(assetForm, "location", PL.LABEL, assets, d => d.location,
          PL.field("", this.__common(assets, d => d.location) === undefined ? this.MIXED : null));
        this.__editable(assetForm, "model", "Marka / model", assets, d => d.model_manual);
        this.__editable(assetForm, "notes", "Not", assets, d => d.notes);
        const general = page(`Genel (${assets.length} varlık)`);
        general.add(new qx.ui.container.Scroll(assetForm), { flex: 1 });
        tabs.add(general);
      }

      let deviceForm = null;
      if (devices.length && can("devices.manage")) {
        deviceForm = new ankamon.ui.Form();
        if (!assetForm) {
          this.__fixed(deviceForm, "label", "Takma ad", devices, b => b.label);
        }
        if (!assetForm) {
          const PL = ankamon.ui.network.PhysicalLocation;
          this.__editable(deviceForm, "location", PL.LABEL, devices, b => b.location,
            PL.field("", this.__common(devices, b => b.location) === undefined ? this.MIXED : null));
        }
        this.__fixed(deviceForm, "ip", "IP adresi", devices, b => b.ip);
        this.__fixed(deviceForm, "mac", "Kablolu MAC", devices, b => b.mac);
        this.__fixed(deviceForm, "wifi_mac", "Kablosuz MAC", devices, b => b.wifi_mac);
        this.__editable(deviceForm, "exporter_port", "Sensör portu", devices, b => b.exporter_port);
        // İşletim sistemi (kullanıcı isteği 2026-11-12; platforms/README.md): toplu seçim — ör. birkaç cihazı Windows yapmak.
        const P = ankamon.ui.devices.Platforms;
        const commonOs = this.__common(devices, b => b.os_family_manual || "");
        const osBox = new qx.ui.form.SelectBox().set({ toolTipText: "İşlevler (ekran, kilit, komut, kapat…) cihazın işletim sistemine göre uygulanır" });
        const osItems = (commonOs === undefined ? [[null, "— farklı; değiştirme —"]] : [])
          .concat([["", "Kendiliğinden (SSH bilgisi / ağ taraması)"]], (P.catalog().family_order || ["linux"]).map(f => [f, P.label(f)]));
        osItems.forEach(([value, label]) => {
          const item = new qx.ui.form.ListItem(label, null, value);
          osBox.add(item);
          if (value === (commonOs === undefined ? null : commonOs)) {
            osBox.setSelection([item]);
          }
        });
        osBox.setUserData("bulkInitial", commonOs === undefined ? null : commonOs);
        deviceForm.addField("os_family", "İşletim sistemi", osBox);
        const monitor = this.__common(devices, b => b.monitor_enabled !== false);
        const check = new qx.ui.form.CheckBox().set({ triState: monitor === undefined, value: monitor === undefined ? null : monitor === "true" });
        check.setUserData("bulkInitial", monitor === undefined ? null : monitor === "true");
        check.setToolTipText(monitor === undefined ? "Seçilenlerin bir kısmında açık, bir kısmında kapalı; tıklayınca hepsi için seçilir" : null);
        deviceForm.addField("monitor_enabled", "Sensör verisi toplansın", check);
        this.__editable(deviceForm, "notes", "Not (cihaz)", devices, b => b.notes);
        const devicePage = page(`Cihaz (${devices.length} cihaz)`);
        devicePage.add(new qx.ui.container.Scroll(deviceForm), { flex: 1 });
        tabs.add(devicePage);
      }

      if (!assetForm && !deviceForm) {
        win.add(new qx.ui.basic.Label("Bu kayıtları düzenleme yetkiniz yok.").set({ textColor: "app-muted" }));
      } else {
        win.add(tabs, { flex: 1 });
      }

      const cancel = new qx.ui.form.Button(assetForm || deviceForm ? "Vazgeç" : "Kapat");
      cancel.addListener("execute", () => win.close());
      const buttons = [cancel];
      if (assetForm || deviceForm) {
        const save = new qx.ui.form.Button(`Kaydet (${count} bilgisayar)`);
        save.addListener("execute", async () => {
          const assetChanges = assetForm ? this.__changed(assetForm, ["device_type", "location", "model", "notes"]) : {};
          const deviceChanges = deviceForm ? this.__changed(deviceForm, (assetForm ? [] : ["location"]).concat(["exporter_port", "os_family", "monitor_enabled", "notes"])) : {};
          if ("exporter_port" in deviceChanges) {
            const port = parseInt(deviceChanges.exporter_port, 10);
            if (!(port > 0 && port < 65536)) {
              ankamon.ui.Dialog.error("Sensör portu 1–65535 arasında bir sayı olmalı.");
              return;
            }
            deviceChanges.exporter_port = port;
          }
          // Varlık türü "Akıllı tahta" seçildiyse cihaz kaydı da cihaz sayılsın (eski "Bu bir akıllı tahtadır" işaretinin yerine).
          if (assetChanges.device_type === "Akıllı tahta" && devices.length) {
            deviceChanges.smart_board = true;
          }
          if (!Object.keys(assetChanges).length && !Object.keys(deviceChanges).length) {
            ankamon.ui.Dialog.alert("Hiçbir alan değiştirilmedi.");
            return;
          }
          save.setEnabled(false);
          let failed = 0;
          const run = async (items, url, body) => {
            for (const item of items) {
              try {
                await ankamon.io.Api.patch(url + item.id, body);
              } catch (e) {
                failed++;
              }
            }
          };
          if (Object.keys(assetChanges).length) {
            await run(assets, "/network/devices/", assetChanges);
          }
          if (Object.keys(deviceChanges).length) {
            await run(devices, "/devices/", deviceChanges);
          }
          ankamon.ui.network.PhysicalLocation.invalidate();
          if (failed) {
            ankamon.ui.Dialog.error(`${failed} kayıt kaydedilemedi; ötekiler kaydedildi.`);
          }
          win.close();
          if (onSaved) {
            onSaved();
          }
        });
        buttons.push(save);
      }
      ankamon.ui.Dialog.buttons(win, buttons);
      win.open();
    }
  }
});
