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
 * Sağlık ▸ Durum: her cihazın şu anki sağlığı tek yerde (bkz. backend DeviceHealthApi, GET /api/device-health).
 *
 * Bulgular iki yoldan gelir ve her satırda hangisinden geldiği yazar:
 *   - Sürekli izleme: Ankamon cihaza BAĞLANMADAN, cihazın gönderdiği loglardan, kendi okuduğu ölçümlerden ve daha önce
 *     toplanmış verilerden birkaç dakikada bir çıkarır (anomali kuralları). Yalnız şu an SÜRENLER.
 *   - SSH denetimi: Ankamon cihaza SSH ile girip ölçer (haftalık otomatik ya da Denetle sekmesinden elle). Her cihazın EN SON
 *     denetiminin Acil/Dikkat bulguları ve denetlenemeyen cihazlar.
 *
 * Üst tablo cihaz başına bir satır (sadeleştirildi, kullanıcı isteği 2026-11-23): Durum = en kötü düzey VE o düzeyin uyarıları
 * ("Acil: SMART hatası"), iki yolun bulguları tek "Bulgular" sütununda; varsayılan Acil → Dikkat → Sorun yok sıralı; "Açık mı"
 * ve "Bulgu" (sayı) sütunları varsayılan gizli (sütun menüsünden açılır). Alttaki tablo seçili cihazın (seçim yoksa hepsinin)
 * bulguları: Yol, Kaynak, Nasıl bakıldı, Sıklık, Zaman. Çift tık: sürekli izleme bulgusu → o cihazın Geçmiş'i; SSH denetimi
 * bulgusu → Denetle (o cihaza süzülmüş). İki tablo da sütun süzgeçli (az çeşitli sütunlarda hazır değer listesi).
 * İki yolun açıklaması yalnız ipucunda: sekme kulakçığı ve özet satırının solundaki "ⓘ Bulgular nereden gelir?" (kullanıcı
 * isteği: sayfada ikinci kez yazılmaz). İki tablo arasındaki ayırıcı kalın (SPLITTER px); üst ve alt bölmenin ayırıcıya
 * bakan iç boşlukları eşit (PANE_GAP — ayırıcı üst tablonun son satırını kesmesin). Alt tablo yalnız bir cihaz seçilince
 * dolar (sekmeye girişte boş; başlık satırı yok — kullanıcı isteği).
 */
qx.Class.define("ankamon.ui.health.Status", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Anomalies} */
  construct(page) {
    super("Durum");
    this.setUserData("key", "status");
    this.__page = page;
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(12).set({ alignY: "middle" }));
    this.__info = new qx.ui.basic.Label("ⓘ Bulgular nereden gelir?").set({ textColor: "app-muted", cursor: "help" });
    head.add(this.__info);
    this.__summary = new qx.ui.basic.Label("").set({ rich: true, wrap: true, allowGrowX: true });
    head.add(this.__summary, { flex: 1 });
    this.add(head);
    this.getButton().setToolTipText(this.__legendHtml(["watch", "ssh"]));
    this.__info.setToolTipText(this.__legendHtml(["watch", "ssh"]));

    const split = new qx.ui.splitpane.Pane("vertical");
    const thick = ankamon.ui.health.Status.SPLITTER;
    split.getChildControl("splitter").set({ height: thick, minHeight: thick, maxHeight: thick });
    this.add(split, { flex: 1 });

    this.__deviceColumns = [
      { id: "device", label: "Cihaz", width: 200 },
      { id: "online", label: "Açık mı", width: 90, hidden: true },
      // Durum = iki yolun EN KÖTÜSÜ ve o düzeydeki uyarılar ("Acil: SMART hatası, Disk doluluğu") — kullanıcı isteği 2026-11-23.
      { id: "level", label: "Durum", width: 320, hint: "En kötü düzey ve o düzeydeki uyarılar (Log ya da Uzak bağlantı yolundan)" },
      // İki yolun (Log = sürekli izleme şu an, Uzak bağlantı = en son SSH denetimi) bulguları tek sütunda (eskiden iki sütun).
      { id: "findings", label: "Bulgular", width: 360, hint: "Cihazın Log (sürekli izleme) ve Uzak bağlantı (son SSH denetimi) bulguları, düzeyleriyle" },
      // İki yolun en yeni bakışı (SSH denetimi zamanı ya da sürekli izlemenin en yeni bulgusu) ve toplam bulgu sayıları;
      // 10 saatten yeniyse geçen süre ("2 saat 23 dk önce" — kullanıcı isteği).
      { id: "last", label: "Son denetim / bulgu", width: 300, hint: "Son SSH denetimi ya da sürekli izlemenin en yeni bulgusu" },
      { id: "count", label: "Bulgu", width: 70, hidden: true }
    ];
    this.__deviceTable = page._createTable(this.__deviceColumns, { prefsKey: "health.status.devices.columns", persistSort: true });
    this.__deviceFilters = page._addColumnFilters(this.__deviceTable, this.__deviceColumns, () => this.__applyDevices(),
      { rows: () => (this.__deviceRows || []).map(r => r.cells), persist: true });
    this.__levelRenderer(this.__deviceTable, 3);
    this.__deviceTable.getSelectionModel().addListener("changeSelection", () => this.__applyFindings());
    this.__deviceTable.setToolTipText("Bir cihazı seçin: aşağıda yalnız onun bulguları görünür");
    const gap = ankamon.ui.health.Status.PANE_GAP;
    const top = new qx.ui.container.Composite(new qx.ui.layout.VBox(4)).set({ paddingBottom: gap });
    top.add(this.__deviceTable, { flex: 1 });
    split.add(top, 1);

    this.__findingColumns = [
      { id: "device", label: "Cihaz", width: 180 },
      { id: "level", label: "Düzey", width: 80 },
      { id: "check", label: "Bulgu", width: 220 },
      { id: "path", label: "Yol", width: 130 },
      { id: "source", label: "Kaynak", width: 110 },
      { id: "how", label: "Nasıl bakıldı", width: 300 },
      { id: "every", label: "Sıklık", width: 120 },
      { id: "at", label: "Zaman", width: 140 },
      { id: "text", label: "Ayrıntı" }
    ];
    this.__findingTable = page._createTable(this.__findingColumns, { prefsKey: "health.status.findings.columns" });
    this.__findingFilters = page._addColumnFilters(this.__findingTable, this.__findingColumns, () => this.__applyFindings(),
      { rows: () => (this.__findingRows || []).map(r => r.cells) });
    this.__levelRenderer(this.__findingTable, 2);
    // Yol sütunu, üstteki açıklamanın rozetleriyle aynı renkte: bulgunun hangi yoldan geldiği bir bakışta seçilsin.
    const pathRenderer = new qx.ui.table.cellrenderer.Conditional();
    Object.values(ankamon.ui.health.Status.PATH).forEach(P => pathRenderer.addRegex(`^${P.text}$`, null, P.color, null, "bold"));
    this.__findingTable.getTableColumnModel().setDataCellRenderer(4, pathRenderer);
    this.__findingTable.addListener("cellDbltap", e => {
      const row = (this.__shownFindings || [])[e.getRow()];
      if (row) {
        this.__page.openFinding(row.finding);
      }
    });
    this.__findingTable.setToolTipText("Çift tıklayın: sürekli izleme bulgusu → Geçmiş'te o cihaz; SSH denetimi bulgusu → Denetle (o cihaz)");
    const bottom = new qx.ui.container.Composite(new qx.ui.layout.VBox(4)).set({ paddingTop: gap });
    bottom.add(this.__findingTable, { flex: 1 });
    split.add(bottom, 1);
  },

  statics: {
    /** İki tablo arasındaki ayırıcının kalınlığı (px). */
    SPLITTER: 12,
    /** Ayırıcıya bakan iç boşluk (px): üst bölmenin altı = alt bölmenin üstü. */
    PANE_GAP: 8,
    /** Bu kadar saniyeden yeni zamanlar geçen süreyle yazılır ("2 saat 23 dk önce"). */
    RELATIVE_S: 10 * 3600,

    /** epoch sn → 10 saatten yeniyse "2 saat 23 dk önce", değilse tarih-saat. */
    when(ts) {
      if (!ts) {
        return "";
      }
      const diff = Math.floor(Date.now() / 1000) - ts;
      if (diff < 0 || diff >= ankamon.ui.health.Status.RELATIVE_S) {
        return ankamon.util.Format.dateTime(ts * 1000);
      }
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      if (!h && !m) {
        return "az önce";
      }
      return (h ? `${h} saat ` : "") + `${m} dk önce`;
    },

    // Yol adları kısa (kullanıcı isteği 2026-11-23): sürekli izleme = "Log", SSH denetimi = "Uzak bağlantı".
    PATH: {
      watch: { text: "Log", color: "#1a73e8" },
      ssh: { text: "Uzak bağlantı", color: "#7b1fa2" }
    },

    /**
     * Düzey sütunu renkli ve kalın (metin süzgeç için düz kalır); hücre düzey adıyla başlar ("Acil: …" da olur).
     * Genel bakış'ın acil/dikkat panelinde de kullanılır (page.Dashboard).
     */
    installLevelRenderer(table, column) {
      const r = new qx.ui.table.cellrenderer.Conditional();
      Object.values(ankamon.page.Diagnose.LEVEL).forEach(L => r.addRegex(`^${L.text}(:|$)`, null, L.color, null, "bold"));
      table.getTableColumnModel().setDataCellRenderer(column, r);
    },

    /** Düzey adları Bakım raporuyla aynı (bkz. page.Diagnose LEVEL). */
    levelText(level) {
      const L = ankamon.page.Diagnose.LEVEL[level];
      return L ? L.text : level;
    }
  },

  members: {
    __page: null,
    __info: null,
    __summary: null,
    __deviceColumns: null,
    __deviceTable: null,
    __deviceFilters: null,
    __deviceRows: null,
    __shownDevices: null,
    __findingColumns: null,
    __findingTable: null,
    __findingFilters: null,
    __findingRows: null,
    __shownFindings: null,
    __data: null,

    /** Düzey sütunu renkli ve kalın — bkz. installLevelRenderer. */
    __levelRenderer(table, column) {
      ankamon.ui.health.Status.installLevelRenderer(table, column);
    },

    /** İki yolun açıklaması (ipucu): yalnız kullanıcının gördüğü yollar. */
    __legendHtml(paths) {
      const P = ankamon.ui.health.Status.PATH;
      const badge = key => `<span style="display:inline-block;padding:0 7px;border-radius:9px;background:${P[key].color};color:#fff;font-weight:600">${P[key].text}</span>`;
      return `<div style="max-width:560px;white-space:normal;line-height:1.5">` +
        "Bulgular iki yoldan gelir; her satırda hangisinden geldiği yazar. " +
        (paths.includes("watch") ? `${badge("watch")} Ankamon cihaza bağlanmadan, cihazın gönderdiği loglardan ve kendi ` +
          "okuduğu ölçümlerden birkaç dakikada bir çıkarır; burada yalnız şu an sürenler. " : "") +
        (paths.includes("ssh") ? `${badge("ssh")} Ankamon cihaza SSH ile girip ölçer (haftada bir kendiliğinden ya da Tara ` +
          "sekmesinden elle); her cihazın en son denetimi. " : "") +
        "Her denetimin ne olduğu, nasıl ve ne sıklıkla bakıldığı: <b>Yardım ▸ Denetim türleri</b>.</div>";
    },

    /** @param data {Map} GET /api/device-health yanıtı */
    setData(data) {
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const P = ankamon.ui.health.Status.PATH;
      const text = ankamon.ui.health.Status.levelText;
      this.__data = data;
      const paths = data.paths || [];
      const legend = this.__legendHtml(paths);
      this.getButton().setToolTipText(legend);
      this.__info.setToolTipText(legend);
      const when = ankamon.ui.health.Status.when;

      const order = { bad: 3, warn: 2, info: 1, ok: 0 };
      const byDevice = new Map();
      (data.findings || []).forEach(f => {
        const key = f.device_id ?? f.device;
        if (!byDevice.has(key)) {
          byDevice.set(key, []);
        }
        byDevice.get(key).push(f);
      });
      const deviceIds = new Set();
      this.__deviceRows = (data.devices || []).map(b => {
        deviceIds.add(b.id);
        const list = byDevice.get(b.id) || [];
        const worst = list.reduce((w, f) => (order[f.level] > order[w] ? f.level : w), "ok");
        const ssh = paths.includes("ssh") ? b.ssh || false : null;
        const last = this.__lastText(list, ssh, when);
        // Denetlenemeyen cihazda "Denetlenemedi" bilgi bulgusu ayrıca yazılmaz; Uzak bağlantı durumu sona eklenir.
        const shown = list.filter(f => f.check !== "Denetlenemedi");
        const notes = ssh === false ? ["Uzak bağlantı: hiç denetlenmedi"] : ssh && ssh.status !== "ok" ? ["Uzak bağlantı: denetlenemedi"] : [];
        const findings = [shown.length || !notes.length ? this.__pathText(shown) : ""].concat(notes).filter(Boolean).join(" · ");
        return { id: b.id, name: b.name, level: worst,
          cells: [b.id, b.name, b.online ? "Açık" : "Kapalı", this.__statusText(worst, list), findings, last, list.length] };
      });
      // Kaydı silinmiş cihazın süren bulguları da görünsün.
      byDevice.forEach((list, key) => {
        if (typeof key === "number" && deviceIds.has(key)) {
          return;
        }
        const worst = list.reduce((w, f) => (order[f.level] > order[w] ? f.level : w), "ok");
        this.__deviceRows.push({ id: key, name: list[0].device, level: worst, cells: [key, list[0].device || "?", "—",
          this.__statusText(worst, list), this.__pathText(list), this.__lastText(list, null, when), list.length] });
      });
      // Varsayılan sıra: Acil → Dikkat → Bilgi → Sorun yok (kullanıcı başka sütunla sıralarsa o geçerli — persistSort).
      this.__deviceRows.sort((a, b) => (order[b.level] - order[a.level]) ||
        String(a.name).localeCompare(String(b.name), "tr", { numeric: true }));

      this.__findingRows = (data.findings || []).map(f => ({
        finding: f,
        cells: [f.device_id ?? f.device, f.device || "?", text(f.level), f.check, P[f.path] ? P[f.path].text : f.path,
          f.source || "", f.how || "", f.every || "", f.since ? F.dateTime(f.since * 1000) : "",
          (f.text || "") + (f.advice ? ` — Öneri: ${f.advice}` : "")]
      }));

      const devicesBad = this.__deviceRows.filter(r => r.level === "bad").length;
      const devicesWarn = this.__deviceRows.filter(r => r.level === "warn").length;
      const color = devicesBad ? "#c5221f" : devicesWarn ? "#e37400" : "#1e8e3e";
      this.__summary.setValue(`<span style="font-size:14px;font-weight:bold;color:${color}">` +
        (devicesBad || devicesWarn
          ? [devicesBad && `${devicesBad} cihazda acil`, devicesWarn && `${devicesWarn} cihazda dikkat gerektiren`].filter(Boolean).join(", ") + " bulgu var"
          : "Şu an acil ya da dikkat gerektiren bulgu yok") +
        `</span> <span style="opacity:.7">· ${esc(String(this.__deviceRows.length))} cihaz · güncellendi ${F.dateTime(data.generated_at * 1000)}</span>`);
      this.__applyDevices();
    },

    /**
     * "Son denetim / bulgu" hücresi: iki yolun en yeni zamanı (SSH denetimi ya da sürekli izlemenin en yeni bulgusu)
     * + cihazın iki yoldaki bulgu sayıları; SSH denetimi yapılamadıysa/hiç yapılmadıysa o da yazılır.
     * @param list {Array} cihazın bulguları @param ssh {Map|false|null} son SSH denetimi (false: hiç; null: yetki yok)
     */
    __lastText(list, ssh, when) {
      const times = list.filter(f => f.path === "watch" && f.since).map(f => f.since);
      if (ssh && ssh.at) {
        times.push(ssh.at);
      }
      const at = times.length ? Math.max(...times) : null;
      const bad = list.filter(f => f.level === "bad").length;
      const warn = list.filter(f => f.level === "warn").length;
      const parts = [at ? when(at) : "", bad || warn ? [bad && `${bad} acil`, warn && `${warn} dikkat`].filter(Boolean).join(", ") : "sorun yok"];
      if (ssh === false) {
        parts.push("SSH: hiç denetlenmedi");
      } else if (ssh && ssh.status !== "ok") {
        parts.push("SSH: denetlenemedi");
      }
      return parts.filter(Boolean).join(" · ");
    },

    /**
     * Bir yolun bulguları düzeyiyle: "Acil: SMART hatası · Dikkat: Disk doluluğu"; bulgu yoksa "Sorun yok". Durum
     * sütunuyla aynı düzey adları (bkz. levelText) — iki sütun Durum'u açıklar, çelişmez.
     */
    __pathText(findings) {
      const text = ankamon.ui.health.Status.levelText;
      const parts = ["bad", "warn", "info"].map(level => {
        const checks = [...new Set(findings.filter(f => f.level === level).map(f => f.check))];
        return checks.length ? `${text(level)}: ${checks.join(", ")}` : "";
      }).filter(Boolean);
      return parts.length ? parts.join(" · ") : "Sorun yok";
    },

    /** Durum hücresi: en kötü düzey ve o düzeydeki uyarılar — "Acil: SMART hatası, Disk doluluğu"; sorun yoksa "Sorun yok". */
    __statusText(worst, list) {
      const text = ankamon.ui.health.Status.levelText;
      const checks = [...new Set(list.filter(f => f.level === worst && f.check !== "Denetlenemedi").map(f => f.check))];
      return worst === "ok" || !checks.length ? text(worst) : `${text(worst)}: ${checks.join(", ")}`;
    },

    __levelKey(label) {
      return Object.keys(ankamon.page.Diagnose.LEVEL).find(k => ankamon.page.Diagnose.LEVEL[k].text === label) || "ok";
    },

    __filtersOf(columns, fields) {
      return columns.map((column, index) => ({ index: index + 1, text: ((fields[column.id] || { getValue: () => "" }).getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
    },

    __applyDevices() {
      if (!this.__deviceRows) {
        return;
      }
      const selected = this.__selectedDevice();
      const filters = this.__filtersOf(this.__deviceColumns, this.__deviceFilters);
      this.__shownDevices = this.__deviceRows.filter(({ cells }) => filters.every(f => ankamon.page.Base.filterMatch(cells[f.index], f.text)));
      this.__deviceTable.getTableModel().setData(this.__shownDevices.map(r => r.cells));
      // Tazelemede seçim korunur.
      const index = selected === null ? -1 : this.__shownDevices.findIndex(r => r.id === selected);
      const sm = this.__deviceTable.getSelectionModel();
      if (index >= 0) {
        sm.setSelectionInterval(index, index);
      } else {
        sm.resetSelection();
      }
      this.__applyFindings();
    },

    __selectedDevice() {
      const sm = this.__deviceTable.getSelectionModel();
      if (sm.isSelectionEmpty()) {
        return null;
      }
      const row = this.__deviceTable.getTableModel().getRowData(sm.getLeadSelectionIndex());
      return row ? row[0] : null;
    },

    __applyFindings() {
      if (!this.__findingRows) {
        return;
      }
      const device = this.__selectedDevice();
      const filters = this.__filtersOf(this.__findingColumns, this.__findingFilters);
      // Cihaz seçilmeden boş (kullanıcı isteği: sekmeye girişte alt tablo boş gelsin).
      this.__shownFindings = device === null ? [] : this.__findingRows.filter(({ cells }) =>
        cells[0] === device && filters.every(f => ankamon.page.Base.filterMatch(cells[f.index], f.text)));
      this.__findingTable.getTableModel().setData(this.__shownFindings.map(r => r.cells));
    }
  }
});
