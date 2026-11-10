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
 * "Bilgisayar ayrıntıları" / "Düzenle" ve Ağ ▸ Akıllı Tahtalar'daki "Düzenle" (eski "Tahtayı düzenle" penceresinin
 * yerini aldı — bkz. ui.BoardOps.editBoard). Düzenle kipinde açılır, alttaki düğme "Kaydet".
 *
 * Sekmeler:
 *  - Genel: cihazın ağ envanteri kaydının düzenlenebilir alanları (network.manage) + bütün bilgiler (salt okunur,
 *    seçilip kopyalanabilir)
 *  - Tahta: cihaz Tahtalar'da kayıtlıysa tahtaya özel düzenlenebilir alanlar (kablosuz MAC, konum, sensör portu…;
 *    boards.manage). Alanlar ui.BoardOps.boardForm'dan gelir — tahtaya eklenen yeni alan burada kendiliğinden görünür.
 *  - Portlar ve paylaşımlar: açık portlar/servisler ve ağ paylaşımları (varsa)
 * Kaydet yalnız değişen kaydı (cihaz ve/veya tahta) yazar.
 */
qx.Class.define("ankamon.ui.network.DeviceWindow", {
  type: "static",

  statics: {
    /**
     * @param opts {Map} {device?: ağ envanteri satırı (NetworkApi devices), board?: tahta ({id} yeter),
     *   user?: oturum sahibi (yoksa /auth/me), onSaved?: Function}
     */
    async open(opts) {
      let { device = null, board = null, user = null } = opts;
      try {
        if (!user) {
          user = await ankamon.io.Api.get("/auth/me");
        }
        const can = f => user.is_admin || (user.features || []).includes(f);
        if (!device && board && board.id && can("network")) {
          device = (await ankamon.io.Api.get("/network/devices", { board: board.id })).devices[0] || null;
        }
        const boardId = (board && board.id) || (device && device.board_id);
        if (boardId) {
          board = (await ankamon.io.Api.get("/boards/" + boardId)).board;
        }
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return;
      }
      this.__show(device, board, user, opts.onSaved);
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
        ["Tahta kaydı", d.board_name ? `${d.board_name} (Akıllı Tahtalar'da kayıtlı)` : "yok"],
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

    __show(device, board, user, onSaved) {
      const can = f => user.is_admin || (user.features || []).includes(f);
      const Ops = ankamon.ui.network.Ops;
      const name = device ? (Ops.deviceName(device) || device.ip || device.mac) : (board.label || board.hostname || board.ip || board.mac);
      const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
      const win = ankamon.ui.Dialog.window("Bilgisayar ayrıntıları — " + name, Math.min(760, root.width - 40), { maximizable: true });
      win.set({ height: Math.min(760, root.height - 40) });
      const tabs = new qx.ui.tabview.TabView().set({ contentPadding: 0 });
      const plain = [];

      // Genel: düzenlenebilir cihaz alanları + bilgiler.
      let deviceForm = null;
      let typeBox = null;
      if (device) {
        const general = this.__page("Genel");
        const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
        if (can("network.manage")) {
          deviceForm = new ankamon.ui.Form();
          deviceForm.text("label", "Takma ad", device.label, "ör. Müdür odası yazıcısı");
          deviceForm.text("ip", "IP adresi", device.ip).setToolTipText(
            "En son keşifte (ağ taraması ya da tahtanın logları) görülen adres; cihaz yeni adreste görülünce kendiliğinden güncellenir.");
          deviceForm.text("hostname", "Bilgisayar adı", device.hostname);
          typeBox = new qx.ui.form.ComboBox().set({ value: device.device_type_manual || "",
            placeholder: device.type_auto ? `otomatik: ${device.type_auto}` : "otomatik" });
          Ops.TYPES.forEach(t => typeBox.add(new qx.ui.form.ListItem(t)));
          typeBox.setToolTipText("Boş bırakılırsa tarayıcının tahmini kullanılır. Akıllı Tahtalar listesi türü 'Akıllı tahta' olan varlıklardan kendiliğinden oluşur: başka bir türe çevrilen cihaz listeden çıkar.");
          deviceForm.addField("device_type", "Varlık türü", typeBox);
          deviceForm.text("model", "Marka / model", device.model_manual, device.model_auto ? `otomatik: ${device.model_auto}` : "ör. HP LaserJet M402dn");
          deviceForm.text("notes", "Not", device.notes);
          body.add(deviceForm);
        }
        body.add(new qx.ui.basic.Label("Bilgiler").set({ font: "bold", marginTop: 6 }));
        body.add(this.__htmlTable(null, ["Alan", "Değer"], this.infoRows(device), [170, "1*"], plain));
        general.add(new qx.ui.container.Scroll(body), { flex: 1 });
        tabs.add(general);
      }

      // Tahta: tahtaya özel düzenlenebilir alanlar (boardForm — tek liste).
      let boardFields = null;
      if (board) {
        const page = this.__page("Tahta");
        const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
        if (can("boards.manage")) {
          boardFields = ankamon.ui.BoardOps.boardForm(board);
          body.add(boardFields.form);
        }
        const F = ankamon.util.Format;
        const facts = board.facts || {};
        const info = [
          ["Bilgisayar adı", board.hostname || "—"],
          ["Durum", board.online ? "Çevrim içi" : "Çevrim dışı"],
          ["Son log", board.last_log_at ? F.dateTime(board.last_log_at * 1000) : "—"],
          ["Model", facts.product || "—"],
          ["İşlemci", facts.cpu_model || "—"],
          ["İşletim sistemi", facts.os_name || "—"],
          ["BIOS", [facts.bios_vendor, facts.bios_version, facts.bios_date].filter(Boolean).join(" ") || "—"],
          ["Seri no", facts.serial || facts.board_serial || "—"]
        ];
        body.add(new qx.ui.basic.Label("Tahta bilgileri").set({ font: "bold", marginTop: 6 }));
        body.add(this.__htmlTable(null, ["Alan", "Değer"], info, [170, "1*"], plain));
        page.add(new qx.ui.container.Scroll(body), { flex: 1 });
        tabs.add(page);
      }

      // Portlar ve paylaşımlar (kullanıcı isteği: ayrı sekme).
      if (device) {
        const count = device.services.length + (device.shares ? device.shares.length : 0);
        const page = this.__page(`Portlar ve paylaşımlar (${count})`);
        const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
        if (device.services.length) {
          body.add(new qx.ui.basic.Label(`Açık portlar / servisler (${device.services.length})`).set({ font: "bold" }));
          body.add(this.__htmlTable(`Açık portlar / servisler (${device.services.length})`, ["Port", "Servis", "Ürün / sürüm", "Ek bilgi"],
            device.services.map(s => [`${s.port}/${s.proto}`, s.service || "", [s.product, s.version].filter(Boolean).join(" "), s.extra || ""]),
            [90, 130, 200, "1*"], plain));
        }
        if (device.shares && device.shares.length) {
          body.add(new qx.ui.basic.Label(`Ağ paylaşımları (${device.shares.length})`).set({ font: "bold", marginTop: 8 }));
          body.add(this.__htmlTable(`Ağ paylaşımları (${device.shares.length})`, ["Tür", "Paylaşım", "Açıklama"],
            device.shares.map(sh => [sh.stype === "printer" ? "🖨 yazıcı" : "📁 klasör", sh.path || sh.name, sh.comment || ""]),
            [100, 240, "1*"], plain));
        }
        if (!count) {
          body.add(new qx.ui.basic.Label(device.services_scanned_at
            ? "Açık port ya da ağ paylaşımı bulunmadı." : "Bu cihazın portları henüz taranmadı (Ağ ▸ Varlıklar ▸ Servisleri tara).")
            .set({ textColor: "app-muted", rich: true, wrap: true }));
        }
        page.add(new qx.ui.container.Scroll(body), { flex: 1 });
        tabs.add(page);
      }
      if (!device) {
        win.add(new qx.ui.basic.Label("Bu tahta ağ taramasında henüz görülmedi; yalnız tahta kaydı gösteriliyor.")
          .set({ textColor: "app-muted", rich: true, wrap: true, padding: [0, 0, 4, 0] }));
      }
      win.add(tabs, { flex: 1 });

      const buttons = [];
      const copyAll = new qx.ui.form.Button("Tümünü kopyala").set({ toolTipText: "Tüm ayrıntıları düz metin olarak panoya kopyalar" });
      copyAll.addListener("execute", () => ankamon.util.Clipboard.copy(`Bilgisayar ayrıntıları — ${name}\n` + plain.join("\n")));
      buttons.push(copyAll);
      const editable = deviceForm || boardFields;
      const cancel = new qx.ui.form.Button(editable ? "Vazgeç" : "Kapat");
      cancel.addListener("execute", () => win.close());
      buttons.push(cancel);
      if (editable) {
        const save = new qx.ui.form.Button("Kaydet");
        save.addListener("execute", async () => {
          let boardValues = null;
          if (boardFields) {
            boardValues = boardFields.read();
            if (!boardValues) {
              tabs.setSelection([tabs.getChildren().find(p => p.getLabel() === "Tahta")]);
              return;
            }
          }
          try {
            if (deviceForm) {
              const values = deviceForm.values();
              values.device_type = (typeBox.getValue() || "").trim();
              await ankamon.io.Api.patch("/network/devices/" + device.id, values);
            }
            if (boardValues) {
              await ankamon.io.Api.patch("/boards/" + board.id, boardValues);
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
