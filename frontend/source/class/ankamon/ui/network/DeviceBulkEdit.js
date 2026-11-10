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
 * Bilgisayar ayrıntıları — TOPLU düzenleme (kullanıcı isteği 2026-11-10): Ağ ▸ Varlıklar (ve varlık grupları) ile
 * Ağ ▸ Akıllı Tahtalar'da birden çok satır işaretliyken "Düzenle". Tek bilgisayar penceresinin (ui.network.DeviceWindow)
 * alanlarını taşır; her bilgisayara ÖZGÜ olanlar (takma ad, IP adresi, bilgisayar adı, kablolu/kablosuz MAC) salt okunur
 * ve devre dışıdır — topluca değiştirilemez. Toplu değişebilenler: varlık türü, marka/model, not (ağ envanteri kaydı) ve
 * tahta kaydının konum, sensör portu, sensör toplama, not alanları.
 *
 * Alan bütün seçilenlerde aynıysa o değerle, değilse boş ve "farklı değerler" ipucuyla açılır; YALNIZ değiştirilen alanlar
 * seçilen her kayda yazılır (PATCH /network/devices/{id}, PATCH /boards/{id} — ikisi de kısmi gövde kabul eder).
 */
qx.Class.define("ankamon.ui.network.DeviceBulkEdit", {
  type: "static",

  statics: {
    MIXED: "— farklı değerler; boş bırakılırsa korunur —",

    /**
     * @param opts {Map} {devices?: ağ envanteri satırları, boards?: tahta satırları (en az biri), user?, onSaved?}
     *   Varlıklar'dan gelen cihazların tahta kayıtları ve Akıllı Tahtalar'dan gelen tahtaların cihaz kayıtları burada bulunur.
     */
    async open(opts) {
      let { devices = [], boards = [], user = null } = opts;
      try {
        if (!user) {
          user = await ankamon.io.Api.get("/auth/me");
        }
        const can = f => user.is_admin || (user.features || []).includes(f);
        if (!devices.length && boards.length && can("network")) {
          const ids = new Set(boards.map(b => b.id));
          devices = (await ankamon.io.Api.get("/network/devices", { network: 0 })).devices.filter(d => ids.has(d.board_id));
        }
        if (can("boards")) {
          const want = new Set(boards.map(b => b.id).concat(devices.map(d => d.board_id).filter(Boolean)));
          boards = want.size ? (await ankamon.io.Api.get("/boards")).boards.filter(b => want.has(b.id)) : [];
        }
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      this.__show(devices, boards, user, opts.onSaved, (opts.devices || []).length || (opts.boards || []).length);
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
        const value = field instanceof qx.ui.form.CheckBox ? field.getValue() : String(field.getValue() ?? "").trim();
        if (field instanceof qx.ui.form.CheckBox ? value !== null && value !== field.getUserData("bulkInitial")
          : value !== field.getUserData("bulkInitial")) {
          out[key] = value;
        }
      });
      return out;
    },

    __show(devices, boards, user, onSaved, count) {
      const can = f => user.is_admin || (user.features || []).includes(f);
      const Ops = ankamon.ui.network.Ops;
      const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
      const win = ankamon.ui.Dialog.window(`Bilgisayar ayrıntıları — ${count} bilgisayar (toplu düzenleme)`, Math.min(720, root.width - 40));
      win.set({ height: Math.min(700, root.height - 40) });
      win.add(new qx.ui.basic.Label(
        `<b>${count} bilgisayar</b> birlikte düzenleniyor. Yalnız değiştirdiğiniz alanlar hepsine yazılır; boş bırakılan ` +
        "\"farklı değerler\" alanları korunur. Her bilgisayara özgü alanlar (takma ad, IP adresi, bilgisayar adı, MAC) " +
        "topluca değiştirilemez — tek tek düzenlemek için bilgisayarın kendi ayrıntılar penceresini açın.")
        .set({ rich: true, wrap: true, textColor: "app-muted", padding: [0, 0, 6, 0] }));
      const tabs = new qx.ui.tabview.TabView().set({ contentPadding: 0 });
      const page = label => new qx.ui.tabview.Page(label).set({ layout: new qx.ui.layout.VBox(6), padding: 8 });

      let deviceForm = null;
      if (devices.length && can("network.manage")) {
        deviceForm = new ankamon.ui.Form();
        this.__fixed(deviceForm, "label", "Takma ad", devices, d => Ops.deviceName(d));
        this.__fixed(deviceForm, "ip", "IP adresi", devices, d => d.ip);
        this.__fixed(deviceForm, "hostname", "Bilgisayar adı", devices, d => d.hostname);
        this.__fixed(deviceForm, "mac", "MAC", devices, d => d.mac);
        const typeBox = new qx.ui.form.ComboBox();
        Ops.TYPES.forEach(t => typeBox.add(new qx.ui.form.ListItem(t)));
        typeBox.setToolTipText("Seçilen bütün varlıkların türü. 'Akıllı tahta' türlü varlıklar Akıllı Tahtalar listesinde görünür.");
        this.__editable(deviceForm, "device_type", "Varlık türü", devices, d => d.device_type_manual, typeBox);
        this.__editable(deviceForm, "model", "Marka / model", devices, d => d.model_manual);
        this.__editable(deviceForm, "notes", "Not", devices, d => d.notes);
        const general = page(`Genel (${devices.length} varlık)`);
        general.add(new qx.ui.container.Scroll(deviceForm), { flex: 1 });
        tabs.add(general);
      }

      let boardForm = null;
      if (boards.length && can("boards.manage")) {
        boardForm = new ankamon.ui.Form();
        if (!deviceForm) {
          this.__fixed(boardForm, "label", "Takma ad", boards, b => b.label);
        }
        this.__editable(boardForm, "location", "Konum", boards, b => b.location);
        this.__fixed(boardForm, "ip", "IP adresi", boards, b => b.ip);
        this.__fixed(boardForm, "mac", "Kablolu MAC", boards, b => b.mac);
        this.__fixed(boardForm, "wifi_mac", "Kablosuz MAC", boards, b => b.wifi_mac);
        this.__editable(boardForm, "exporter_port", "Sensör portu", boards, b => b.exporter_port);
        const monitor = this.__common(boards, b => b.monitor_enabled !== false);
        const check = new qx.ui.form.CheckBox().set({ triState: monitor === undefined, value: monitor === undefined ? null : monitor === "true" });
        check.setUserData("bulkInitial", monitor === undefined ? null : monitor === "true");
        check.setToolTipText(monitor === undefined ? "Seçilenlerin bir kısmında açık, bir kısmında kapalı; tıklayınca hepsi için seçilir" : null);
        boardForm.addField("monitor_enabled", "Sensör verisi toplansın", check);
        this.__editable(boardForm, "notes", "Not (tahta)", boards, b => b.notes);
        const boardPage = page(`Tahta (${boards.length} tahta)`);
        boardPage.add(new qx.ui.container.Scroll(boardForm), { flex: 1 });
        tabs.add(boardPage);
      }

      if (!deviceForm && !boardForm) {
        win.add(new qx.ui.basic.Label("Bu kayıtları düzenleme yetkiniz yok.").set({ textColor: "app-muted" }));
      } else {
        win.add(tabs, { flex: 1 });
      }

      const cancel = new qx.ui.form.Button(deviceForm || boardForm ? "Vazgeç" : "Kapat");
      cancel.addListener("execute", () => win.close());
      const buttons = [cancel];
      if (deviceForm || boardForm) {
        const save = new qx.ui.form.Button(`Kaydet (${count} bilgisayar)`);
        save.addListener("execute", async () => {
          const deviceChanges = deviceForm ? this.__changed(deviceForm, ["device_type", "model", "notes"]) : {};
          const boardChanges = boardForm ? this.__changed(boardForm, ["location", "exporter_port", "monitor_enabled", "notes"]) : {};
          if ("exporter_port" in boardChanges) {
            const port = parseInt(boardChanges.exporter_port, 10);
            if (!(port > 0 && port < 65536)) {
              ankamon.ui.Dialog.error("Sensör portu 1–65535 arasında bir sayı olmalı.");
              return;
            }
            boardChanges.exporter_port = port;
          }
          // Varlık türü "Akıllı tahta" seçildiyse tahta kaydı da tahta sayılsın (eski "Bu bir akıllı tahtadır" işaretinin yerine).
          if (deviceChanges.device_type === "Akıllı tahta" && boards.length) {
            boardChanges.smart_board = true;
          }
          if (!Object.keys(deviceChanges).length && !Object.keys(boardChanges).length) {
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
          if (Object.keys(deviceChanges).length) {
            await run(devices, "/network/devices/", deviceChanges);
          }
          if (Object.keys(boardChanges).length) {
            await run(boards, "/boards/", boardChanges);
          }
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
