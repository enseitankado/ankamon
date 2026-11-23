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
 * Genel bakış: cihaz sayıları, son 24 saatin log yoğunluğu, son hatalar ve görevler. Her bilgi
 * kartının ipucu yalnız kendi konusunu, güncel değerlerle anlatır (bkz. __tip).
 *
 * Kartların altında yan yana (kullanıcı isteği 2026-11-06), her biri yalnız yetkisi olana:
 *  - "Toplam disk kullanımı" (yetki "logs.manage"): Disk kullanımı ▸ Özet'in daire grafiği, küçük. Hesabı yavaş
 *    olduğundan tampondan çizilir; tampon CACHE_MS'ten eskiyse arkada yeniden hesaplanır (bkz. ui.DiskUsageSummary).
 *    Dilime/satıra tıklama o veri türünün sekmesini açar.
 *  - "Sağlık — acil ve dikkat gerektiren bulgular" (yetki "anomalies" ya da "diagnose"): Sağlık ▸ Durum'daki Acil ve Dikkat
 *    bulguları (GET /api/device-health; kullanıcı isteği 2026-11-23: Dikkat de listelenir, Düzey sütunu Durum'daki renkle,
 *    varsayılan sıra Acil önce sonra en yeni; sütun genişlikleri içeriğe göre — storageKey). Çift tık: Sağlık ▸ Durum.
 *
 * Sade görünüm (kullanıcı isteği 2026-11-23): varsayılan olarak yalnız "Kayıtlı cihaz", "Çevrimiçi", "Sensör verisi gelen" ve
 * hemen yanında aynı boyutta "Toplam disk kullanımı" kartı (eski disk daire grafiği paneli karta dönüştü; grafik kartın
 * ipucunda) ve "Sağlık — acil bulgular" görünür. Öteki kartlar ile "Son 24 saatte hata düzeyindeki kayıtlar" ve "Son görevler"
 * panelleri varsayılan gizli; kart satırının sonundaki "⚙ Görünüm" menüsünden açılır (ui_prefs "dashboard.cards",
 * "dashboard.panels" — bkz. CARDS, PANELS). Bütün kartlar aynı genişlikte (CARD_WIDTH).
 *
 * Eski düzen (kullanıcı isteği 2026-11-10: daha kompakt, basit; "Son görevler" altta kırpılıyordu): üstte küçük kartlar (geniş
 * ekranda tek satır), ortada disk + acil bulgular (sabit, alçak), altta "Son hatalar" ve "Son görevler" YAN YANA —
 * ikisi de kalan yüksekliğin tamamını alır, biri ötekini aşağı itmez.
 *
 * Paneller (kullanıcı isteği 2026-11-10): her bölge kenarlıklı kutuda (__panel); disk | acil bulgular, üst | alt satır ve
 * hatalar | görevler arasındaki ayırıcılar fareyle sürüklenir, boyutlar oturumu açık kullanıcının hesabında saklanıp
 * yüklenir (ui_prefs "dashboard.disk.width", "dashboard.health.height", "dashboard.errors.width" — bkz. __remember).
 */
qx.Class.define("ankamon.page.Dashboard", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, "Genel bakış");
    // "Yenile" düğmesi yok: sol ağaçta "Genel bakış"a (zaten seçiliyken de) tıklamak yeniler — bkz.
    // Shell PAGES retap. Boş düğme satırı da yer kaplamasın.
    this._actions.exclude();

    // Kartlar sarılır (dar pencerede alt satıra geçer, değerler "…" ile kesilmez). Flow'un VBox içinde
    // sarması için genişliği sayfanınkine kilitlenir — bkz. Base.js'teki _actions için aynı not.
    this.__stats = new qx.ui.container.Composite(new qx.ui.layout.Flow(8, 8));
    this.add(this.__stats);
    this.addListener("resize", e => {
      const width = e.getData().width;
      if (width) {
        this.__stats.setWidth(width);
      }
    });

    // Paneller (acil bulgular, son hatalar, son görevler) kenarlıklı kutularda; aralarındaki ayırıcılar fareyle sürüklenir,
    // boyutlar kullanıcı başına sunucuda saklanır (bkz. __remember). Hangi panellerin görüneceği "⚙ Görünüm"den (__layoutPanels).
    this.__healthRow = this.__createHealthRow();

    this.__errorsBox = this.__panel("Son 24 saatte hata düzeyindeki kayıtlar");
    this.__errors = this._createTable([
      { id: "time", label: "Zaman", width: 160 },
      { id: "label", label: "Takma ad", width: 150 },
      { id: "host", label: "Bilgisayar adı", width: 150 },
      { id: "severity", label: "Önem", width: 90 },
      { id: "program", label: "Program", width: 140 },
      { id: "message", label: "Mesaj" }
    ], { prefsKey: "dashboard.errors.columns", filterable: true });
    this.__errorsBox.add(this.__errors, { flex: 1 });
    this.__remember(this.__errorsBox, "dashboard.errors.width", "width", () => Math.round((this.__holder.getBounds() || { width: 1000 }).width * 0.6));
    this.__addLogsMenu(this.__errors, id => {
      const row = this.__errorRows && this.__errorRows[id];
      return row && row.device_id ? [{ id: row.device_id, name: row.device_label || row.host }] : [];
    });

    this.__jobsBox = this.__panel("Son görevler");
    this.__jobs = this._createTable([
      { id: "time", label: "Zaman", width: 140 },
      { id: "title", label: "Görev", width: 200 },
      { id: "status", label: "Durum", width: 100 },
      { id: "summary", label: "Özet" }
    ], { prefsKey: "dashboard.jobs.columns", filterable: true });
    this.__jobsBox.add(this.__jobs, { flex: 1 });
    this.__addLogsMenu(this.__jobs, id => {
      const job = (this.__jobRows || []).find(j => j.id === id);
      return job ? job.targets || [] : [];
    });
    if (this.__healthRow) {
      this.__remember(this.__healthRow, "dashboard.health.height", "height", () => ankamon.page.Dashboard.HEALTH_ROW_HEIGHT);
    }

    this.__holder = new qx.ui.container.Composite(new qx.ui.layout.Grow());
    this.add(this.__holder, { flex: 1 });
    this.__layoutPanels();
  },

  statics: {
    /**
     * Genel bakış'ın disk grafiği (kullanıcı isteği 2026-11-10; Disk kullanımı ▸ Özet'inki AYRI — ui.DiskUsageSummary.html):
     * yalnız daire grafik — büyük dilimlerin (%8 ve üstü) üzerinde boyutu, altında toplam ve diskin toplam/boş alanı;
     * sağdaki ayrıntı listesi yok (ad/boyut/pay dilimin ipucunda). Dilime tıklayınca o veri türünün sekmesi açılır (data-mode).
     */
    diskPie(items, disk) {
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const R = 70, C = R + 4;
      const total = items.reduce((sum, it) => sum + (it.bytes || 0), 0);
      const shown = items.filter(it => it.bytes > 0);
      const tip = it => `<title>${esc(it.label)}: ${F.bytes(it.bytes)} (%${(it.bytes / total * 100).toFixed(1)}) — tıklayınca o sekme açılır</title>`;
      const text = (x, y, value) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" ` +
        `style="font:600 11px sans-serif;fill:#fff;paint-order:stroke;stroke:rgba(0,0,0,.55);stroke-width:2.5px;pointer-events:none">${esc(value)}</text>`;
      let svg = "";
      if (!total) {
        svg = `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2"/>` +
          `<text x="${C}" y="${C}" text-anchor="middle" dominant-baseline="middle" fill="currentColor" opacity=".6">Veri yok</text>`;
      } else if (shown.length === 1) {
        svg = `<circle data-mode="${shown[0].mode}" cx="${C}" cy="${C}" r="${R}" fill="${shown[0].color}" style="cursor:pointer">${tip(shown[0])}</circle>` +
          text(C, C, F.bytes(shown[0].bytes));
      } else {
        let angle = -Math.PI / 2;
        const labels = [];
        svg = shown.map(it => {
          const share = it.bytes / total;
          const a0 = angle, a1 = angle + share * 2 * Math.PI;
          angle = a1;
          const p = a => `${(C + R * Math.cos(a)).toFixed(2)} ${(C + R * Math.sin(a)).toFixed(2)}`;
          if (share >= 0.08) {
            const mid = (a0 + a1) / 2;
            labels.push(text(C + R * 0.6 * Math.cos(mid), C + R * 0.6 * Math.sin(mid), F.bytes(it.bytes)));
          }
          return `<path data-mode="${it.mode}" class="slice" d="M ${C} ${C} L ${p(a0)} A ${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)} Z" ` +
            `fill="${it.color}" stroke="#fff" stroke-width="1.5" style="cursor:pointer">${tip(it)}</path>`;
        }).join("") + labels.join("");
      }
      const free = disk && disk.total != null && disk.free != null
        ? `<div style="opacity:.75">Disk: toplam ${F.bytes(disk.total)}, boş ${F.bytes(disk.free)}</div>` : "";
      return `<style>.tm-dpie .slice:hover{opacity:.8}</style><div class="tm-dpie" style="text-align:center;font-size:12px;line-height:1.4">` +
        `<svg width="${2 * C}" height="${2 * C}" viewBox="0 0 ${2 * C} ${2 * C}" role="img" aria-label="Disk kullanımı">${svg}</svg>` +
        `<div><b>Toplam ${F.bytes(total)}</b></div>${free}</div>`;
    },

    /**
     * Kartlar (sırayla) ve varsayılan görünürlükleri (kullanıcı isteği 2026-11-23: yalnız ilk dördü). Kullanıcının seçimi
     * ui_prefs "dashboard.cards" (görünen anahtarların dizisi); yoksa default'u true olanlar.
     */
    CARDS: [
      { key: "devices", label: "Kayıtlı cihaz", default: true },
      { key: "online", label: "Çevrimiçi", default: true },
      { key: "exporter", label: "Sensör verisi gelen", default: true },
      { key: "disk", label: "Toplam disk kullanımı", default: true },
      { key: "logging", label: "Log gönderen (24 sa)" },
      { key: "logs", label: "Log (24 sa)" },
      { key: "errors", label: "Hata (24 sa)" },
      { key: "metrics", label: "Sensör kaydı" },
      { key: "queue", label: "Log kuyruğu" },
      { key: "db", label: "Veritabanı" },
      { key: "backups", label: "Yedekler" }
    ],
    /** Alt paneller; varsayılan gizli (ui_prefs "dashboard.panels" {errors, jobs: Boolean}). */
    PANELS: [
      { key: "errors", label: "Son 24 saatte hata düzeyindeki kayıtlar" },
      { key: "jobs", label: "Son görevler" }
    ],
    /** Bütün kartların ortak genişliği (px) — kartlar aynı boyutta (kullanıcı isteği 2026-11-23). */
    CARD_WIDTH: 168,

    /** Acil bulgular satırının varsayılan yüksekliği (px; kullanıcı sürükleyince "dashboard.health.height"). */
    HEALTH_ROW_HEIGHT: 250,
    /** Paneller arası ayırıcının kalınlığı (px). */
    SPLITTER: 10
  },

  members: {
    __disk: null,
    __dashData: null,
    __healthRow: null,
    __holder: null,
    __errorsBox: null,
    __jobsBox: null,
    __splits: null,
    __urgent: null,
    __urgentRows: null,
    __urgentTitle: null,
    __stats: null,
    __errors: null,
    __jobs: null,
    __errorRows: null,
    __jobRows: null,

    /** Kartların altındaki panel: Sağlık acil bulguları (yetkiye göre; disk artık kart — bkz. CARDS "disk"). */
    __createHealthRow() {
      const health = this._can("anomalies") || this._can("diagnose");
      if (health) {
        const box = this.__panel("Sağlık — acil ve dikkat gerektiren bulgular");
        this.__urgentTitle = box.getChildren()[0].getChildren()[0];
        // Genişlikler içeriğe göre kendiliğinden (storageKey — kullanıcının elle ayarladığı korunur; gizli/sıra anahtarları
        // eski prefsKey'inkiyle aynı: "dashboard.urgent.columns.hidden/.order").
        this.__urgent = this._createTable([
          { id: "device", label: "Cihaz", width: 150 },
          { id: "level", label: "Düzey", width: 70, choices: true },
          { id: "check", label: "Bulgu", width: 220 },
          { id: "path", label: "Yol", width: 110 },
          { id: "at", label: "Zaman", width: 140 },
          // Ayrıntı varsayılan gizli (kullanıcı isteği 2026-11-23); sütun menüsünden açılır.
          { id: "text", label: "Ayrıntı", hidden: true }
        ], { storageKey: "dashboard.urgent.columns", filterable: true });
        // Düzey (Acil/Dikkat) Sağlık ▸ Durum'daki renkli düzey çizicisiyle aynı.
        ankamon.ui.health.Status.installLevelRenderer(this.__urgent, 2);
        this.__urgent.setToolTipText("Çift tıklayın: Sağlık ▸ Durum");
        this.__urgent.addListener("cellDbltap", () =>
          qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_PAGE, { page: "anomalies", tab: "status" }));
        box.add(this.__urgent, { flex: 1 });
        return box.set({ minHeight: 120 });
      }
      return null;
    },

    /** Görünür paneller (⚙ Görünüm): {errors, jobs}. */
    __panelPrefs() {
      const saved = (this._user.ui_prefs || {})["dashboard.panels"] || {};
      return { errors: saved.errors === true, jobs: saved.jobs === true };
    },

    /** Görünür kart anahtarları (⚙ Görünüm). */
    __cardKeys() {
      const saved = (this._user.ui_prefs || {})["dashboard.cards"];
      return Array.isArray(saved) ? saved : ankamon.page.Dashboard.CARDS.filter(c => c.default).map(c => c.key);
    },

    /**
     * Panelleri görünürlük seçimine göre yerleştirir: acil bulgular üstte, hatalar | görevler altta (ikisi birden açıksa yan
     * yana, ayırıcıyla). Seçim değişince yeniden çağrılır — paneller yeniden kurulmaz, yalnız ayırıcılar.
     */
    __layoutPanels() {
      (this.__splits || []).forEach(split => {
        split.getChildren().slice().forEach(child => split.remove(child));
        split.dispose();
      });
      this.__splits = [];
      this.__holder.removeAll();
      const P = this.__panelPrefs();
      const lower = [P.errors ? this.__errorsBox : null, P.jobs ? this.__jobsBox : null].filter(Boolean);
      let bottom = lower[0] || null;
      if (lower.length === 2) {
        bottom = this.__split("horizontal").set({ minHeight: 160 });
        this.__splits.push(bottom);
        bottom.add(this.__errorsBox, 0);
        bottom.add(this.__jobsBox, 1);
      }
      if (this.__healthRow && bottom) {
        const main = this.__split("vertical");
        this.__splits.push(main);
        main.add(this.__healthRow, 0);
        main.add(bottom, 1);
        this.__holder.add(main);
      } else if (this.__healthRow || bottom) {
        this.__holder.add(this.__healthRow || bottom);
      }
    },

    /** "⚙ Görünüm" menüsü: kartlar ve alt panellerin görünürlüğü (kullanıcı başına, sunucuda). */
    __viewMenu() {
      const D = ankamon.page.Dashboard;
      const menu = new qx.ui.menu.Menu();
      const keys = new Set(this.__cardKeys());
      menu.add(new qx.ui.menu.Button("Kartlar").set({ enabled: false }));
      D.CARDS.filter(c => c.key !== "disk" || this._can("logs.manage")).forEach(c => {
        const item = new qx.ui.menu.CheckBox(c.label).set({ value: keys.has(c.key) });
        item.addListener("changeValue", e => {
          const now = new Set(this.__cardKeys());
          e.getData() ? now.add(c.key) : now.delete(c.key);
          ankamon.page.Base.savePref(this._user, "dashboard.cards", D.CARDS.map(x => x.key).filter(k => now.has(k)));
          this.__renderCards();
        });
        menu.add(item);
      });
      menu.add(new qx.ui.menu.Separator());
      menu.add(new qx.ui.menu.Button("Paneller").set({ enabled: false }));
      const panels = this.__panelPrefs();
      D.PANELS.forEach(p => {
        const item = new qx.ui.menu.CheckBox(p.label).set({ value: panels[p.key] });
        item.addListener("changeValue", e => {
          const now = Object.assign(this.__panelPrefs(), { [p.key]: e.getData() });
          ankamon.page.Base.savePref(this._user, "dashboard.panels", now);
          this.__layoutPanels();
        });
        menu.add(item);
      });
      menu.add(new qx.ui.menu.Separator());
      const reset = new qx.ui.menu.Button("Varsayılan görünüm");
      reset.addListener("execute", () => {
        ankamon.page.Base.savePref(this._user, "dashboard.cards", null);
        ankamon.page.Base.savePref(this._user, "dashboard.panels", null);
        this.__renderCards();
        this.__layoutPanels();
      });
      menu.add(reset);
      return menu;
    },

    /**
     * Kenarlıklı panel kutusu (kullanıcı isteği 2026-11-10: bölgelerin sınırları belli olsun): ilk çocuğu başlık
     * satırı (HBox; ilk öğesi kalın başlık etiketi), içerik add(widget, {flex: 1}) ile eklenir.
     */
    __panel(title) {
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({
        padding: [8, 10],
        backgroundColor: "surface",
        decorator: new qx.ui.decoration.Decorator().set({ radius: 8, width: 1, color: "app-border" })
      });
      const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "bottom" }));
      head.add(new qx.ui.basic.Label(title).set({ font: "bold" }));
      box.add(head);
      return box;
    },

    /** Paneller arası ayırıcı: fareyle tutulacak kadar kalın, kendisi boş (panellerin kenarlığı sınırı gösterir). */
    __split(orientation) {
      const split = new qx.ui.splitpane.Pane(orientation);
      const thick = ankamon.page.Dashboard.SPLITTER;
      const splitter = split.getChildControl("splitter");
      if (orientation === "vertical") {
        splitter.set({ height: thick, minHeight: thick, maxHeight: thick });
      } else {
        splitter.set({ width: thick, minWidth: thick, maxWidth: thick });
      }
      splitter.set({ decorator: null, backgroundColor: null });
      return split;
    },

    /**
     * Ayırıcının İLK bölmesinin boyutu (flex 0) kullanıcının hesabında saklanır ve oradan yüklenir
     * (users.ui_prefs[key], bkz. Base.savePref). Ayırıcı bırakılınca qx SplitPane._finalizeSizes ilk bölmeye
     * setWidth/setHeight uygular → change olayı → kayıt (Shell'deki "nav.width" ile aynı yol). Kayıt yoksa
     * varsayılan boyut ilk yerleşimde verilir (o atama kaydedilmez).
     * @param prop {String} "width" | "height"
     * @param fallback {Function} kayıt yokken boyut (px); ilk yerleşimden sonra çağrılır
     */
    __remember(widget, key, prop, fallback) {
      const prefs = this._user.ui_prefs || {};
      const saved = Number(prefs[key]);
      let loading = true;
      if (saved > 0) {
        widget.set(prop, saved);
        loading = false;
      } else {
        // Yerleşim boyutu ilk "appear"dan sonra belli olur (yüzdelik varsayılan için).
        widget.addListenerOnce("appear", () => qx.event.Timer.once(() => {
          if (!widget.isDisposed()) {
            widget.set(prop, Math.max(80, fallback() || 0));
          }
          loading = false;
        }, null, 0));
      }
      const event = prop === "width" ? "changeWidth" : "changeHeight";
      widget.addListener(event, e => {
        const value = e.getData();
        if (!loading && value && value !== prefs[key]) {
          ankamon.page.Base.savePref(this._user, key, value);
        }
      });
    },

    /** Toplam disk kullanımı (kart): tampondan hemen; tampon yok ya da eskiyse arkada yeniden hesaplanıp kart yenilenir. */
    __refreshDisk() {
      if (!this._can("logs.manage") || !this.__cardKeys().includes("disk")) {
        return;
      }
      const S = ankamon.ui.DiskUsageSummary;
      const draw = res => {
        if (this.isDisposed() || !res) {
          return;
        }
        this.__disk = res;
        this.__renderCards();
      };
      const cached = S.cached();
      if (cached) {
        this.__disk = cached;
      }
      if (!cached || Date.now() - cached.at > S.CACHE_MS) {
        S.compute(ankamon.ui.DiskUsage.specs()).then(draw).catch(() => {
          if (!cached && !this.isDisposed()) {
            this.__disk = { failed: true };
            this.__renderCards();
          }
        });
      }
    },

    /** Sağlık ▸ Durum'daki Acil bulgular. */
    async __refreshUrgent() {
      if (!this.__urgent) {
        return;
      }
      const F = ankamon.util.Format;
      const P = ankamon.ui.health.Status.PATH;
      let data;
      try {
        data = await ankamon.io.Api.get("/device-health");
      } catch (e) {
        return;
      }
      if (this.isDisposed()) {
        return;
      }
      // Acil ve Dikkat (kullanıcı isteği 2026-11-23); varsayılan sıra: Acil önce, düzey içinde en yeni üstte.
      const rank = { bad: 0, warn: 1 };
      const shown = (data.findings || []).filter(f => f.level in rank)
        .sort((a, b) => rank[a.level] - rank[b.level] || (b.since || 0) - (a.since || 0));
      const count = level => shown.filter(f => f.level === level).length;
      const devices = new Set(shown.map(f => f.device_id ?? f.device));
      const parts = [count("bad") && `${count("bad")} acil`, count("warn") && `${count("warn")} dikkat`].filter(Boolean).join(", ");
      this.__urgentTitle.setValue(shown.length ? `Sağlık — acil ve dikkat gerektiren bulgular (${devices.size} cihazda ${parts})`
        : "Sağlık — acil ya da dikkat gerektiren bulgu yok");
      this.__urgent.getTableModel().setData(shown.map((f, i) => [i, f.device || "?", ankamon.ui.health.Status.levelText(f.level),
        f.check, P[f.path] ? P[f.path].text : f.path,
        f.since ? ankamon.ui.health.Status.when(f.since) : "", (f.text || "") + (f.advice ? ` — Öneri: ${f.advice}` : "")]));
    },

    async _refresh() {
      const F = ankamon.util.Format;
      this.__refreshDisk();
      this.__refreshUrgent();
      const data = await ankamon.io.Api.get("/dashboard");
      const logs = data.log_histogram.reduce((sum, bucket) => sum + bucket.total, 0);
      const errors = data.log_histogram.reduce((sum, bucket) => sum + bucket.errors, 0);

      this.__dashData = { data, logs, errors };
      this.__renderCards();

      this.__errorRows = data.recent_errors;
      this.__jobRows = data.recent_jobs;
      this.__errors.getTableModel().setData(data.recent_errors.map((row, index) => [
        index, F.dateTime(row.ts), row.device_label || "", row.host, F.severity(row.severity), row.program, row.message
      ]));
      this.__jobs.getTableModel().setData(data.recent_jobs.map(job => [
        job.id, F.dateTime(job.created_at * 1000), job.title, F.jobStatus(job.status), job.summary
      ]));
    },

    /**
     * Kartları çizer (görünür olanlar, CARDS sırasıyla) ve satırın sonuna "⚙ Görünüm" düğmesi. Veri: son /dashboard yanıtı
     * (__dashData) ve disk özeti (__disk); disk hesabı bitince yeniden çağrılır.
     */
    __renderCards() {
      if (!this.__dashData || this.isDisposed()) {
        return;
      }
      const F = ankamon.util.Format;
      const { data, logs, errors } = this.__dashData;
      const b = data.backups;
      const n = v => Number(v).toLocaleString("tr-TR");
      const bt = data.devices;
      const disk = this.__disk;
      const diskTotal = disk && disk.items ? disk.items.reduce((sum, it) => sum + (it.bytes || 0), 0) : null;
      this.__stats.removeAll().forEach(card => card.dispose());
      // [başlık, değer, renk, alt satır, ipucu] — ipucu her kartın KENDİ konusunu anlatır (bkz. __tip).
      const all = {
        devices: ["Kayıtlı cihaz", n(bt.total), null, `${n(bt.total - bt.online)} kapalı`],
        online: ["Çevrimiçi", n(bt.online), "app-ok", bt.total ? `%${Math.round(bt.online * 100 / bt.total)}` : null],
        exporter: ["Sensör verisi gelen", n(bt.exporter_ok), null, `${n(bt.total - bt.exporter_ok)} cihazdan gelmiyor`],
        disk: ["Toplam disk kullanımı", diskTotal === null ? (disk && disk.failed ? "—" : "…") : F.bytes(diskTotal), null,
          disk && disk.disk && disk.disk.free != null ? `boş ${F.bytes(disk.disk.free)} / ${F.bytes(disk.disk.total)}`
            : (disk && disk.failed ? "alınamadı" : "hesaplanıyor…")],
        logging: ["Log gönderen (24 sa)", n(bt.logging), null, `${n(bt.total - bt.logging)} cihazdan gelmiyor`],
        logs: ["Log (24 sa)", n(logs), null, F.bytes(data.storage.tables.logs.bytes) + " (tümü)"],
        errors: ["Hata (24 sa)", n(errors), errors ? "error" : null, logs ? `logların %${(errors * 100 / logs).toFixed(1)}'i` : null],
        metrics: ["Sensör kaydı", this.__millions(data.metrics_rows), null, F.bytes(data.metrics_bytes)],
        // rsyslog disk kuyruğu: büyüyorsa loglar veritabanına yazılamıyor demektir.
        queue: ["Log kuyruğu", F.bytes(data.log_queue.bytes), null, `${data.log_queue.files} dosya`],
        db: ["Veritabanı", F.bytes(data.database_bytes), null, "PostgreSQL + TimescaleDB"],
        backups: b
          ? ["Yedekler", F.bytes(b.bytes), null, `${b.files} dosya` + (b.latest.full ? ` · son tam ${F.bytes(b.latest.full.bytes)}` : "")]
          : ["Yedekler", "—", null, "özet henüz yok"]
      };
      const visible = new Set(this.__cardKeys());
      ankamon.page.Dashboard.CARDS.filter(c => visible.has(c.key) && (c.key !== "disk" || this._can("logs.manage"))).forEach(c => {
        const [label, value, color, sub] = all[c.key];
        const tip = c.key === "disk"
          ? (disk && disk.items ? `<b>Toplam disk kullanımı</b> — veri türlerine göre${ankamon.page.Dashboard.diskPie(disk.items, disk.disk)}` +
            `<div style="opacity:.7">hesaplandı: ${F.ago(Math.floor(disk.at / 1000))}</div>` : "Veri türlerinin boyutları toplanıyor…")
          : this.__tip(c.key, data, { logs, errors });
        this.__stats.add(this.__card(label, value, color, sub, tip, this.__target(c.key)));
      });
      const view = new qx.ui.form.MenuButton("⚙ Görünüm").set({
        alignY: "middle", font: "small", padding: [3, 8], toolTipText: "Hangi kartların ve panellerin görüneceğini seçin"
      });
      view.addListener("pointerdown", () => view.setMenu(this.__viewMenu()), this, true);
      view.setMenu(this.__viewMenu());
      this.__stats.add(view);
    },

    /**
     * Satır sağ menüsü: "Hata loglarını göster" — Loglar sayfasını o cihaza ve "Hata ve üstü"
     * önem düzeyine süzülmüş açar (bkz. ui.Shell.OPEN_LOGS). Görevlerin birden çok hedef cihazı
     * olabildiğinden, birden fazlaysa her cihaz için ayrı madde (alt menü) çıkar.
     * @param devicesOf {Function} satırın kimlik değeri → [{id, name}]
     */
    __addLogsMenu(table, devicesOf) {
      if (!this._can("logs")) {
        return;
      }
      const open = deviceId => qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_LOGS, { deviceId, severity: "3" });
      const label = `${ankamon.ui.Shell.ICON.logs} Hata loglarını göster`;
      table.addListener("cellContextmenu", e => {
        const row = e.getRow();
        const devices = row === null || row === undefined ? [] : devicesOf(table.getTableModel().getValue(0, row));
        const old = table.getContextMenu();
        if (old) {
          qx.event.Timer.once(() => old.destroy(), null, 0);
        }
        if (!devices.length) {
          table.setContextMenu(null);
          return;
        }
        table.getSelectionModel().setSelectionInterval(row, row);
        const menu = new qx.ui.menu.Menu();
        if (devices.length === 1) {
          const item = new qx.ui.menu.Button(`${label} — ${devices[0].name}`);
          item.addListener("execute", () => open(devices[0].id));
          menu.add(item);
        } else {
          const sub = new qx.ui.menu.Menu();
          devices.forEach(b => {
            const item = new qx.ui.menu.Button(b.name);
            item.addListener("execute", () => open(b.id));
            sub.add(item);
          });
          menu.add(new qx.ui.menu.Button(`${label} (${devices.length} cihaz)`, null, null, sub));
        }
        table.setContextMenu(menu);
      });
    },

    /**
     * Karta tıklayınca açılacak yer (kullanıcının yetkisi varsa; yoksa kart tıklanamaz).
     * @return {Map|null} {text: ipucuna eklenen açıklama, open: Function}
     */
    __target(key) {
      const Shell = ankamon.ui.Shell;
      const send = (name, data) => () => qx.event.message.Bus.dispatchByName(name, data);
      const page = (text, data, feature) => (feature === true ? this._user.is_admin : this._can(feature))
        ? { text, open: send(Shell.OPEN_PAGE, data) } : null;
      const disk = (text, tab) => this._can("logs.manage") ? { text, open: send(Shell.OPEN_PAGE, { diskUsage: tab }) } : null;
      const logs = (text, open) => this._can("logs") ? { text, open } : null;
      switch (key) {
        case "devices": return page("Cihazlar listesi", { page: "devices", status: "" }, "devices");
        case "online": return page("Çevrimiçi cihazlar", { page: "devices", status: "Çevrimiçi" }, "devices");
        case "exporter": return page("Sensörler", { page: "metrics" }, "metrics");
        case "logging":
        case "logs": return logs("Sistem logları", send(Shell.OPEN_LOGS_MODE, "system"));
        case "errors": return logs("Hata düzeyindeki sistem logları", send(Shell.OPEN_LOGS, { deviceId: null, severity: "3" }));
        case "metrics": return disk("Disk kullanımı — Sensör verileri", "metrics") || page("Sensörler", { page: "metrics" }, "metrics");
        case "queue": return disk("Disk kullanımı — Log kuyruğu", "queue");
        case "db": return page("Sistem — Veritabanı", { page: "system", tab: "database" }, true);
        case "backups": return disk("Disk kullanımı — Yedekler", "backups");
        case "disk": return disk("Disk kullanımı — Özet", "summary");
        default: return null;
      }
    },

    /** Milyon cinsinden kısa gösterim: 351458 → "0,35 M". */
    __millions(n) {
      return (n / 1e6).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " M";
    },

    /**
     * Kartın ipucu (zengin metin): yalnız O kartın konusu — ne saydığı, güncel ayrıntısı ve (veri
     * tutan kartlarda) verinin nerede, ne kadar süre saklandığı. Her yenilemede güncel değerlerle
     * yeniden kurulur. Kaynak: /api/dashboard (devices, log_histogram, recent_errors, storage,
     * log_queue, backups).
     * @param key {String} devices|online|exporter|logging|logs|errors|metrics|queue|db|backups
     * @param ctx {Map} {logs, errors} — son 24 saatin toplamları (_refresh'te hesaplanıyor)
     */
    __tip(key, data, ctx) {
      const F = ankamon.util.Format;
      const esc = s => qx.bom.String.escape(String(s ?? "—"));
      const n = v => Number(v).toLocaleString("tr-TR");
      const gun = s => esc((s || "?").replace(/ days?/, " gün").replace(/ mons?/, " ay"));
      const t = data.storage.tables;
      const p = data.storage.policies;
      const bt = data.devices;
      const off = bt.total - bt.online;
      const hist = data.log_histogram;
      const lastHour = hist.length ? hist[hist.length - 1] : { total: 0, errors: 0 };
      const peak = hist.reduce((a, h) => (h.total > (a ? a.total : -1) ? h : a), null);
      const hour = ts => new Date(ts * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
      const pre = s => `<pre style="margin:4px 0 0;font-family:monospace;font-size:12px;line-height:1.35">${s}</pre>`;
      const muted = s => `<span style="color:#888">${s}</span>`;
      let title;
      let body;

      switch (key) {
        case "devices":
          title = "Kayıtlı cihaz";
          body = `Ankamon'un tanıdığı cihazların tamamı: <b>${n(bt.total)}</b><br>` +
            `├ çevrimiçi: ${n(bt.online)}<br>└ kapalı: ${n(off)}<br><br>` +
            "Cihaz log göndermeye başlayınca (TiHA merkezi log ayarı) en geç ~1 dk içinde kendiliğinden<br>" +
            "kaydedilir; Cihazlar → Ekle ile elle de eklenebilir. Silinen bir cihaz log göndermeyi<br>" +
            "sürdürse de yeniden eklenmez — yalnız elle eklenirse.";
          break;
        case "online":
          title = "Çevrimiçi";
          body = `Şu an açık olan cihazlar: <b>${n(bt.online)}</b> / ${n(bt.total)}` +
            (bt.total ? ` (%${Math.round(bt.online * 100 / bt.total)})` : "") + `, kapalı: ${n(off)}<br><br>` +
            "Bir cihaz şu durumda çevrimiçi sayılır:<br>" +
            "├ son 2 dakikada log geldiyse, ya da<br>" +
            "└ SSH / sensör portu yoklamasına yanıt veriyorsa (yaklaşık 10 sn'de bir).<br>" +
            "Kapalıya dönmesi için üst üste 2 yoklamanın başarısız olması gerekir (anlık kopmalar sayılmaz).<br>" +
            "Kapalı cihazlar Cihazlar sayfasından \"Uyandır\" (WoL) ile açılabilir.";
          break;
        case "exporter":
          title = "Sensör verisi gelen";
          body = `Sensör portu (node_exporter, varsayılan 9100) yanıt veren cihazlar: <b>${n(bt.exporter_ok)}</b> / ${n(bt.total)}<br>` +
            `Veri gelmeyen: ${n(bt.total - bt.exporter_ok)} cihaz — kapalı, sensör toplama kapatılmış ya da port yanıt vermiyor.<br><br>` +
            "Telegraf bu cihazların CPU, bellek, disk, ağ ve sıcaklık değerlerini dakikada bir okuyup<br>" +
            "veritabanına yazar (bkz. \"Sensör kaydı\" kartı).";
          break;
        case "logging":
          title = "Log gönderen (24 sa)";
          body = `Son 24 saatte en az bir log gönderen cihaz: <b>${n(bt.logging)}</b> / ${n(bt.total)}<br>` +
            `24 saattir log gelmeyen: ${n(bt.total - bt.logging)} cihaz — kapalı kalmış ya da TiHA'nın merkezi log<br>` +
            "sunucusu ayarı o cihazda etkin değil.<br>" +
            pre("cihaz ─(514/tcp,udp)─► rsyslog ─► veritabanı (logs tablosu)");
          break;
        case "logs":
          title = "Log (24 sa)";
          body = `Son 24 saatte gelen log: <b>${n(ctx.logs)}</b><br>` +
            `├ son 1 saatte: ${n(lastHour.total)}<br>` +
            (peak ? `└ en yoğun saat: ${hour(peak.time)} (${n(peak.total)} kayıt)<br>` : "") + "<br>" +
            `Saklandığı yer: <b>data/postgres</b> → logs tablosu, tümü ${F.bytes(t.logs.bytes)}<br>` +
            `${gun(p.logs?.compress_after)} sonra sıkıştırılır, ${gun(p.logs?.drop_after)} sonra kendiliğinden silinir.<br>` +
            muted("Görüntüleme: Loglar sayfası · elle silme: Disk kullanımı");
          break;
        case "errors": {
          title = "Hata (24 sa)";
          const last = data.recent_errors[0];
          body = `Son 24 saatte önem düzeyi <b>hata ya da daha ciddi</b> olan loglar ` +
            `(emerg, alert, crit, err): <b>${n(ctx.errors)}</b>` +
            (ctx.logs ? ` — tüm logların %${(ctx.errors * 100 / ctx.logs).toFixed(1)}'i` : "") + "<br>" +
            `├ son 1 saatte: ${n(lastHour.errors)}<br>` +
            (last
              ? `└ en son: ${esc(F.dateTime(last.ts))} · ${esc(last.device_label || last.host)} · ${esc(last.program)}<br>`
              : "└ hiç hata yok<br>") + "<br>" +
            muted("Son 15 hata aşağıdaki tabloda; tamamı Loglar sayfasında önem süzgeciyle görülebilir.");
          break;
        }
        case "metrics":
          title = "Sensör kaydı";
          body = "Telegraf'ın cihazlardan okuduğu ölçümler (log değildir): " +
            `<b>≈${n(t.metrics.rows)}</b> satır, ${F.bytes(t.metrics.bytes)}<br>` +
            "Saklandığı yer: <b>data/postgres</b> → metrics tablosu. Disk tasarrufu için yaşlandıkça seyreltilir:" +
            pre(`ayrıntılı (dakikalık) ── ${gun(p.metrics?.drop_after)} tutulur, ${gun(p.metrics?.compress_after)} sonra sıkıştırılır\n` +
              `   └► 5 dk ortalama ─── ${gun(p.metrics_5m?.drop_after)}\n` +
              `        └► saatlik ──── ${gun(p.metrics_1h?.drop_after)}`) +
            muted("Grafik ve cihaz ayrıntıları: Grafana / Sensörler");
          break;
        case "queue":
          title = "Log kuyruğu";
          body = `<b>data/rsyslog</b>: ${F.bytes(data.log_queue.bytes)} · ${n(data.log_queue.files)} dosya<br><br>` +
            "Veritabanının o an yazamadığı loglar (ör. yeniden başlatma sırasında) kaybolmasın diye<br>" +
            "burada bekler; veritabanı açılınca sırayla yazılır ve kuyruk boşalır. Buradaki loglar<br>" +
            "henüz sorgulanamaz.<br>" +
            (data.log_queue.bytes > 50 * 1024 * 1024
              ? "<b style='color:#d9534f'>Kuyruk büyük: loglar veritabanına ulaşmıyor olabilir.</b>"
              : muted("Normalde boş ya da birkaç yüz KB'tır; sürekli büyüyorsa log yazımı aksıyor demektir."));
          break;
        case "db": {
          title = "Veritabanı";
          const row = (name, desc, approx, lastRow) =>
            `${lastRow ? "└" : "├"}── ${name.padEnd(15)} ${F.bytes(t[name].bytes).padStart(9)} · ` +
            `${approx ? "≈" : ""}${n(t[name].rows)} satır  ${muted(desc)}\n`;
          body = `<b>data/postgres</b> — "ankamon" veritabanının diskteki boyutu: <b>${F.bytes(data.database_bytes)}</b>` +
            pre(row("logs", "sistem logları", true) +
              row("metrics", "sensör ölçümleri", true) +
              row("command_log", "çalıştırılan komutlar") +
              row("job_events", "komut çıktı satırları (30 gün)") +
              row("device_sessions", "oturum açma/kapama") +
              row("activity_log", "arka plan işlemleri çubuğu") +
              row("audit_log", "arayüzde kim ne yaptı", false, true)) +
            muted("Silinen kayıtların yeri hemen diske iade edilmez, veritabanı içinde yeniden kullanılır;<br>" +
              "bu yüzden silme sonrası bu değer hemen küçülmeyebilir.");
          break;
        }
        case "backups": {
          title = "Yedekler";
          const b = data.backups;
          if (!b) {
            body = "<b>data/backups</b> — yedek özeti henüz oluşmadı (yedek servisi dakikada bir günceller).";
            break;
          }
          const kind = (k, what, lastRow) => {
            const g = b.kinds[k] || { files: 0, bytes: 0 };
            return `${lastRow ? "└" : "├"}── ${(k + (k === "files" ? "-*.tar.gz" : "-*.dump")).padEnd(15)} ${String(g.files).padStart(3)} dosya · ` +
              `${F.bytes(g.bytes).padStart(9)}  ${muted(what)}\n`;
          };
          body = `<b>data/backups</b>: toplam <b>${F.bytes(b.bytes)}</b> · ${n(b.files)} dosya` +
            pre(kind("full", `tam yedek (loglar + sensör dahil) · günde 1 (${esc(b.full_at)}), son ${b.keep_full} tutulur`) +
              kind("config", `ayarlar/kullanıcılar/cihazlar · ${b.config_every_hours} saatte 1, son ${b.keep_config} tutulur`) +
              kind("grafana", "Grafana pano ayarları · config ile birlikte") +
              kind("files", `/data dosya depoları (tar.gz) · günde 1 (${esc(b.files_at || "")}), son ${b.keep_files} tutulur`, true)) +
            muted("Plan: Sistem ▸ Yedekler") + "<br>" +
            (b.latest.full
              ? `Son tam yedek: ${esc(b.latest.full.name)} — ${F.bytes(b.latest.full.bytes)}, ` +
                `${esc(F.dateTime(b.latest.full.mtime * 1000))}<br>`
              : "") +
            muted("Silinen loglar, silmeden önce alınmış tam yedeklerde bir süre daha durur.");
          break;
        }
        default:
          return null;
      }
      return `<div style="line-height:1.45"><b style="font-size:13px">${esc(title)}</b>` +
        `  ${muted(esc(new Date().toLocaleTimeString("tr-TR")))}<br>${body}</div>`;
    },

    /**
     * Bilgi kartı: başlık İLK satırda, ardından değer ve alt satır. Alt satırı olmayan kartta da
     * boş bir satır tutulur — kartların yükseklikleri eşit kalsın.
     */
    __card(label, value, color, sub, richTip, target) {
      const border = new qx.ui.decoration.Decorator().set({ radius: 8, width: 1, color: "app-border" });
      // Kompakt (kullanıcı isteği 2026-11-10: göstergeler küçük): az dolgu, küçük yazı.
      const card = new qx.ui.container.Composite(new qx.ui.layout.VBox(1)).set({
        padding: [6, 10],
        // Bütün kartlar aynı genişlikte (kullanıcı isteği 2026-11-23: disk kartı sensör kartıyla aynı boyutta).
        width: ankamon.page.Dashboard.CARD_WIDTH,
        backgroundColor: "surface",
        decorator: border
      });
      if (target) {
        // Tıklanabilir kart: el imleci + üzerine gelince vurgulu kenar; ipucu nereye gidileceğini söyler.
        const hover = new qx.ui.decoration.Decorator().set({ radius: 8, width: 1, color: "primary" });
        card.set({ cursor: "pointer" });
        card.addListener("pointerover", () => card.setDecorator(hover));
        card.addListener("pointerout", () => card.setDecorator(border));
        card.addListener("tap", target.open);
        richTip = (richTip || "") + `<div style="margin-top:6px;opacity:.75">Tıklayınca açılır: ${qx.bom.String.escape(target.text)}</div>`;
      }
      if (richTip) {
        // Çok satırlı ipucu: okunacak kadar açık kalsın (varsayılan gizlenme süresi kısa).
        const toolTip = new qx.ui.tooltip.ToolTip(richTip).set({ rich: true, showTimeout: 400 });
        card.setToolTip(toolTip);
        qx.util.DisposeUtil.disposeTriggeredBy(toolTip, card); // kartlar her yenilemede atılıyor
      }
      card.add(new qx.ui.basic.Label(label).set({ textColor: "app-muted", font: "small" }));
      // Değer: temanın yazı ailesiyle, sabit (küçültülmüş) boyutta.
      card.add(new qx.ui.basic.Label(`<span style="font-size:20px;font-weight:600;line-height:1.15">${qx.bom.String.escape(String(value))}</span>`)
        .set({ rich: true, textColor: color || "primary" }));
      card.add(new qx.ui.basic.Label(sub || " ").set({ textColor: "app-muted", font: "small" }));
      return card;
    }
  }
});
