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
 * Disk editörü (kullanıcı isteği 2026-11-23: "Hazır komutlar"da GParted benzeri arayüz) — tek cihaz, cihaz açıkken.
 *
 * GParted'in düzeni: üstte disk seçimi ve işlem düğmeleri, ortada diskin grafik çubuğu (bölümler orantılı, dosya sistemi
 * renkleriyle; dolu kısım koyu), altında bölüm tablosu, en altta bekleyen işlemler. İşlemler hemen yapılmaz: kuyruğa
 * alınır, çubuk/tablo "uygulanınca" hâlini gösterir (ui.disk.DiskModel.simulate); Geri al / Temizle / Uygula. Uygula,
 * kuyruğu cihaza tek görev olarak gönderir (hazır işlem disk-editor-apply — canlı çıktı penceresi), bitince disk yeniden
 * okunur. Okuma da bir görevdir (disk-editor). GParted'in kendisi kurulmaz: cihazda parted/sfdisk/mkfs/resize2fs/
 * ntfsresize/btrfs… doğrudan kullanılır (GParted de bunları çağırır); cihazda çalışırken yapılamayacak işlemler (bağlı
 * bölümü silme/küçültme/taşıma…) düğmede soluk, nedeni ipucunda.
 *
 * Yetki: hazır işlemin yetkisi ("shell" — web terminal/serbest komut ile aynı düzey).
 */
qx.Class.define("ankamon.ui.disk.DiskEditor", {
  extend: qx.ui.window.Window,

  /** @param device {Map} {id, label|hostname|ip, online} */
  construct(device) {
    const name = device.label || device.hostname || device.ip;
    super(`Disk editörü — ${name}`);
    this.__device = device;
    this.__ops = [];
    const root = qx.core.Init.getApplication().getRoot();
    const bounds = root.getBounds() || { width: 1200, height: 760 };
    this.set({ layout: new qx.ui.layout.VBox(6), contentPadding: 8, showMaximize: true, allowMaximize: true,
      width: Math.min(1120, bounds.width - 30), height: Math.min(700, bounds.height - 30) });

    // Üst çubuk: disk seçimi + işlemler
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(4).set({ alignY: "middle" }));
    this.__diskBox = new qx.ui.form.SelectBox().set({ width: 300 });
    this.__diskBox.addListener("changeSelection", () => this.__selectDisk());
    bar.add(this.__diskBox);
    const devMenu = new qx.ui.menu.Menu();
    const mklabel = new qx.ui.menu.Button("Bölüm tablosu oluştur…");
    mklabel.addListener("execute", () => this.__mklabelDialog());
    devMenu.add(mklabel);
    const reload = new qx.ui.menu.Button("Diskleri yeniden oku");
    reload.addListener("execute", () => this.reload());
    devMenu.add(reload);
    this.__mklabelBtn = mklabel;
    bar.add(new qx.ui.form.MenuButton("Aygıt", null, devMenu).set({ padding: [2, 8] }));
    bar.add(new qx.ui.core.Spacer(8));
    this.__buttons = {};
    const B = (id, label, tip, fn) => {
      const b = new qx.ui.form.Button(label).set({ padding: [2, 8], toolTipText: tip });
      b.setUserData("tip", tip);
      b.addListener("execute", fn, this);
      this.__buttons[id] = b;
      bar.add(b);
      return b;
    };
    B("create", "＋ Yeni", "Seçili boş alanda yeni bölüm", () => this.__createDialog());
    B("delete", "Sil", "Seçili bölümü sil", () => this.__queue({ op: "delete" }, "Sil"));
    B("resize", "Boyutlandır / Taşı", "Bölümü büyüt, küçült ya da taşı", () => this.__resizeDialog());
    B("format", "Biçimlendir", "Seçili bölümü başka bir dosya sistemiyle biçimlendir (veri silinir)", () => this.__formatDialog());
    const more = new qx.ui.menu.Menu();
    this.__moreItems = {};
    [["label", "Etiket…", () => this.__labelDialog()], ["name", "Bölüm adı…", () => this.__nameDialog()],
      ["flags", "Bayraklar…", () => this.__flagsDialog()], ["check", "Denetle (onar)", () => this.__queue({ op: "check" }, "Denetle")],
      ["mount", "Bağla", () => this.__queue({ op: "mount" }, "Bağla")], ["umount", "Ayır", () => this.__queue({ op: "umount" }, "Ayır")],
      ["uuid", "Yeni UUID", () => this.__queue({ op: "uuid" }, "Yeni UUID")], ["info", "Bilgi", () => this.__info()]]
      .forEach(([id, label, fn]) => {
        const item = new qx.ui.menu.Button(label);
        item.addListener("execute", fn);
        this.__moreItems[id] = item;
        more.add(item);
      });
    const moreBtn = new qx.ui.form.MenuButton("Bölüm", null, more).set({ padding: [2, 8], toolTipText: "Etiket, ad, bayraklar, denetle, bağla/ayır, UUID, bilgi" });
    bar.add(moreBtn);
    this.__moreBtn = moreBtn;
    bar.add(new qx.ui.core.Spacer(), { flex: 1 });
    this.__undoBtn = B("undo", "↶ Geri al", "Son işlemi kuyruktan çıkar", () => this.__undo());
    this.__clearBtn = B("clear", "Temizle", "Bütün bekleyen işlemleri kaldır", () => this.__setOps([]));
    this.__applyBtn = B("apply", "✓ Uygula", "Bekleyen işlemleri cihazda sırayla uygula", () => this.__apply());
    this.add(bar);

    this.__diskInfo = new qx.ui.basic.Label("").set({ rich: true, textColor: "app-muted" });
    this.add(this.__diskInfo);

    // Grafik çubuk
    this.__graph = new qx.ui.embed.Html("").set({ height: 74, minHeight: 74, allowGrowY: false, overflowX: "hidden", overflowY: "hidden" });
    this.__graph.addListener("appear", () => this.__graph.getContentElement().getDomElement().addEventListener("click", e => {
      const el = e.target.closest("[data-i]");
      if (el) {
        this.__select(parseInt(el.getAttribute("data-i"), 10));
      }
    }));
    this.add(this.__graph);

    // Bölüm tablosu
    const model = new qx.ui.table.model.Simple();
    model.setColumns(["", "Bölüm", "Ad", "Dosya sistemi", "Etiket", "Bağlama noktası", "Boyut", "Kullanılan", "Kullanılmayan", "Bayraklar"]);
    const table = this.__table = new qx.ui.table.Table(model, { tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj) }).set({
      statusBarVisible: false, showCellFocusIndicator: false, rowHeight: 24 });
    table.setUserData("exportTitle", `Disk editörü — ${name}`);
    const cm = table.getTableColumnModel();
    cm.setDataCellRenderer(0, new qx.ui.table.cellrenderer.Html());
    const rb = cm.getBehavior();
    [26, 130, 110, 120, 110, 170, 90, 90, 100, 150].forEach((w, i) => rb.setWidth(i, w));
    table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.SINGLE_SELECTION);
    table.getSelectionModel().addListener("changeSelection", () => {
      const sel = table.getSelectionModel().getSelectedRanges()[0];
      this.__select(sel ? sel.minIndex : -1, true);
    });
    this.add(table, { flex: 1 });

    // Bekleyen işlemler
    this.__opsLabel = new qx.ui.basic.Label("Bekleyen işlem yok").set({ font: "bold" });
    this.add(this.__opsLabel);
    this.__opsList = new qx.ui.form.List().set({ height: 96 });
    this.add(this.__opsList);

    this.addListener("close", () => qx.event.Timer.once(() => this.destroy(), null, 0));
    this.addListener("beforeClose", e => {
      if (this.__ops.length && !this.__closing) {
        e.preventDefault();
        ankamon.ui.Dialog.confirm(`${this.__ops.length} işlem uygulanmadı. Pencere kapatılsın mı? (işlemler atılır)`, "Kapat").then(ok => {
          if (ok) {
            this.__closing = true;
            this.close();
          }
        });
      }
    });
    this.addListenerOnce("appear", () => this.center());
    root.add(this);
  },

  statics: {
    /** Komut çalıştır / terminal Hazır komutlar ▸ Disk editörü. */
    open(device) {
      if (device.online === false) {
        ankamon.ui.Dialog.alert("Disk editörü yalnız açık (çevrimiçi) cihazda çalışır.");
        return null;
      }
      const win = new ankamon.ui.disk.DiskEditor(device);
      win.open();
      win.reload();
      return win;
    },

    /** Görevin çıktısındaki ANKAMON_DISK satırları → JSON (gzip+base64). */
    async decode(output) {
      const lines = String(output || "").split("\n");
      const blob = lines.filter(l => l.startsWith("ANKAMON_DISK:")).map(l => l.slice(13).trim()).join("");
      if (!blob || !lines.some(l => l.startsWith("ANKAMON_DISK_END"))) {
        throw new Error("Cihazdan disk bilgisi alınamadı.");
      }
      const bin = Uint8Array.from(atob(blob), c => c.charCodeAt(0));
      const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
  },

  members: {
    __device: null,
    __scan: null,
    __base: null,
    __disk: null,
    __ops: null,
    __sel: -1,
    __closing: false,
    __diskBox: null,
    __diskInfo: null,
    __graph: null,
    __table: null,
    __opsLabel: null,
    __opsList: null,
    __buttons: null,
    __moreItems: null,
    __moreBtn: null,
    __mklabelBtn: null,
    __undoBtn: null,
    __clearBtn: null,
    __applyBtn: null,

    /** Diskleri cihazdan (yeniden) okur: disk-editor görevi, sonucu beklenir. */
    async reload() {
      this.__diskInfo.setValue(ankamon.ui.JobSpinner.label("Diskler okunuyor…"));
      this.setEnabled(false);
      try {
        const id = (await ankamon.io.Api.post("/jobs", { type: "action", action: "disk-editor", device_ids: [this.__device.id] })).id;
        let target = null;
        for (let i = 0; i < 240; i++) {
          const res = await ankamon.io.Api.get(`/jobs/${id}`);
          target = ((res.job && res.job.targets) || [])[0];
          if (target && !["queued", "running"].includes(target.status)) {
            break;
          }
          await new Promise(r => setTimeout(r, 500));
        }
        if (!target || target.status !== "ok") {
          throw new Error((target && target.output ? target.output.split("\n").filter(Boolean).slice(-2).join(" ") : "") || "cihaza ulaşılamadı");
        }
        this.__scan = await ankamon.ui.disk.DiskEditor.decode(target.output);
      } catch (e) {
        this.setEnabled(true);
        this.__diskInfo.setValue(`<span style="color:#c5221f">Diskler okunamadı: ${qx.bom.String.escape(e.message || String(e))}</span>`);
        return;
      }
      this.setEnabled(true);
      const keep = this.__base ? this.__base.path : null;
      this.__diskBox.removeAll().forEach(w => w.dispose());
      const F = ankamon.util.Format;
      this.__scan.disks.forEach(d => {
        this.__diskBox.add(new qx.ui.form.ListItem(`${d.path} — ${d.model || "disk"} (${F.bytes(d.size)})`, null, d));
      });
      const again = this.__diskBox.getChildren().find(i => i.getModel().path === keep);
      if (again) {
        this.__diskBox.setSelection([again]);
      }
      this.__ops = [];
      this.__selectDisk();
    },

    __selectDisk() {
      const item = this.__diskBox.getSelection()[0];
      this.__base = item ? item.getModel() : null;
      this.__setOps(this.__base && this.__ops.length && this.__ops[0].disk === this.__base.path ? this.__ops : []);
    },

    __setOps(ops) {
      this.__ops = ops;
      this.__render();
    },

    __undo() {
      this.__setOps(this.__ops.slice(0, -1));
    },

    /** Ön izlemeyi kurar: bilgi satırı, çubuk, tablo, işlem listesi, düğmeler. */
    __render() {
      const M = ankamon.ui.disk.DiskModel;
      const F = ankamon.util.Format;
      const base = this.__base;
      if (!base) {
        this.__disk = null;
        this.__diskInfo.setValue(this.__scan ? "Cihazda disk bulunamadı." : "");
        this.__graph.setHtml("");
        this.__table.getTableModel().setData([]);
        this.__syncButtons();
        return;
      }
      const disk = this.__disk = M.simulate(base, this.__ops);
      const tableName = { gpt: "GPT", msdos: "MBR (msdos)", none: "bölüm tablosu yok", unknown: "tanınmayan" }[disk.table] || disk.table;
      this.__diskInfo.setValue(qx.bom.String.escape(
        `${disk.model || "Disk"} · ${F.bytes(disk.size)} · ${disk.sectors} sektör × ${disk.sector} B · ${tableName}` +
        (disk.transport ? ` · ${disk.transport.toUpperCase()}` : "") + (disk.serial ? ` · seri ${disk.serial}` : "")) +
        (base.system ? " · <b>sistem diski</b> (kullanımdaki bölümlerde yalnız çevrimiçi işlemler)" : "") +
        (base.error ? ` · <span style="color:#c5221f">${qx.bom.String.escape(base.error)}</span>` : ""));
      this.__graph.setHtml(this.__graphHtml(disk));
      const rows = disk.parts.map(p => {
        const bytes = M.sizeBytes(disk, p);
        const swatch = `<span style="display:inline-block;width:12px;height:12px;border:1px solid #555;background:${M.color(p)}"></span>`;
        if (p.kind === "free") {
          return [swatch, p.logical ? "ayrılmamış (genişletilmiş içinde)" : "ayrılmamış", "", "", "", "", F.bytes(bytes), "", "", ""];
        }
        const label = p.pending ? `${p.path || "yeni bölüm"} ✱` : p.path || "";
        const used = p.used !== null && p.used !== undefined ? p.used : null;
        return [swatch, label + (p.kind === "logical" ? " (mantıksal)" : p.kind === "extended" ? " (genişletilmiş)" : ""),
          p.name || "", p.kind === "extended" ? "genişletilmiş" : M.fsName(p.fs), p.label || "",
          (p.mounts || []).join(", ") + (p.swap ? "[takas etkin]" : ""), F.bytes(bytes),
          used === null ? "—" : F.bytes(used), used === null ? "—" : F.bytes(Math.max(0, bytes - used)), (p.flags || []).join(", ")];
      });
      this.__table.getTableModel().setData(rows);
      if (this.__sel >= rows.length) {
        this.__sel = -1;
      }
      if (this.__sel >= 0) {
        this.__table.getSelectionModel().setSelectionInterval(this.__sel, this.__sel);
      }
      this.__opsList.removeAll().forEach(w => w.dispose());
      this.__ops.forEach((op, i) => this.__opsList.add(new qx.ui.form.ListItem(`${i + 1}. ${op.title}`)));
      this.__opsLabel.setValue(this.__ops.length ? `${this.__ops.length} işlem bekliyor — Uygula ile cihazda sırayla çalışır` : "Bekleyen işlem yok");
      this.__syncButtons();
    },

    /** GParted benzeri çubuk: bölümler orantılı (en az %3), genişletilmiş içinde mantıksal bölümler; dolu kısım koyu. */
    __graphHtml(disk) {
      const M = ankamon.ui.disk.DiskModel;
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const top = disk.parts.map((p, i) => ({ p, i })).filter(({ p }) => !(p.kind === "logical" || (p.kind === "free" && p.logical)));
      const weight = p => Math.max(3, ((p.end - p.start + 1) / disk.sectors) * 100);
      const box = (p, i) => {
        const bytes = M.sizeBytes(disk, p);
        const usedPct = p.used ? Math.min(100, (p.used / bytes) * 100) : 0;
        const sel = i === this.__sel ? "outline:3px solid #2a6dd8;outline-offset:-3px;" : "";
        const title = p.kind === "free" ? "ayrılmamış" : `${p.path || "yeni"}${p.label ? " — " + p.label : ""}`;
        const text = `<div style="position:relative;padding:2px 4px;font-size:11px;line-height:13px;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}<br>${esc(F.bytes(bytes))}</div>`;
        const fill = p.kind === "free" ? "" : `<div style="position:absolute;left:0;top:0;bottom:0;width:${usedPct}%;background:#F8F8BA"></div>`;
        return `<div data-i="${i}" title="${esc(title)} · ${esc(M.fsName(p.fs))} · ${esc(F.bytes(bytes))}" style="cursor:pointer;flex:${weight(p)} 1 0;min-width:0;` +
          `position:relative;box-sizing:border-box;border:3px solid ${M.color(p)};background:${p.kind === "free" ? "#e8e8e8" : "#fff"};${sel}${p.pending ? "border-style:dashed;" : ""}">${fill}${text}</div>`;
      };
      const html = top.map(({ p, i }) => {
        if (p.kind !== "extended") {
          return box(p, i);
        }
        const inner = disk.parts.map((q, j) => ({ q, j })).filter(({ q }) => q.kind === "logical" || (q.kind === "free" && q.logical))
          .map(({ q, j }) => box(q, j)).join("");
        const sel = i === this.__sel ? "outline:3px solid #2a6dd8;outline-offset:-3px;" : "";
        return `<div data-i="${i}" title="genişletilmiş bölüm" style="cursor:pointer;flex:${weight(p)} 1 0;min-width:0;display:flex;gap:2px;padding:3px;box-sizing:border-box;` +
          `border:3px solid ${M.COLOR_EXTENDED};background:#f4feff;${sel}">${inner}</div>`;
      }).join("");
      return `<div style="display:flex;gap:2px;height:68px;padding:2px;box-sizing:border-box">${html}</div>`;
    },

    __select(i, fromTable) {
      this.__sel = i;
      if (!fromTable && i >= 0) {
        this.__table.getSelectionModel().setSelectionInterval(i, i);
      }
      if (this.__disk) {
        this.__graph.setHtml(this.__graphHtml(this.__disk));
      }
      this.__syncButtons();
    },

    __part() {
      return this.__disk && this.__sel >= 0 ? this.__disk.parts[this.__sel] || null : null;
    },

    __syncButtons() {
      const M = ankamon.ui.disk.DiskModel;
      const part = this.__part();
      const tools = (this.__scan && this.__scan.tools) || {};
      const set = (w, why) => w.set({ enabled: !!part && !why, toolTipText: why || w.getUserData("tip") || null });
      Object.entries(this.__buttons).forEach(([id, b]) => {
        if (["undo", "clear", "apply"].includes(id)) {
          b.setEnabled(this.__ops.length > 0);
          return;
        }
        set(b, part ? M.why(this.__disk, part, id, tools) : "Önce bir bölüm ya da boş alan seçin.");
      });
      Object.entries(this.__moreItems).forEach(([id, item]) => {
        item.setEnabled(!!part && part.kind !== "free" && (id === "info" || !M.why(this.__disk, part, id, tools)));
        item.setToolTipText(part && id !== "info" ? M.why(this.__disk, part, id, tools) : null);
      });
      this.__moreBtn.setEnabled(!!part && part.kind !== "free");
      this.__mklabelBtn.setEnabled(!!this.__disk && !this.__disk.busy);
      this.__mklabelBtn.setToolTipText(this.__disk && this.__disk.busy ? "Diskte kullanımdaki bölüm var — bölüm tablosu yeniden oluşturulamaz." : null);
    },

    /** Seçili bölüme işlem ekler (başlangıç sektörü ve beklenen dosya sistemiyle). */
    __queue(op, verb) {
      const part = this.__part();
      if (!part) {
        return;
      }
      const name = part.path || "yeni bölüm";
      const full = Object.assign({ disk: this.__base.path, start: part.start, fs_expect: part.fs || "",
        title: `${verb}: ${name}${part.label ? " (" + part.label + ")" : ""}` }, op);
      this.__setOps(this.__ops.concat(full));
    },

    /** Sayı + birim (MiB) alanı. */
    __mib(value, min, max) {
      return new qx.ui.form.Spinner(min, value, max).set({ width: 130, singleStep: 1, pageStep: 100 });
    },

    __dialog(caption, build, onOk, okLabel) {
      const win = ankamon.ui.Dialog.window(caption, 460);
      const form = new ankamon.ui.Form();
      const extra = build(form, win) || null;
      win.add(form);
      if (extra) {
        win.add(extra);
      }
      const cancel = new qx.ui.form.Button("Vazgeç");
      cancel.addListener("execute", () => win.close());
      const ok = new qx.ui.form.Button(okLabel || "Kuyruğa ekle");
      ok.addListener("execute", () => {
        const err = onOk(form.values(), form);
        if (err) {
          ankamon.ui.Dialog.alert(err);
          return;
        }
        win.close();
      });
      ankamon.ui.Dialog.buttons(win, [cancel, ok]);
      win.open();
    },

    __fsOptions(withNone) {
      const M = ankamon.ui.disk.DiskModel;
      return M.formats((this.__scan && this.__scan.tools) || {}).filter(f => withNone || f !== "none")
        .map(f => ({ value: f, label: M.fsName(f) }));
    },

    __createDialog() {
      const M = ankamon.ui.disk.DiskModel;
      const disk = this.__disk;
      const free = this.__part();
      const can = M.creatable(disk, free);
      if (!free || free.kind !== "free" || !can.ok) {
        return;
      }
      const a = M.align(disk);
      // Mantıksal bölüm boşluğun 1 MiB sonrasından başlar (önündeki EBR'ye yer — GParted gibi).
      const first = Math.ceil((free.start + (free.logical ? 1 : 0)) / a) * a;
      const maxMib = Math.floor((free.end - first + 1) / a);
      if (maxMib < 1) {
        ankamon.ui.Dialog.alert("Bu boşluk bölüm için çok küçük.");
        return;
      }
      this.__dialog("Yeni bölüm", form => {
        form.addField("before", "Önündeki boşluk (MiB)", this.__mib(0, 0, maxMib - 1));
        form.addField("size", "Boyut (MiB)", this.__mib(maxMib, 1, maxMib));
        if (can.kinds.length > 1 || can.kinds[0] !== "primary") {
          form.select("kind", "Bölüm türü", can.kinds.map(k => ({ value: k, label: { primary: "Birincil", extended: "Genişletilmiş", logical: "Mantıksal" }[k] })), can.kinds[0]);
        }
        form.select("fs", "Dosya sistemi", this.__fsOptions(true), "ext4");
        form.text("label", "Etiket");
        if (disk.table === "gpt") {
          form.text("name", "Bölüm adı (GPT)");
        }
        return new qx.ui.basic.Label(`Boşluk: ${maxMib} MiB. Bölüm 1 MiB sınırına hizalanır.`).set({ textColor: "app-muted" });
      }, v => {
        const before = parseInt(v.before, 10) || 0;
        const size = parseInt(v.size, 10) || 0;
        if (before + size > maxMib || size < 1) {
          return `Önündeki boşluk + boyut en çok ${maxMib} MiB olabilir.`;
        }
        const start = first + before * a;
        const end = before + size === maxMib ? free.end : start + size * a - 1;   // boşluğun tamamı: sona kadar
        const kind = v.kind || can.kinds[0];
        const fs = kind === "extended" ? "none" : v.fs;
        this.__setOps(this.__ops.concat({ op: "create", disk: this.__base.path, newStart: start, end: Math.min(end, free.end), kind, fs,
          label: v.label || "", name: v.name || "",
          title: `Yeni ${kind === "extended" ? "genişletilmiş bölüm" : (kind === "logical" ? "mantıksal " : "") + "bölüm"}: ${size} MiB` +
            (kind === "extended" ? "" : `, ${M.fsName(fs)}`) + (v.label ? ` "${v.label}"` : "") }));
        return null;
      });
    },

    __resizeDialog() {
      const M = ankamon.ui.disk.DiskModel;
      const disk = this.__disk;
      const part = this.__part();
      const L = M.resizeLimits(disk, part);
      const a = M.align(disk);
      const cur = Math.round(L.size / a);
      const beforeNow = Math.round((part.start - L.minStart) / a);
      const total = Math.floor((L.maxEnd - L.minStart + 1) / a);
      const minMib = Math.max(1, Math.ceil(L.minSize / a));
      const maxMib = Math.floor(L.maxSize / a);
      this.__dialog(`Yeniden boyutlandır / Taşı — ${part.path || "yeni bölüm"}`, form => {
        const before = form.addField("before", "Önündeki boşluk (MiB)", this.__mib(beforeNow, 0, L.canMove ? Math.max(0, total - minMib) : beforeNow));
        before.setEnabled(L.canMove);
        form.addField("size", "Yeni boyut (MiB)", this.__mib(cur, minMib, maxMib));
        const notes = [`Şu an ${cur} MiB · en az ${minMib} · en çok ${maxMib} MiB`];
        if (!L.canMove) {
          notes.push("Bağlı bölüm taşınamaz (yalnız sonu değişir).");
        }
        if (!L.canShrink) {
          notes.push("Bu dosya sistemi şu durumda küçültülemez.");
        }
        if (!L.canGrow) {
          notes.push("Bu dosya sistemi şu durumda büyütülemez.");
        }
        notes.push("Taşıma, verinin tamamını kopyalar — büyük bölümde uzun sürer.");
        return new qx.ui.basic.Label(notes.join("<br>")).set({ rich: true, textColor: "app-muted" });
      }, v => {
        const before = parseInt(v.before, 10) || 0;
        const size = parseInt(v.size, 10) || 0;
        if (size < minMib || size > maxMib) {
          return `Boyut ${minMib}–${maxMib} MiB arasında olmalı.`;
        }
        const start = L.canMove ? L.minStart + before * a : part.start;
        const end = start + size * a - 1;
        if (end > L.maxEnd) {
          return "Bölüm, arkasındaki boşluğa sığmıyor — önündeki boşluğu ya da boyutu azaltın.";
        }
        if (start === part.start && end === part.end) {
          return "Değişiklik yok.";
        }
        const moved = start !== part.start;
        this.__queue({ op: "resize", new_start: start, new_end: end },
          `${moved ? "Taşı/boyutlandır" : "Boyutlandır"} (${cur} → ${size} MiB${moved ? ", taşınır" : ""})`);
        return null;
      });
    },

    __formatDialog() {
      const part = this.__part();
      this.__dialog(`Biçimlendir — ${part.path || "yeni bölüm"}`, form => {
        form.select("fs", "Dosya sistemi", this.__fsOptions(true), part.fs && part.fs !== "none" ? part.fs : "ext4");
        form.text("label", "Etiket", part.label || "");
        return new qx.ui.basic.Label("Bölümdeki bütün veri silinir.").set({ textColor: "app-warn" });
      }, v => {
        this.__queue({ op: "format", fs: v.fs, label: v.label || "" }, `Biçimlendir → ${ankamon.ui.disk.DiskModel.fsName(v.fs)}`);
        return null;
      });
    },

    __labelDialog() {
      const part = this.__part();
      const fs = ankamon.ui.disk.DiskModel.FS[part.fs] || {};
      this.__dialog(`Etiket — ${part.path || "yeni bölüm"}`, form => {
        form.text("label", "Dosya sistemi etiketi", part.label || "", fs.max ? `en çok ${fs.max} karakter` : "");
      }, v => {
        if (fs.max && v.label.length > fs.max) {
          return `Bu dosya sisteminde etiket en çok ${fs.max} karakter.`;
        }
        this.__queue({ op: "label", label: v.label }, `Etiket "${v.label}"`);
        return null;
      });
    },

    __nameDialog() {
      const part = this.__part();
      this.__dialog(`Bölüm adı — ${part.path || "yeni bölüm"}`, form => {
        form.text("name", "GPT bölüm adı", part.name || "");
      }, v => {
        this.__queue({ op: "name", name: v.name }, `Bölüm adı "${v.name}"`);
        return null;
      });
    },

    __flagsDialog() {
      const M = ankamon.ui.disk.DiskModel;
      const part = this.__part();
      const flags = M.FLAGS[this.__disk.table] || [];
      this.__dialog(`Bayraklar — ${part.path || "yeni bölüm"}`, form => {
        flags.forEach(f => form.check(f, f, (part.flags || []).includes(f)));
      }, v => {
        const ops = flags.filter(f => !!v[f] !== (part.flags || []).includes(f));
        if (!ops.length) {
          return "Değişiklik yok.";
        }
        ops.forEach(f => this.__queue({ op: "flag", flag: f, on: !!v[f] }, `Bayrak ${f} ${v[f] ? "aç" : "kapat"}`));
        return null;
      });
    },

    __mklabelDialog() {
      const base = this.__base;
      if (!base) {
        return;
      }
      this.__dialog(`Bölüm tablosu oluştur — ${base.path}`, form => {
        form.select("table", "Tür", [{ value: "gpt", label: "GPT (önerilen)" }, { value: "msdos", label: "MBR (msdos)" }], "gpt");
        return new qx.ui.basic.Label("Diskteki BÜTÜN bölümler ve veriler silinir.").set({ textColor: "app-warn", font: "bold" });
      }, v => {
        this.__setOps(this.__ops.concat({ op: "mklabel", disk: base.path, table: v.table,
          title: `Bölüm tablosu oluştur: ${v.table === "gpt" ? "GPT" : "MBR"} (${base.path} silinir)` }));
        return null;
      });
    },

    __info() {
      const M = ankamon.ui.disk.DiskModel;
      const F = ankamon.util.Format;
      const disk = this.__disk;
      const p = this.__part();
      const rows = [["Aygıt", p.path || "(uygulanınca oluşur)"], ["Tür", { primary: "birincil", logical: "mantıksal", extended: "genişletilmiş" }[p.kind] || p.kind],
        ["Dosya sistemi", M.fsName(p.fs)], ["Etiket", p.label || "—"], ["Ad (GPT)", p.name || "—"], ["UUID", p.uuid || "—"],
        ["Boyut", `${F.bytes(M.sizeBytes(disk, p))} (${p.end - p.start + 1} sektör)`], ["Başlangıç / bitiş", `${p.start} – ${p.end}. sektör`],
        ["Kullanılan", p.used !== null && p.used !== undefined ? F.bytes(p.used) : "—"], ["Bağlama noktası", (p.mounts || []).join(", ") || (p.swap ? "takas (etkin)" : "—")],
        ["Bayraklar", (p.flags || []).join(", ") || "—"]];
      ankamon.ui.Dialog.alert("<table>" + rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;opacity:.75">${k}</td><td>${qx.bom.String.escape(String(v))}</td></tr>`).join("") + "</table>",
        `Bölüm bilgisi — ${p.path || "yeni bölüm"}`);
    },

    async __apply() {
      if (!this.__ops.length) {
        return;
      }
      const esc = qx.bom.String.escape;
      const ok = await ankamon.ui.Dialog.confirm(`<b>${this.__ops.length} işlem</b> ${esc(this.__base.path)} üzerinde sırayla uygulanacak:<br>` +
        this.__ops.map((o, i) => `${i + 1}. ${esc(o.title)}`).join("<br>") +
        "<br><br><b>Bölüm işlemleri veri kaybına yol açabilir; önemli verileri önce yedekleyin.</b> İlk hatada durulur.", "Uygula");
      if (!ok) {
        return;
      }
      const body = JSON.stringify(ankamon.ui.disk.DiskModel.payload(this.__base, this.__ops));
      const b64 = btoa(unescape(encodeURIComponent(body)));
      const name = this.__device.label || this.__device.hostname || this.__device.ip;
      this.__setOps([]);
      ankamon.ui.Jobs.show(ankamon.io.Api.post("/jobs", { type: "action", action: "disk-editor-apply", device_ids: [this.__device.id],
        values: { DISK_OPS: b64 } }).then(res => res.id), `Disk editörü — ${name}`, { onDone: () => {
        if (!this.isDisposed()) {
          this.reload();
        }
      } });
    }
  }
});
