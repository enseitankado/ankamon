/**
 * Ağ envanteri işlemleri (page.Network ve sol ağaçtaki ağ düğümleri ortak kullanır): cihaz ekle/
 * düzenle penceresi, silme, ağ düğümü sağ menüsü ve tarayıcı durum metni. API: backend NetworkApi.
 */
qx.Class.define("ankamon.ui.network.Ops", {
  type: "static",

  statics: {
    // worker/ankamon/netscan/classify.py adlarıyla aynı (seçim listesi; serbest metin de girilebilir).
    TYPES: [
      "Bilgisayar", "Sunucu", "Akıllı tahta", "Yazıcı", "IP kamera", "Ağ cihazı", "Ağ geçidi / yönlendirici",
      "Kablosuz erişim noktası", "Telefon / tablet", "Apple cihazı", "TV / medya", "Depolama (NAS)",
      "IoT cihazı", "Raspberry Pi", "IP telefon", "Sanal makine", "Ankamon sunucusu"
    ],

    // Sol ağaçtaki ağ listesini tazelemek için (bkz. ui.Shell): payload {networks:[…]}
    NETWORKS_CHANGED: "ankamon.networksChanged",

    /** Ağın görünen adı: kullanıcı adı verdiyse o, yoksa CIDR (+ arabirimler). */
    networkLabel(net) {
      return net.name || `${net.cidr}${net.ifaces && net.ifaces.length ? " (" + net.ifaces.join(", ") + ")" : ""}`;
    },

    /** Cihazın görünen adı: etiket → MAC ↔ takma ad kaydı → bilgisayar adı → tahta adı → IP → MAC. */
    deviceName(d) {
      return d.label || d.known_alias || d.hostname || d.board_name || d.ip || d.mac;
    },

    /**
     * Tarayıcının anlık durumu (netscan_state.state), araç çubuğunun altındaki satır için.
     * @return {Map} {sweep: rich metin, sweepPct: Number|null (tarama sürmüyorsa null),
     *   service: rich metin, servicePct: Number|null (servis taraması sürmüyorsa null)}
     */
    status(st, now) {
      const esc = v => qx.bom.String.escape(String(v ?? ""));
      const out = { sweep: "", sweepPct: null, service: "", servicePct: null };
      if (!st || !st.phase) {
        out.sweep = "Ağ tarayıcısı henüz başlamadı.";
        return out;
      }
      const left = st.next_at ? Math.max(0, Math.round(st.next_at - now)) : null;
      const load = st.load ? ` (CPU %${Math.round(st.load.cpu)}, boş bellek %${Math.round(st.load.mem_free)})` : "";
      if (st.phase === "sweeping") {
        const p = st.progress || { pct: 0, found: 0, index: 1, count: 1 };
        out.sweep = `<b>⟳ Taranıyor:</b> ${esc(st.current || "")}` + (p.count > 1 ? ` (${p.index}/${p.count})` : "") +
          ` — %${p.pct}`;
        out.sweepPct = p.pct;
      } else if (st.phase === "deferred") {
        out.sweep = `<b>⏸ Makine yoğun, tarama ertelendi</b> — ${esc(st.reason)}` +
          (left !== null ? `; ${left} sn sonra yeniden bakılacak` : "");
      } else {
        out.sweep = `✓ Varlık taraması ${st.last_at ? ankamon.util.Format.ago(Math.round(st.last_at)) : "—"}` +
          (left !== null ? `; sonraki ${left} sn sonra` : "") + `, aralık ${st.interval || "?"} sn${load}`;
      }
      const svc = st.service || {};
      const done = svc.total ? svc.total - svc.pending : 0;
      const segments = [];
      if (svc.phase === "scanning") {
        out.service = `servis taraması: <b>${esc(svc.target)}</b> — ${done}/${svc.total}`;
        out.servicePct = svc.total ? Math.round(100 * done / svc.total) : 0;
      } else if (svc.phase === "deferred" && svc.pending) {
        out.service = `servis taraması bekliyor (${done}/${svc.total}) — ${esc(svc.reason)}`;
      }
      // Paylaşım (SMB) kanalı: ayrı çubuk değil, servis metninin yanında.
      const sh = st.shares || {};
      const shDone = sh.total ? sh.total - sh.pending : 0;
      if (sh.phase === "scanning") {
        segments.push(`paylaşım taraması: <b>${esc(sh.target)}</b> — ${shDone}/${sh.total}`);
      } else if (sh.phase === "deferred" && sh.pending) {
        segments.push(`paylaşım taraması bekliyor (${shDone}/${sh.total})`);
      }
      if (segments.length) {
        out.service = [out.service, ...segments].filter(Boolean).join(" · ");
      }
      return out;
    },

    /**
     * Cihaz ekle (device null) / düzenle penceresi.
     * @param networks {Array} ekleme için ağ seçimi; networkId verilen ağ önseçili
     * @return {Promise<Boolean>} kaydedildiyse true
     */
    edit(device, networks, networkId) {
      return new Promise(resolve => {
        let saved = false;
        const win = ankamon.ui.Dialog.window(device ? "Cihazı düzenle" : "Cihaz ekle", 480);
        const form = new ankamon.ui.Form();
        const d = device || {};
        if (!device) {
          form.select("network_id", "Ağ", networks.map(n => ({ value: n.id, label: this.networkLabel(n) })),
            networkId || (networks[0] && networks[0].id));
          form.text("mac", "MAC adresi", "", "ör. 00:1a:2b:3c:4d:5e (cihazın kimliği)");
        } else {
          form.addField("mac_ro", "MAC adresi", new qx.ui.basic.Label(`${d.mac}${d.vendor ? " — " + d.vendor : ""}`));
        }
        form.text("label", "Takma ad", d.label, "ör. Müdür odası yazıcısı");
        form.text("ip", "IP adresi", d.ip);
        form.text("hostname", "Bilgisayar adı", d.hostname);
        const type = new qx.ui.form.ComboBox().set({ value: d.device_type_manual || "", placeholder: d.type_auto ? `otomatik: ${d.type_auto}` : "otomatik" });
        this.TYPES.forEach(t => type.add(new qx.ui.form.ListItem(t)));
        form.addField("device_type", "Cihaz türü", type);
        form.text("model", "Marka / model", d.model_manual, d.model_auto ? `otomatik: ${d.model_auto}` : "ör. HP LaserJet M402dn");
        form.text("notes", "Not", d.notes);
        win.add(form);
        win.add(new qx.ui.basic.Label("Tür ve model boş bırakılırsa tarayıcının tahmini gösterilir.")
          .set({ textColor: "app-muted", rich: true, wrap: true }));

        const cancel = new qx.ui.form.Button("Vazgeç");
        const save = new qx.ui.form.Button("Kaydet");
        cancel.addListener("execute", () => win.close());
        save.addListener("execute", async () => {
          const values = form.values();
          delete values.mac_ro;
          values.device_type = (type.getValue() || "").trim();
          try {
            if (device) {
              await ankamon.io.Api.patch("/network/devices/" + device.id, values);
            } else {
              await ankamon.io.Api.post("/network/devices", values);
            }
            saved = true;
            win.close();
          } catch (e) {
            ankamon.ui.Dialog.error(e);
          }
        });
        win.addListener("close", () => resolve(saved));
        ankamon.ui.Dialog.buttons(win, [cancel, save]);
        win.open();
      });
    },

    /** @return {Promise<Boolean>} silindiyse true */
    async remove(devices) {
      const esc = v => qx.bom.String.escape(String(v ?? ""));
      const names = devices.slice(0, 12).map(d => esc(this.deviceName(d))).join(", ") + (devices.length > 12 ? " …" : "");
      const sure = await ankamon.ui.Dialog.confirm(
        `Seçili <b>${devices.length}</b> cihaz envanterden silinsin mi?<br>${names}<br><br>` +
        "Cihaz ağda yeniden görülürse yeni kayıt olarak tekrar eklenir (takma ad/not kaybolur).", "Sil");
      if (!sure) {
        return false;
      }
      try {
        await ankamon.io.Api.del("/network/devices", { ids: devices.map(d => d.id) });
        return true;
      } catch (e) {
        ankamon.ui.Dialog.error(e);
        return false;
      }
    },

    async scanNow() {
      try {
        await ankamon.io.Api.post("/network/scan", {});
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async scanServices(devices) {
      try {
        await ankamon.io.Api.post("/network/scan", { services: devices.map(d => d.id) });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    async scanShares(devices) {
      try {
        await ankamon.io.Api.post("/network/scan", { shares: devices.map(d => d.id) });
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    /**
     * Sol ağaçtaki ağ düğümünün sağ menüsü (yalnız network.manage).
     * @param onChange {Function} ağ değişince/silinince çağrılır
     */
    networkMenu(net, onChange) {
      const menu = new qx.ui.menu.Menu();
      const item = (label, handler) => {
        const b = new qx.ui.menu.Button(label);
        b.addListener("execute", handler);
        menu.add(b);
      };
      const patch = async body => {
        try {
          await ankamon.io.Api.patch("/network/networks/" + net.id, body);
          onChange();
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
      };
      item("⟳ Şimdi tara", () => this.scanNow());
      item("✎ Yeniden adlandır…", async () => {
        const name = await ankamon.ui.Dialog.prompt(
          `<b>${qx.bom.String.escape(net.cidr)}</b> ağının adı (ör. "Okul kablolu ağı"):`, net.name, "Kaydet", "Ağ adı");
        if (name !== null) { // null: vazgeçildi ya da boş bırakıldı
          patch({ name });
        }
      });
      item(net.scan_enabled ? "⏸ Bu ağı taramayı durdur" : "▸ Bu ağı taramaya başla", () => patch({ scan_enabled: !net.scan_enabled }));
      if (!net.attached) {
        menu.add(new qx.ui.menu.Separator());
        item("✕ Ağı ve cihaz kayıtlarını sil", async () => {
          const sure = await ankamon.ui.Dialog.confirm(
            `<b>${qx.bom.String.escape(this.networkLabel(net))}</b> ağı ve ${net.devices} cihaz kaydı silinsin mi?`, "Sil");
          if (sure) {
            try {
              await ankamon.io.Api.del("/network/networks/" + net.id);
              onChange();
            } catch (e) {
              ankamon.ui.Dialog.error(e);
            }
          }
        });
      }
      return menu;
    }
  }
});
