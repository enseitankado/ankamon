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
 * Bilgisayar ayrıntıları penceresi (kullanıcı isteği 2026-11-09): Ağ ▸ Varlıklar'da satıra çift tıklama / sağ menü
 * "Bilgisayar ayrıntıları" / "Düzenle" ve Ağ ▸ Akıllı Tahtalar'daki "Düzenle" (eski "Cihazı düzenle" penceresinin
 * yerini aldı — bkz. ui.DeviceOps.editDevice). Düzenle kipinde açılır, alttaki düğme "Kaydet".
 *
 * Sekmeler:
 *  - Genel: cihazın ağ envanteri kaydının düzenlenebilir alanları (network.manage) + bütün bilgiler (salt okunur,
 *    seçilip kopyalanabilir)
 *  - Cihaz: cihaz Cihazlar'da kayıtlıysa cihaza özel düzenlenebilir alanlar (kablosuz MAC, konum, sensör portu…;
 *    devices.manage). Alanlar ui.DeviceOps.deviceForm'dan gelir — cihaza eklenen yeni alan burada kendiliğinden görünür.
 *  - Portlar ve paylaşımlar: açık portlar/servisler ve ağ paylaşımları (varsa)
 * Kaydet yalnız değişen kaydı (cihaz ve/veya cihaz) yazar.
 */
qx.Class.define("ankamon.ui.network.DeviceWindow", {
  type: "static",

  statics: {
    /** facts.wifi_bands ("2.4,5") → "2,4 GHz ve 5 GHz". */
    bands(facts) {
      const list = String((facts && facts.wifi_bands) || "").split(",").filter(Boolean).map(b => b.replace(".", ",") + " GHz");
      if (list.length) {
        return list.length > 1 ? list.slice(0, -1).join(", ") + " ve " + list[list.length - 1] : list[0];
      }
      return facts && facts.wifi_chip ? "bilinmiyor (bir sonraki donanım bilgisi toplamasında dolar)" : "—";
    },

    /**
     * @param opts {Map} {asset?: ağ envanteri satırı (NetworkApi devices), device?: cihaz ({id} yeter),
     *   user?: oturum sahibi (yoksa /auth/me), onSaved?: Function}
     */
    async open(opts) {
      let { asset = null, device = null, user = null } = opts;
      try {
        if (!user) {
          user = await ankamon.io.Api.get("/auth/me");
        }
        const can = f => user.is_admin || (user.features || []).includes(f);
        if (!asset && device && device.id && can("network")) {
          asset = (await ankamon.io.Api.get("/network/devices", { device: device.id })).devices[0] || null;
        }
        const deviceId = (device && device.id) || (asset && asset.device_id);
        if (deviceId) {
          device = (await ankamon.io.Api.get("/devices/" + deviceId)).device;
        }
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      this.__show(asset, device, user, opts.onSaved);
    },

    /** Genel sekmesindeki salt okunur bilgiler: [etiket, değer] (Ağ ▸ Varlıklar sütunlarıyla aynı içerik, tam tarihlerle). */
    infoRows(d) {
      const F = ankamon.util.Format;
      const Ops = ankamon.ui.network.Ops;
      const when = secs => (secs ? `${F.ago(secs)} (${F.dateTime(secs * 1000)})` : "—");
      const discovery = (d.discoveries && d.discoveries.length ? d.discoveries : [d.discovery])
        .map(k => ankamon.page.Network.DISCOVERY[k] || k).filter(Boolean).join(", ");
      return [
        ["Durum", d.online ? "Çevrim içi" : "Çevrim dışı"],
        ["Takma ad / Ad", Ops.deviceName(d)],
        ["IP/Maske", d.ip_mask || d.ip || "—"],
        ["MAC", d.mac],
        ["Marka (üretici)", d.vendor || "—"],
        ["Varlık türü", d.device_type || "—"],
        ["Model", d.model || "—"],
        ["Bilgisayar adı", d.hostname || "—"],
        ["İşletim sistemi", d.os_guess ? d.os_guess + (d.os_guess_at ? ` (tespit: ${F.dateTime(d.os_guess_at * 1000)})` : "") : "—"],
        ["Açık port", d.services_scanned_at ? String(d.services.length) : "taranmadı"],
        ["Ağ", d.network || "—"],
        ["Ağ arabirimi", d.iface || "—"],
        ["İlk görülme", when(d.first_seen_at)],
        ["Son görülme", d.online ? "şimdi (çevrim içi)" : when(d.last_seen_at)],
        ["Son log", d.last_log_at ? F.dateTime(d.last_log_at * 1000) : "log gelmedi"],
        ["Keşif", discovery || "—"],
        ["Faz", F.etap(d.etap) || "—"],
        ["Cihaz kaydı", d.device_name ? `${d.device_name} (Akıllı Tahtalar'da kayıtlı)` : "yok"],
        ["Not", d.notes || "—"]
      ].map(([k, v]) => [k, String(v ?? "").replace(/<[^>]+>/g, "").trim() || "—"]);
    },

    /** Seçilebilir HTML tablo (qx tablo hücreleri fareyle seçilemiyordu); plain'e düz metin karşılığı eklenir. */
    __htmlTable(title, columns, rows, widths, plain) {
      const esc = qx.bom.String.escape;
      const cell = "padding:4px 8px;border-bottom:1px solid rgba(128,128,128,.25);vertical-align:top;overflow-wrap:anywhere;text-align:left";
      const html = '<table style="border-collapse:collapse;width:100%;font:inherit;table-layout:fixed">' +
        "<colgroup>" + widths.map(w => (typeof w === "number" ? `<col style="width:${w}px">` : "<col>")).join("") + "</colgroup>" +
        (title ? "<tr>" + columns.map(c => `<th style="${cell};font-weight:bold">${esc(c)}</th>`).join("") + "</tr>" : "") +
        rows.map(r => "<tr>" + r.map((v, i) =>
          `<td style="${cell}${!title && i === 0 ? ";opacity:.75" : ""}">${esc(String(v ?? ""))}</td>`).join("") + "</tr>").join("") +
        "</table>";
      if (title) {
        plain.push("", title, columns.join("\t"));
      }
      rows.forEach(r => plain.push(title ? r.join("\t") : `${r[0]}: ${r[1]}`));
      return new qx.ui.basic.Label(html).set({ rich: true, wrap: true, selectable: true, allowGrowX: true });
    },

    __page(label) {
      const page = new qx.ui.tabview.Page(label).set({ layout: new qx.ui.layout.VBox(6), padding: 8 });
      return page;
    },

    __show(asset, device, user, onSaved) {
      const can = f => user.is_admin || (user.features || []).includes(f);
      const Ops = ankamon.ui.network.Ops;
      // Cihaza bağlı cihazda başlık da grid'deki cihaz adı (tek takma ad — Genel ▸ Takma ad ile aynı).
      const name = (device && device.label) || (asset ? (Ops.deviceName(asset) || asset.ip || asset.mac) : (device.hostname || device.ip || device.mac));
      const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
      const win = ankamon.ui.Dialog.window("Bilgisayar ayrıntıları — " + name, Math.min(760, root.width - 40), { maximizable: true });
      win.set({ height: Math.min(760, root.height - 40) });
      const tabs = new qx.ui.tabview.TabView().set({ contentPadding: 0 });
      const plain = [];

      // Genel: düzenlenebilir cihaz alanları + bilgiler.
      let assetForm = null;
      let typeBox = null;
      if (asset) {
        const general = this.__page("Genel");
        const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
        if (can("network.manage")) {
          assetForm = new ankamon.ui.Form();
          // Tek takma ad (kullanıcı bildirimi 2026-11-10: pencerede düzenlenen ad Akıllı Tahtalar grid'ine yansımıyordu — Genel'deki
          // ağ envanteri adı, Cihaz'daki cihaz kaydı adıydı). Cihaza bağlı cihazda değer grid'deki cihaz adıdır; kaydedince
          // ikisine de yazılır (Varlıklar ve Akıllı Tahtalar aynı adı gösterir).
          assetForm.text("label", "Takma ad", device ? (device.label || asset.label) : asset.label, "ör. Müdür odası yazıcısı")
            .setToolTipText(device ? "Varlıklar ve Akıllı Tahtalar'da aynı ad (ikisine de kaydedilir)" : null);
          // Salt okunur (kullanıcı isteği 2026-11-11): keşiften gelir, Kaydet göndermez.
          assetForm.text("ip", "IP adresi", asset.ip).set({ readOnly: true, toolTipText:
            "En son keşifte (ağ taraması ya da cihazın logları) görülen adres; cihaz yeni adreste görülünce kendiliğinden güncellenir." });
          assetForm.text("hostname", "Bilgisayar adı", asset.hostname);
          typeBox = new qx.ui.form.ComboBox().set({ value: asset.device_type_manual || "",
            placeholder: asset.type_auto ? `otomatik: ${asset.type_auto}` : "otomatik" });
          Ops.TYPES.forEach(t => typeBox.add(new qx.ui.form.ListItem(t)));
          typeBox.setToolTipText("Boş bırakılırsa tarayıcının tahmini kullanılır. Akıllı Tahtalar listesi türü 'Akıllı tahta' olan varlıklardan kendiliğinden oluşur: başka bir türe çevrilen cihaz listeden çıkar.");
          assetForm.addField("device_type", "Varlık türü", typeBox);
          assetForm.text("model", "Marka / model", asset.model_manual, asset.model_auto ? `otomatik: ${asset.model_auto}` : "ör. HP LaserJet M402dn");
          assetForm.text("notes", "Not", asset.notes);
          body.add(assetForm);
        }
        body.add(new qx.ui.basic.Label("Bilgiler").set({ font: "bold", marginTop: 6 }));
        body.add(this.__htmlTable(null, ["Alan", "Değer"], this.infoRows(asset), [170, "1*"], plain));
        general.add(new qx.ui.container.Scroll(body), { flex: 1 });
        tabs.add(general);
      }

      // Cihaz: cihaza özel düzenlenebilir alanlar (deviceForm — tek liste).
      let deviceFields = null;
      if (device) {
        const page = this.__page("Cihaz");
        const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
        if (can("devices.manage")) {
          deviceFields = ankamon.ui.DeviceOps.deviceForm(device, { noLabel: !!assetForm });
          body.add(deviceFields.form);
        }
        const F = ankamon.util.Format;
        const facts = device.facts || {};
        const info = [
          ["Bilgisayar adı", device.hostname || "—"],
          ["Durum", (device.alive ?? device.online) ? "Çevrim içi" : "Çevrim dışı"],
          ["Yönetilebilir", (device.manageable ?? device.online) ? "Evet (SSH ile oturum açılabiliyor)"
            : device.ssh_login_failing ? "Hayır — SSH portu açık ama root girişi reddediliyor (cihazın parolası farklı; Oturumlar ▸ Parola ayarla… ▸ Yönetici hesapları)"
              : "Hayır (SSH yanıt vermiyor)"],
          ["Son log", device.last_log_at ? F.dateTime(device.last_log_at * 1000) : "—"],
          ["Model", facts.product || "—"],
          ["İşlemci", facts.cpu_model || "—"],
          ["İşletim sistemi", facts.os_name || "—"],
          ["BIOS", [facts.bios_vendor, facts.bios_version, facts.bios_date].filter(Boolean).join(" ") || "—"],
          ["Seri no", facts.serial || facts.board_serial || "—"],
          // Wi-Fi kartı (kullanıcı isteği 2026-11-11): fabrika MAC'i, modeli, sürücüsü ve desteklediği bantlar
          // (worker executor/hwfacts — WIFI_CHIP/WIFI_BANDS; bantlar bir sonraki donanım toplamasında dolar).
          ["Wi-Fi MAC", device.wifi_mac || facts.wifi_mac || "—"],
          ["Wi-Fi kartı", [facts.wifi_chip, facts.wifi_driver ? `(${facts.wifi_driver} sürücüsü)` : ""].filter(Boolean).join(" ") || "—"],
          ["Wi-Fi bantları", ankamon.ui.network.DeviceWindow.bands(facts)]
        ];
        body.add(new qx.ui.basic.Label("Cihaz bilgileri").set({ font: "bold", marginTop: 6 }));
        body.add(this.__htmlTable(null, ["Alan", "Değer"], info, [170, "1*"], plain));
        page.add(new qx.ui.container.Scroll(body), { flex: 1 });
        tabs.add(page);
      }

      // Portlar ve paylaşımlar (kullanıcı isteği: ayrı sekme).
      if (asset) {
        const count = asset.services.length + (asset.shares ? asset.shares.length : 0);
        const page = this.__page(`Portlar ve paylaşımlar (${count})`);
        const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
        if (asset.services.length) {
          body.add(new qx.ui.basic.Label(`Açık portlar / servisler (${asset.services.length})`).set({ font: "bold" }));
          body.add(this.__htmlTable(`Açık portlar / servisler (${asset.services.length})`, ["Port", "Servis", "Ürün / sürüm", "Ek bilgi"],
            asset.services.map(s => [`${s.port}/${s.proto}`, s.service || "", [s.product, s.version].filter(Boolean).join(" "), s.extra || ""]),
            [90, 130, 200, "1*"], plain));
        }
        if (asset.shares && asset.shares.length) {
          body.add(new qx.ui.basic.Label(`Ağ paylaşımları (${asset.shares.length})`).set({ font: "bold", marginTop: 8 }));
          body.add(this.__htmlTable(`Ağ paylaşımları (${asset.shares.length})`, ["Tür", "Paylaşım", "Açıklama"],
            asset.shares.map(sh => [sh.stype === "printer" ? "🖨 yazıcı" : "📁 klasör", sh.path || sh.name, sh.comment || ""]),
            [100, 240, "1*"], plain));
        }
        if (!count) {
          body.add(new qx.ui.basic.Label(asset.services_scanned_at
            ? "Açık port ya da ağ paylaşımı bulunmadı." : "Bu cihazın portları henüz taranmadı (Ağ ▸ Varlıklar ▸ Servisleri tara).")
            .set({ textColor: "app-muted", rich: true, wrap: true }));
        }
        page.add(new qx.ui.container.Scroll(body), { flex: 1 });
        tabs.add(page);
      }
      if (!asset) {
        win.add(new qx.ui.basic.Label("Bu cihaz ağ taramasında henüz görülmedi; yalnız cihaz kaydı gösteriliyor.")
          .set({ textColor: "app-muted", rich: true, wrap: true, padding: [0, 0, 4, 0] }));
      }
      win.add(tabs, { flex: 1 });

      const buttons = [];
      // Loglar (kullanıcı isteği 2026-11-11: Cihazlar/Varlıklar sağ menüsünden buraya taşındı): Loglar sayfasını bu
      // cihaza süzülmüş açar (bkz. ui.Shell.OPEN_LOGS).
      if (device && can("logs")) {
        const logs = new qx.ui.form.Button("Loglar").set({ toolTipText: "Loglar sayfasını bu bilgisayarın loglarına süzülmüş açar" });
        logs.addListener("execute", () => {
          qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_LOGS, device.id);
          win.close();
        });
        buttons.push(logs);
      }
      const copyAll = new qx.ui.form.Button("Tümünü kopyala").set({ toolTipText: "Tüm ayrıntıları düz metin olarak panoya kopyalar" });
      copyAll.addListener("execute", () => ankamon.util.Clipboard.copy(`Bilgisayar ayrıntıları — ${name}\n` + plain.join("\n")));
      buttons.push(copyAll);
      const editable = assetForm || deviceFields;
      const cancel = new qx.ui.form.Button(editable ? "Vazgeç" : "Kapat");
      cancel.addListener("execute", () => win.close());
      buttons.push(cancel);
      if (editable) {
        const save = new qx.ui.form.Button("Kaydet");
        save.addListener("execute", async () => {
          let deviceValues = null;
          if (deviceFields) {
            deviceValues = deviceFields.read();
            if (!deviceValues) {
              tabs.setSelection([tabs.getChildren().find(p => p.getLabel() === "Cihaz")]);
              return;
            }
          }
          try {
            let label = null;
            if (assetForm) {
              const values = assetForm.values();
              delete values.ip; // salt okunur
              values.device_type = (typeBox.getValue() || "").trim();
              label = values.label;
              await ankamon.io.Api.patch("/network/devices/" + asset.id, values);
            }
            if (deviceValues) {
              if (label !== null) {
                deviceValues.label = label; // tek takma ad: cihaz kaydına da
              }
              // Varlık türü "Akıllı tahta" → cihaz kaydı da cihaz sayılır (eski "Bu bir akıllı tahtadır" işaretinin yerine;
              // MAC'i ETAP öneklerine uymayan cihazın IP'si loglarından güncellensin — worker tasks/devices_from_logs).
              if (typeBox && (typeBox.getValue() || "").trim() === "Akıllı tahta") {
                deviceValues.smart_board = true;
              }
              await ankamon.io.Api.patch("/devices/" + device.id, deviceValues);
            }
            win.close();
            if (onSaved) {
              onSaved();
            }
          } catch (e) {
            ankamon.ui.Dialog.error(e);
          }
        });
        buttons.push(save);
      }
      ankamon.ui.Dialog.buttons(win, buttons);
      win.open();
    }
  }
});
