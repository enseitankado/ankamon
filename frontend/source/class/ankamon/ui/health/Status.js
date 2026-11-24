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
      // Genişlikler oransal (kullanıcı isteği 2026-11-24: sütunlar pencere genişliğine göre boyutlansın) — bkz. FLEX_NOTE.
      { id: "device", label: "Cihaz", width: "2*", minWidth: 120 },
      { id: "online", label: "Açık mı", width: "1*", minWidth: 70, hidden: true },
      // Durum = iki yolun EN KÖTÜSÜ ve o düzeydeki uyarılar ("Acil: SMART hatası, Disk doluluğu") — kullanıcı isteği 2026-11-23.
      { id: "level", label: "Durum", width: "3*", minWidth: 160, hint: "En kötü düzey ve o düzeydeki uyarılar (Log ya da Uzak bağlantı yolundan)" },
      // İki yolun (Log = sürekli izleme şu an, Uzak bağlantı = en son SSH denetimi) bulguları tek sütunda (eskiden iki sütun).
      { id: "findings", label: "Bulgular", width: "4*", minWidth: 180, hint: "Cihazın Log (sürekli izleme) ve Uzak bağlantı (son SSH denetimi) bulguları, düzeyleriyle" },
      // İki yolun en yeni bakışı (SSH denetimi zamanı ya da sürekli izlemenin en yeni bulgusu); acil/dikkat sayıları
      // yazılmaz (kullanıcı isteği 2026-11-24 — Durum sütunu zaten söylüyor). Biçim: bkz. when. Zamana göre sıralanır.
      { id: "last", label: "Son denetim / bulgu", width: "2*", minWidth: 120, hint: "Son SSH denetimi ya da sürekli izlemenin en yeni bulgusu" },
      { id: "count", label: "Bulgu", width: "1*", minWidth: 50, hidden: true }
    ];
    this.__deviceTable = page._createTable(this.__deviceColumns, { prefsKey: "health.status.devices.columns", persistSort: true });
    this.__fitColumns(this.__deviceTable, this.__deviceColumns);
    this.__sortByTime(this.__deviceTable, 5);
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
      { id: "device", label: "Cihaz", width: "3*", minWidth: 110 },
      { id: "level", label: "Düzey", width: "1*", minWidth: 60 },
      { id: "check", label: "Bulgu", width: "3*", minWidth: 120 },
      { id: "path", label: "Yol", width: "2*", minWidth: 80 },
      { id: "source", label: "Kaynak", width: "2*", minWidth: 80 },
      { id: "how", label: "Nasıl bakıldı", width: "4*", minWidth: 140 },
      { id: "every", label: "Sıklık", width: "2*", minWidth: 80 },
      { id: "at", label: "Zaman", width: "2*", minWidth: 90 },
      { id: "text", label: "Ayrıntı", width: "4*", minWidth: 140 }
    ];
    this.__findingTable = page._createTable(this.__findingColumns, { prefsKey: "health.status.findings.columns" });
    this.__fitColumns(this.__findingTable, this.__findingColumns);
    this.__sortByTime(this.__findingTable, 8);
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
    /** Bu kadar saniyeden eski zamanlar yalnız tarihle yazılır (kullanıcı isteği 2026-11-24: 1 günden eskiyse saat gereksiz). */
    RELATIVE_S: 24 * 3600,

    /**
     * epoch sn → 1 günden eskiyse yalnız tarih ("23.11.2026"); daha yeniyse kaba geçen süre: "az önce", "N dk önce"
     * (1 saatten az), "N saat önce" (dakika hassasiyeti yok — kullanıcı isteği 2026-11-24). Gelecekteki zaman: tarih.
     * Hücre metin olduğundan sıralama zaman değerine göre ayrıca kurulur (bkz. __sortByTime).
     */
    when(ts) {
      if (!ts) {
        return "";
      }
      const diff = Math.floor(Date.now() / 1000) - ts;
      if (diff < 0 || diff >= ankamon.ui.health.Status.RELATIVE_S) {
        return new Date(ts * 1000).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
      }
      if (diff < 60) {
        return "az önce";
      }
      return diff < 3600 ? `${Math.floor(diff / 60)} dk önce` : `${Math.floor(diff / 3600)} saat önce`;
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
    /** satır dizisi (hücreler) → zaman sütununun epoch sn değeri (bkz. __sortByTime) */
    __rowTimes: null,

    /**
     * Sütunlar tablonun genişliğini oransal doldurur (qx Resize davranışı, "N*" genişlik + en küçük genişlik): pencere
     * daralıp genişledikçe yeniden dağılır. Kullanıcının elle sürüklediği genişlik, tablo yeniden boyutlanana (pencere
     * değişene) ya da sayfa yeniden açılana dek geçerlidir — saklanmaz (bu tabloların prefsKey'i yalnız sıra/gizlilik
     * saklar); kalıcı elle genişlik oransal doldurmayla çelişirdi (sütunlar tabloyu taşırır ya da boş bırakırdı).
     */
    __fitColumns(table, columns) {
      const behavior = table.getTableColumnModel().getBehavior();
      const offset = table.getUserData("offset") || 1;
      columns.forEach((column, index) => {
        if (column.minWidth) {
          behavior.setMinWidth(index + offset, column.minWidth);
        }
      });
    },

    /** Zaman sütunu (metni "3 saat önce" / "23.11.2026") gerçek zamana göre sıralanır; zamansız satırlar en eski sayılır. */
    __sortByTime(table, column) {
      if (!this.__rowTimes) {
        this.__rowTimes = new WeakMap();
      }
      const times = this.__rowTimes;
      table.getTableModel().setSortMethods(column, (a, b) => (times.get(a) || 0) - (times.get(b) || 0));
    },

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
        (paths.includes("watch") ? `${badge("watch")} Ankamon cihaza bağlanmadan, cihazın gönderdiği loglardan, kendi ` +
          "okuduğu ölçümlerden ve daha önce toplanmış verilerden (ör. ETAP kontrol sonucu) birkaç dakikada bir çıkarır — " +
          "verinin nereden geldiği Kaynak sütununda; burada yalnız şu an sürenler. " : "") +
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
        const at = this.__lastAt(list, ssh);
        const last = this.__lastText(at, ssh, when);
        // Denetlenemeyen cihazda "Denetlenemedi" bilgi bulgusu ayrıca yazılmaz; Uzak bağlantı durumu sona eklenir.
        const shown = list.filter(f => f.check !== "Denetlenemedi");
        const notes = ssh === false ? ["Uzak bağlantı: hiç denetlenmedi"] : ssh && ssh.status !== "ok" ? ["Uzak bağlantı: denetlenemedi"] : [];
        const findings = [shown.length || !notes.length ? this.__pathText(shown) : ""].concat(notes).filter(Boolean).join(" · ");
        const cells = [b.id, b.name, b.online ? "Açık" : "Kapalı", this.__statusText(worst, list), findings, last, list.length];
        this.__rowTimes.set(cells, at);
        return { id: b.id, name: b.name, level: worst, cells };
      });
      // Kaydı silinmiş cihazın süren bulguları da görünsün.
      byDevice.forEach((list, key) => {
        if (typeof key === "number" && deviceIds.has(key)) {
          return;
        }
        const worst = list.reduce((w, f) => (order[f.level] > order[w] ? f.level : w), "ok");
        const at = this.__lastAt(list, null);
        const cells = [key, list[0].device || "?", "—", this.__statusText(worst, list), this.__pathText(list),
          this.__lastText(at, null, when), list.length];
        this.__rowTimes.set(cells, at);
        this.__deviceRows.push({ id: key, name: list[0].device, level: worst, cells });
      });
      // Varsayılan sıra: Acil → Dikkat → Bilgi → Sorun yok (kullanıcı başka sütunla sıralarsa o geçerli — persistSort).
      this.__deviceRows.sort((a, b) => (order[b.level] - order[a.level]) ||
        String(a.name).localeCompare(String(b.name), "tr", { numeric: true }));

      this.__findingRows = (data.findings || []).map(f => {
        // Zaman: üst tablodaki gibi (1 günden eskiyse yalnız tarih, saniye/dakika hassasiyeti yok — kullanıcı isteği 2026-11-24).
        const cells = [f.device_id ?? f.device, f.device || "?", text(f.level), f.check, P[f.path] ? P[f.path].text : f.path,
          f.source || "", f.how || "", f.every || "", f.since ? when(f.since) : "",
          (f.text || "") + (f.advice ? ` — Öneri: ${f.advice}` : "")];
        this.__rowTimes.set(cells, f.since || 0);
        return { finding: f, cells };
      });

      const devicesBad = this.__deviceRows.filter(r => r.level === "bad").length;
      const devicesWarn = this.__deviceRows.filter(r => r.level === "warn").length;
      const color = devicesBad ? "#c5221f" : devicesWarn ? "#e37400" : "#1e8e3e";
      this.__summary.setValue(`<span style="font-size:14px;font-weight:bold;color:${color}">` +
        (devicesBad || devicesWarn
          ? [devicesBad && `${devicesBad} cihazda acil`, devicesWarn && `${devicesWarn} cihazda dikkat gerektiren`].filter(Boolean).join(", ") + " bulgu var"
          : "Şu an acil ya da dikkat gerektiren bulgu yok") +
        `</span> <span style="opacity:.7">· ${esc(String(this.__deviceRows.length))} cihaz · güncellendi ${new Date(data.generated_at * 1000).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>`);
      this.__applyDevices();
    },

    /**
     * İki yolun en yeni zamanı (SSH denetimi ya da sürekli izlemenin en yeni bulgusu), epoch sn; yoksa 0.
     * @param list {Array} cihazın bulguları @param ssh {Map|false|null} son SSH denetimi (false: hiç; null: yetki yok)
     */
    __lastAt(list, ssh) {
      const times = list.filter(f => f.path === "watch" && f.since).map(f => f.since);
      if (ssh && ssh.at) {
        times.push(ssh.at);
      }
      return times.length ? Math.max(...times) : 0;
    },

    /**
     * "Son denetim / bulgu" hücresi: en yeni zaman (bkz. __lastAt, when); SSH denetimi yapılamadıysa/hiç yapılmadıysa o da
     * yazılır. Acil/dikkat sayıları yazılmaz (kullanıcı isteği 2026-11-24).
     */
    __lastText(at, ssh, when) {
      const parts = [at ? when(at) : ""];
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
