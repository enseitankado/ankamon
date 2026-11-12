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
 * Sistem ▸ Yedekler (yalnız yönetici; kullanıcı isteği 2026-11-12): Ankamon'da çalışan bütün yedeklemelerin kontrol
 * paneli — backend Api/BackupsApi.php.
 *  - Yedeklemeler: her yedek türünün planı (açık/kapalı, zamanlama, saklanan adet/süre), diskteki dosyaları, son
 *    sonucu; çift tıklama / "Düzenle" planı değiştirir, "Şimdi al" yedeği hemen aldırır (yedekleme servisi ~10 sn içinde).
 *  - Veri depoları: veritabanı ve /data altındaki her deponun hangi yedeğe girdiği. Yeni tablolar ve yeni /data dizinleri
 *    kendiliğinden yedeğe girer; tanımsız dizin uyarıyla görünür (bkz. backend Core\DataStores).
 * Yedek dosyalarının kendisi (listeleme, indirme, silme) Sistem ▸ Disk kullanımı ▸ Yedekler'de.
 */
qx.Class.define("ankamon.page.Backups", {
  extend: ankamon.page.Base,

  statics: {
    /** Tür → arayüz bilgisi; sıra tablodaki sıradır. "pre" yalnız bilgi (install.sh --update alır). */
    KINDS: [
      { key: "config", label: "Yapılandırma", scope: "Veritabanı (loglar ve sensör verisi hariç) + Grafana" },
      { key: "full", label: "Tam veritabanı", scope: "Bütün veritabanı — loglar ve sensör verisi dahil" },
      { key: "files", label: "Dosya depoları", scope: "/data altındaki dosyalar (TLS anahtarları, dosya yöneticisi, araçlar, ekran görüntüleri…)" },
      { key: "home", label: "Ev dizini yedekleri", scope: "Cihazlardan alınan ev dizini yedekleri (Yedekle/Geri al) — yalnız saklama süresi" },
      { key: "pre", label: "Güncelleme öncesi", scope: "install.sh --update'in güncellemeden hemen önce aldığı tam yedek (elle silinir)" }
    ],
    STORE_BACKUP: { config: "Yapılandırma", full: "Tam", files: "Dosya" },
    /** Tür başına kendiliğinden yenileme (sn): yedek sürerken sonuç gelsin diye. */
    POLL_MS: 5000
  },

  construct(user) {
    super(user, "Yedekler");
    this._addButton("Yenile", this.refresh);
    this.__editBtn = this._addButton("Düzenle…", () => this.__edit(this.__selectedKind()));
    this.__runBtn = this._addButton(`${ankamon.ui.Shell.ICON.backup} Şimdi al`, () => this.__run(this.__selectedKind()));
    this._addButton("Yedek dosyaları ▸", () => qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_PAGE, { diskUsage: "backups" }))
      .set({ toolTipText: "Yedek dosyalarını listeler, indirir, siler (Sistem ▸ Disk kullanımı ▸ Yedekler)" });

    this.__summary = new qx.ui.basic.Label("").set({ rich: true, wrap: true, textColor: "app-muted", selectable: true });
    this.add(this.__summary);

    this.__table = this._createTable([
      { id: "label", label: "Yedek", width: 170 },
      { id: "on", label: "Durum", width: 90 },
      { id: "plan", label: "Zamanlama", width: 190 },
      { id: "keep", label: "Saklanan", width: 120 },
      { id: "files", label: "Diskte", width: 150 },
      { id: "last", label: "Son yedek", width: 150 },
      { id: "result", label: "Son sonuç", width: 260 },
      { id: "scope", label: "Kapsam" }
    ], { prefsKey: "backups.kinds.columns" });
    // Süren yedekte dönen halka (bkz. ui.table.JobStateRenderer).
    this.__table.getTableColumnModel().setDataCellRenderer(this.__table.getTableModel().getColumnIndexById("result"),
      new ankamon.ui.table.JobStateRenderer(["… alınıyor"]));
    this.__table.addListener("cellDbltap", e => this.__edit(this.__kindAt(e.getRow())));
    this.__table.getSelectionModel().addListener("changeSelection", () => this.__updateButtons());
    this.__table.addListener("cellContextmenu", e => {
      const kind = this.__kindAt(e.getRow());
      if (!kind || kind === "pre") {
        this.__table.setContextMenu(null);
        return;
      }
      const menu = new qx.ui.menu.Menu();
      const run = new qx.ui.menu.Button(`${ankamon.ui.Shell.ICON.backup} Şimdi al`);
      run.addListener("execute", () => this.__run(kind));
      const edit = new qx.ui.menu.Button(`${ankamon.ui.Shell.ICON.edit} Düzenle…`);
      edit.addListener("execute", () => this.__edit(kind));
      menu.add(run);
      menu.add(edit);
      this.__table.setContextMenu(menu);
    });
    this.__table.set({ height: 190, minHeight: 150 });
    this.add(this.__table);

    this.add(new qx.ui.basic.Label("<b>Veri depoları</b> — Ankamon'un veriyi tuttuğu her yer ve hangi yedeğe girdiği").set({ rich: true }));
    this.__stores = this._createTable([
      { id: "store", label: "Depo", width: 190 },
      { id: "location", label: "Konum", width: 230 },
      { id: "backups", label: "Yedekte", width: 170, choices: true },
      { id: "note", label: "Açıklama" }
    ], { prefsKey: "backups.stores.columns", filterable: true });
    this.add(this.__stores, { flex: 1 });

    this.__timer = new qx.event.Timer(ankamon.page.Backups.POLL_MS);
    this.__timer.addListener("interval", () => {
      if (this.isSeeable()) {
        this.refresh();
      }
    });
    this.__timer.start();
  },

  destruct() {
    if (this.__timer) {
      this.__timer.stop();
      this.__timer.dispose();
    }
  },

  members: {
    __summary: null,
    __table: null,
    __stores: null,
    __timer: null,
    __data: null,
    __editBtn: null,
    __runBtn: null,

    async _refresh() {
      const data = await ankamon.io.Api.get("/backups");
      this.__data = data;
      const F = ankamon.util.Format;
      const p = data.policy;
      const st = data.status || {};
      const files = data.files || {};
      const fileText = k => {
        const f = files[k];
        return f && f.count ? `${f.count} ${k === "home" ? "görev" : "dosya"}, ${F.bytes(f.bytes)}` : "—";
      };
      const lastText = k => {
        const at = Math.max((st[k] && st[k].at) || 0, (files[k] && files[k].newest) || 0);
        return at ? `${F.dateTime(at * 1000)} (${F.ago(at)})` : "—";
      };
      const resultText = k => {
        if (st.running === k) {
          return "… alınıyor";
        }
        const s = st[k];
        if (!s || !s.at) {
          return k === "pre" ? "—" : "bu açılıştan beri çalışmadı";
        }
        return (s.ok ? "✓ " : "✗ HATA: ") + (s.message || "");
      };
      const plan = {
        config: [p.config.enabled, `${p.config.every_hours} saatte bir`, `son ${p.config.keep} yedek`],
        full: [p.full.enabled, `her gün ${p.full.at}`, `son ${p.full.keep} yedek`],
        files: [p.files.enabled, `her gün ${p.files.at}`, `son ${p.files.keep} yedek`],
        home: [true, "saatte bir temizlik", `${p.home.keep_hours} saat`],
        pre: [true, "her güncellemede (install.sh --update)", "elle silinir"]
      };
      this.__table.getTableModel().setData(ankamon.page.Backups.KINDS.map(k => [
        k.key, k.label, plan[k.key][0] ? "Açık" : "Kapalı", plan[k.key][1], plan[k.key][2],
        fileText(k.key), lastText(k.key), resultText(k.key), k.scope
      ]));
      const B = ankamon.page.Backups.STORE_BACKUP;
      const unknown = data.stores.filter(s => s.unknown);
      this.__stores.getTableModel().setData(data.stores.map((s, i) => [
        i, s.store, s.location, s.backups.length ? s.backups.map(b => B[b] || b).join(" + ") : "Yedek dışı", s.note
      ]));
      const errors = ["config", "full", "files"].filter(k => st[k] && st[k].at && !st[k].ok);
      const esc = qx.bom.String.escape;
      this.__summary.setValue(
        `Yedekler <b>${esc(data.dir)}</b> dizinine alınır (sunucunun diski; başka bir diske/makineye kopyalanması önerilir). ` +
        (st.running ? `<b>Şu an alınıyor: ${esc(this.__label(st.running))}.</b> ` : "") +
        (errors.length ? `<span style="color:#c42b1c"><b>Hatalı yedek: ${esc(errors.map(k => this.__label(k)).join(", "))}</b></span> ` : "") +
        (unknown.length ? `<span style="color:#b26b00">Tanımsız veri deposu: ${esc(unknown.map(s => s.location).join(", "))} (dosya yedeğine giriyor).</span> ` : "") +
        "Çift tıklama ya da Düzenle: planı değiştir · Şimdi al: yedeği hemen aldır.");
      this.__updateButtons();
    },

    __label(key) {
      const kind = ankamon.page.Backups.KINDS.find(k => k.key === key);
      return kind ? kind.label : key;
    },

    __kindAt(row) {
      return row === null || row === undefined ? null : this.__table.getTableModel().getValue(0, row);
    },

    __selectedKind() {
      let kind = null;
      this.__table.getSelectionModel().iterateSelection(r => { kind = kind || this.__kindAt(r); });
      return kind;
    },

    __updateButtons() {
      const kind = this.__selectedKind();
      const usable = !!kind && kind !== "pre";
      this.__editBtn.setEnabled(usable);
      this.__runBtn.setEnabled(usable && !(this.__data && this.__data.status && this.__data.status.running === kind));
    },

    async __run(kind) {
      if (!kind || kind === "pre") {
        return;
      }
      try {
        await ankamon.io.Api.post("/backups/run", { kind });
        this.__summary.setValue(`<b>${qx.bom.String.escape(this.__label(kind))}</b> yedeği istendi — yedekleme servisi birkaç saniye içinde başlar.`);
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    },

    /** Bir türün plan penceresi (yalnız o türün alanları); kaydedince bütün plan gönderilir. */
    __edit(kind) {
      if (!kind || kind === "pre" || !this.__data) {
        return;
      }
      const D = ankamon.ui.Dialog;
      const p = this.__data.policy[kind];
      const def = this.__data.defaults[kind];
      const lim = this.__data.limits[kind] || {};
      const win = D.window(`Yedek planı — ${this.__label(kind)}`, 460);
      win.add(new qx.ui.basic.Label(qx.bom.String.escape(ankamon.page.Backups.KINDS.find(k => k.key === kind).scope)).set({
        rich: true, wrap: true, textColor: "app-muted"
      }));
      const form = new ankamon.ui.Form();
      const spin = (key, label, value, [min, max]) => form.addField(key, label, new qx.ui.form.Spinner(min, value, max));
      if ("enabled" in p) {
        form.check("enabled", "Otomatik yedek açık", p.enabled);
      }
      if ("every_hours" in p) {
        spin("every_hours", "Kaç saatte bir", p.every_hours, lim.every_hours);
      }
      if ("at" in p) {
        form.text("at", "Her gün saat (SS:DD)", p.at, "03:30");
      }
      if ("keep" in p) {
        spin("keep", "Saklanacak yedek sayısı", p.keep, lim.keep);
      }
      if ("keep_hours" in p) {
        spin("keep_hours", "Saklama süresi (saat)", p.keep_hours, lim.keep_hours);
      }
      win.add(form);
      win.add(new qx.ui.basic.Label("Kurulum varsayılanı: " + qx.bom.String.escape(Object.entries(def)
        .map(([k, v]) => `${{ enabled: "açık", every_hours: "saat aralığı", at: "saat", keep: "adet", keep_hours: "saat" }[k] || k}: ${v === true ? "evet" : v === false ? "hayır" : v}`)
        .join(", "))).set({ rich: true, wrap: true, textColor: "app-muted" }));
      const save = new qx.ui.form.Button("Kaydet");
      const cancel = new qx.ui.form.Button("Vazgeç");
      cancel.addListener("execute", () => win.close());
      save.addListener("execute", async () => {
        const values = form.values();
        if ("at" in values && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(values.at)) {
          D.alert("Saat SS:DD biçiminde olmalı (ör. 03:30).", "Geçersiz saat");
          return;
        }
        try {
          await ankamon.io.Api.put("/backups/policy", { [kind]: values });
          win.close();
          this.refresh();
        } catch (e) {
          D.error(e);
        }
      });
      D.buttons(win, [save, cancel]);
      win.open();
    }
  }
});
