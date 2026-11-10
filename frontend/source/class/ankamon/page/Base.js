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
 * Sayfaların ortak tabanı: başlık, araç satırı ve içerik alanı.
 * Alt sınıflar _refresh() metodunu doldurur; sayfa her açıldığında çağrılır.
 */
qx.Class.define("ankamon.page.Base", {
  extend: qx.ui.container.Composite,
  type: "abstract",

  statics: {
    // Sayfanın sekmesi değişti ({page, tab}) — ui.Shell ağaçtaki sekme yaprağını vurgular.
    TAB_CHANGED: "ankamon.tabChanged",

    /**
     * Kullanıcının seçtiği sütun sıralaması veri yenilenince kaybolmasın (kullanıcı bildirimi: Tahtalar sıralaması kısa
     * süre sonra varsayılana dönüyordu). qx Simple.setData() varsayılan olarak sıralamayı siler; sayfalar kendini
     * tazeledikçe sıralama gidiyordu. Bu sarmalayıcıyla parametresiz setData(rows) sıralamayı korur ve yeni veriyi aynı
     * sütun/yönde yeniden dizer. Açık parametre verenler değişmez: setData(rows, true) siler, setData(rows, false) korur
     * ama yeniden dizmez (ör. Ağ: cihazın altındaki port satırları kendi sırasında kalsın).
     * Yalnız _createTable'ın kendi Simple modeline uygulanır; kendi sıralamasını yöneten modeller (GroupModel) hariç.
     */
    /**
     * Sayfa dışında (pencerede) kendi kurduğu qx.ui.table.Table'a da sütun süzgeçleri + hazır değer listeleri (kullanıcı
     * isteği 2026-11-10: BÜTÜN grid'ler — Ping, SSH etkinliği, Görev yöneticisi, Dosya yöneticisi, Web filtresi, oturum
     * işlemleri…). Satırlar yine model.setData ile verilir (bkz. _makeFilterable). Satır NUMARASIYLA veri bulan kod
     * süzmeden sonra kayar — satırın kendi değerlerinden (kimlik sütunu vb.) bulunmalı.
     * @param table {qx.ui.table.Table} @param opts {Map?} {offset: süzgeçsiz baştaki sütun sayısı (varsayılan 0),
     *   columns: [{id, label, choices?}] (varsayılan: modelin offset'ten sonraki bütün sütunları),
     *   choicesFor: [sütun kimliği ya da başlığı] — bu sütunlarda hazır liste HER ZAMAN (az satırda/tek değerde de)}
     * @return {Map} süzgeç kutuları
     */
    filterTable(table, opts = {}) {
      const model = table.getTableModel();
      const offset = opts.offset || 0;
      const columns = opts.columns || Array.from({ length: model.getColumnCount() - offset }, (_, i) =>
        ({ id: model.getColumnId(i + offset), label: model.getColumnName(i + offset) }));
      (opts.choicesFor || []).forEach(key => columns.filter(c => c.id === key || c.label === key).forEach(c => { c.choices = true; }));
      table.setUserData("offset", offset);
      return Object.create(ankamon.page.Base.prototype)._makeFilterable(table, columns);
    },

    keepSortOnReload(model) {
      const setData = model.setData;
      model.setData = function(rows, clearSorting) {
        if (clearSorting !== undefined) {
          return setData.call(this, rows, clearSorting);
        }
        const column = this.getSortColumnIndex();
        const ascending = this.isSortAscending();
        setData.call(this, rows, false);
        if (column >= 0) {
          this.sortByColumn(column, ascending);
        }
        return undefined;
      };
    },

    // Hazır değer listesi (süzgeç kutusunun ▾ düğmesi) en çok bu kadar farklı değerli sütunda çıkar.
    CHOICES_MAX: 25,

    /**
     * Hücre değerinin süzgeçte karşılaştırılan biçimi: HTML etiketsiz, kırpılmış, küçük harf. I/ı/İ/i ayrımı
     * yapılmaz (ör. "IP" → "ip"): çağıranlar süzgeç metnini toLowerCase ile küçültebiliyor, dil kuralına göre
     * küçültme ("ıp") onunla eşleşmezdi.
     */
    filterText(value) {
      return ankamon.page.Base.__fold(String(value ?? "").replace(/<[^>]*>/g, "").trim());
    },

    __fold(text) {
      return text.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/\u0307/g, "");
    },

    /**
     * Sütun süzgeci eşleşmesi — bütün grid'ler bunu kullanır (düz `includes` yerine). Süzgeç metni "|"
     * ile ayrılmış terimlerden oluşabilir, biri tutarsa satır kalır (VEYA). Tırnaklı terim ("Kapalı") tam
     * eşleşmedir (hazır listeden seçilenler böyle yazılır; "" = boş hücre), tırnaksız terim içerir-eşleşmesi.
     * @param value {var} hücre değeri @param text {String} süzgeç kutusunun metni
     */
    filterMatch(value, text) {
      const query = String(text ?? "").trim();
      if (!query) {
        return true;
      }
      const cell = ankamon.page.Base.filterText(value);
      return query.split("|").some(raw => {
        const term = ankamon.page.Base.__fold(raw.trim());
        if (term.length >= 2 && term.startsWith('"') && term.endsWith('"')) {
          return cell === term.slice(1, -1);
        }
        return term !== "" && cell.includes(term);
      });
    },

    /** Süzgeç metni yalnız tırnaklı terimlerden mi oluşuyor (hazır listeden seçim) — seçili değerler, yoksa null. */
    parseChoices(text) {
      const terms = String(text ?? "").split("|").map(t => t.trim()).filter(Boolean);
      if (!terms.length || !terms.every(t => t.length >= 2 && t.startsWith('"') && t.endsWith('"'))) {
        return null;
      }
      return terms.map(t => t.slice(1, -1));
    },

    // Çok değişken (her satırda farklı olabilecek) değer biçimleri: tarih, saat, süre, sayı/boyut/yüzde.
    __VARIABLE: [
      /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/, /\d{4}-\d{2}-\d{2}/, /\b\d{1,2}:\d{2}\b/,
      /^[-+]?\d+([.,]\d+)?\s*(%|°c|[kmgt]?i?b|ms|sn|dk|sa|gün|saat|dakika|saniye|rpm|v|mhz|ghz|mbit\/sn|mb\/sn)?$/i,
      /\b\d+\s*(sa|dk|sn|gün|saat|dakika|saniye)\b/i,
      /^%\s*\d/ // Türkçe yüzde ("%12")
    ],

    /**
     * Sütunun değerleri hazır listeye uygun mu (kullanıcı isteği: yalnız az çeşitli sütunlarda; tarih/saat/
     * süre gibi çok değişken sütunlarda liste satır sayısı kadar büyüyebileceğinden çıkmaz). Uygun: en az 2,
     * en çok CHOICES_MAX farklı değer, farklı değer sayısı satır sayısından az (her satırı ayrı değerli sütun
     * — ad, IP — değil) ve değerlerin yarısından azı tarih/saat/süre/sayı biçiminde.
     * @param values {String[]} sütunun bütün satırlardaki değerleri (filterText'ten geçmiş değil, ham)
     */
    choicesSuitable(values) {
      const B = ankamon.page.Base;
      const distinct = new Set(values.map(v => B.filterText(v)));
      if (distinct.size < 2 || distinct.size > B.CHOICES_MAX || distinct.size >= values.length) {
        return false;
      }
      const filled = [...distinct].filter(Boolean);
      const variable = filled.filter(v => B.__VARIABLE.some(re => re.test(v))).length;
      return variable * 2 < filled.length;
    },
    _canvas: null,

    /**
     * Sütun sırası ve gizlenen sütunlar (kullanıcı isteği: tüm grid'lerde) kullanıcı başına sunucuda
     * (users.ui_prefs["<key>.order"/"<key>.hidden"], bkz. AuthApi::prefs) saklanır; tablo kurulurken
     * oradan okunup uygulanır. Sıra: başlık sürüklenerek değiştirilir (qx yerleşik). Kullanıcı sütunları
     * dışındakiler (baştaki kimlik/işaret = `offset` kadar, sondaki iç sütunlar) yerinde tutulur ve
     * sütun menüsünde görünmez. Kayıtta olmayan (sonradan eklenen) sütunlar sona, varsayılan sırayla eklenir.
     * Sayfa dışından da kullanılır (ör. ui.files.Pane).
     * @param columns {Array} kullanıcı sütunları [{id}] — tablo modelinde `offset`'ten itibaren bu sırayla
     * @param user {Map} oturum sahibi (ui_prefs okunur/yazılır)
     * @param withWidths {Boolean} storageKey'li tablo: menünün baş kısmını __setupColumnPrefs düzenler
     */
    setupColumnLayout(table, columns, offset, key, user, withWidths = false) {
      const self = ankamon.page.Base;
      const columnModel = table.getTableColumnModel();
      const prefs = user.ui_prefs || (user.ui_prefs = {});
      const orderKey = key + ".order";
      const hiddenKey = key + ".hidden";
      const total = table.getTableModel().getColumnCount();
      const userCol = col => col >= offset && col < offset + columns.length;
      const fixed = Array.from({ length: total }, (_, i) => i).filter(col => !userCol(col));
      const lead = fixed.filter(col => col < offset);
      const tail = fixed.filter(col => col >= offset);
      const build = userCols => lead.concat(userCols, tail);

      if (!withWidths) {
        // storageKey'li tablolarda gizleme __setupColumnPrefs'te uygulanır (localStorage geçişiyle birlikte).
        const hidden = prefs[hiddenKey] || [];
        columns.forEach((column, index) => {
          if (hidden.includes(column.id)) {
            columnModel.setColumnVisible(index + offset, false);
          }
        });
        columnModel.addListener("visibilityChanged", () => {
          self.savePref(user, hiddenKey, columns
            .filter((column, index) => !columnModel.isColumnVisible(index + offset))
            .map(column => column.id));
        });
      }

      let applying = false;
      const apply = order => {
        applying = true;
        try {
          columnModel.setColumnsOrder(order);
        } finally {
          applying = false;
        }
      };
      const defaultUserCols = columns.map((column, index) => index + offset);
      const saved = prefs[orderKey];
      if (Array.isArray(saved) && saved.length) {
        const byId = new Map(columns.map((column, index) => [column.id, index + offset]));
        const cols = [];
        saved.forEach(id => {
          if (byId.has(id) && !cols.includes(byId.get(id))) {
            cols.push(byId.get(id));
          }
        });
        // Kayıtlı sırada olmayan (sonradan eklenmiş) sütun sona değil, varsayılan sıradaki önceki sütunun
        // hemen arkasına girer (ör. 'Kablosuz MAC' 'Kablolu MAC'ın yanına) — kullanıcı isteği.
        defaultUserCols.forEach((col, i) => {
          if (!cols.includes(col)) {
            const prev = i > 0 ? cols.indexOf(defaultUserCols[i - 1]) : -1;
            cols.splice(prev + 1, 0, col);
          }
        });
        apply(build(cols));
      }

      columnModel.addListener("orderChanged", () => {
        if (applying) {
          return;
        }
        const now = Array.from({ length: total }, (_, x) => columnModel.getOverallColumnAtX(x));
        const cols = now.filter(userCol);
        const order = build(cols);
        // İşaret/iç sütun sürüklenip başka yere bırakıldıysa yerine geri alınır.
        if (order.some((col, x) => now[x] !== col)) {
          apply(order);
        }
        const isDefault = cols.every((col, i) => col === defaultUserCols[i]);
        self.savePref(user, orderKey, isDefault ? null : cols.map(col => columns[col - offset].id));
      });

      table.addListener("columnVisibilityMenuCreateEnd", e => {
        const menu = e.getData().menu;
        if (!withWidths) {
          // Menü sırası = Table'ın x sırası (i. düğme = getOverallColumnAtX(i)); kullanıcı sütunu
          // olmayanlar (kimlik/işaret/iç) gizlenemez → menüden çıkarılır.
          const children = menu.getChildren().slice();
          children.forEach((button, i) => {
            if (i < total && !userCol(columnModel.getOverallColumnAtX(i))) {
              menu.remove(button);
            }
          });
          menu.add(new qx.ui.menu.Separator());
        }
        const reset = new qx.ui.menu.Button("Sütun sırasını sıfırla");
        reset.setToolTipText("Sütun başlıklarını sürükleyerek sıralayabilirsiniz; bu seçenek varsayılan sıraya döndürür.");
        reset.addListener("execute", () => {
          apply(build(defaultUserCols));
          self.savePref(user, orderKey, null);
        });
        menu.add(reset);
      });
    },

    /**
     * Sütun başlığıyla yapılan sıralama kullanıcı başına sunucuda (users.ui_prefs["<key>.sort"] = {id, asc}, bkz.
     * AuthApi::prefs) saklanır ve tablo kurulurken geri yüklenir (kullanıcı isteği: Tahtalar). Sıralama kalkınca
     * (clearSorting) kayıt silinir. Model keepSortOnReload'lu olmalı (veri gelince kayıtlı sıra korunur).
     * @param columns {Array} kullanıcı sütunları [{id}] — tablo modelinde `offset`'ten itibaren bu sırayla
     */
    rememberSort(table, columns, offset, key, user) {
      const model = table.getTableModel();
      const prefs = user.ui_prefs || (user.ui_prefs = {});
      const sortKey = key + ".sort";
      const saved = prefs[sortKey];
      const index = saved && columns.findIndex(column => column.id === saved.id);
      if (index >= 0 && index !== null) {
        model.sortByColumn(index + offset, saved.asc !== false);
      }
      let last = JSON.stringify(saved || null);
      model.addListener("metaDataChanged", () => {
        const col = model.getSortColumnIndex();
        const column = col >= offset ? columns[col - offset] : null;
        const value = column ? { id: column.id, asc: model.isSortAscending() } : null;
        const text = JSON.stringify(value);
        if (text !== last) {
          last = text;
          ankamon.page.Base.savePref(user, sortKey, value);
        }
      });
    },

    /**
     * Süzgeç kutularının değerlerini kullanıcı başına saklar/geri yükler (users.ui_prefs["<anahtar>.filters"] =
     * {sütun id: metin}; boşsa kayıt silinir). Kayıt, yazım bitince (600 ms) bir kez gider.
     * @param fields {Map} {columnId: TextField} — _addColumnFilters'ın (yedek kutular gerçeğiyle yer değiştirir)
     * @param keyOf {Function} o anki anahtar (null/boş: saklanmaz)
     * @return {Map} {restore(), save()}
     */
    filterPersistence(fields, keyOf, user) {
      const B = ankamon.page.Base;
      let restoring = false;
      let timer = null;
      const name = () => {
        const key = keyOf();
        return key ? key + ".filters" : null;
      };
      return {
        restore() {
          const key = name();
          const saved = (key && (user.ui_prefs || {})[key]) || {};
          restoring = true;
          try {
            Object.keys(fields).forEach(id => {
              const value = typeof saved[id] === "string" ? saved[id] : "";
              if ((fields[id].getValue() || "") !== value) {
                fields[id].setValue(value);
              }
            });
          } finally {
            restoring = false;
          }
        },
        save() {
          if (restoring) {
            return;
          }
          const key = name();
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (!key || key !== name()) {
              return; // bu arada görünüm değişti: eski görünümün değeri yeni anahtara yazılmaz
            }
            const value = {};
            Object.keys(fields).forEach(id => {
              const text = (fields[id].getValue() || "").trim();
              if (text) {
                value[id] = text;
              }
            });
            const next = Object.keys(value).length ? value : null;
            if (JSON.stringify(next) !== JSON.stringify((user.ui_prefs || {})[key] || null)) {
              B.savePref(user, key, next);
            }
          }, 600);
        }
      };
    },

    /** Tek bir arayüz tercihini sunucuya yazar (bkz. AuthApi::prefs); null anahtarı siler. */
    savePref(user, name, value) {
      const prefs = user.ui_prefs || (user.ui_prefs = {});
      if (value === null) {
        delete prefs[name];
      } else {
        prefs[name] = value;
      }
      ankamon.io.Api.put("/auth/prefs", { key: name, value }).catch(() => {
        // Kalıcılık kaybı önemsiz: bir sonraki değişiklikte yeniden gönderilir.
      });
    },

    /** Metnin tablo yazı tipiyle piksel genişliği (otomatik sütun genişliği için; canvas ile hızlı). */
    _textWidth(text) {
      const self = ankamon.page.Base;
      if (!self._canvas) {
        self._canvas = document.createElement("canvas").getContext("2d");
        const font = qx.theme.manager.Font.getInstance().resolve("default");
        const st = font && font.getStyles ? font.getStyles() : {};
        const size = typeof st.fontSize === "number" ? st.fontSize + "px" : (st.fontSize || "13px");
        self._canvas.font = `${st.fontWeight || "normal"} ${size} ${st.fontFamily || "sans-serif"}`;
      }
      return self._canvas.measureText(text).width;
    }
  },

  /**
   * @param user {Map} oturum sahibi
   * @param title {String?} sayfa başlığı; boşsa başlık satırı gösterilmez (ör. sekmeleri kendi
   *   başlığı olan sayfalar — kullanıcı isteği)
   */
  construct(user, title) {
    super(new qx.ui.layout.VBox(12));
    this._user = user;

    // Sayfa başlığı gösterilmez: üst başlıktaki yol gösterimi ("Ankamon > Tahtalar", bkz. ui.ShellNavPath) yerini
    // tuttu, dikey alan kazanıldı (kullanıcı isteği). Etiket yine kurulur (sayfalar değerini değiştirebiliyor, ör. Logs).
    this._toolbar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    if (title) {
      this._toolbar.add(new qx.ui.basic.Label(title).set({ font: "headline" }));
    }
    this._toolbar.exclude();
    this.add(this._toolbar);

    // Düğmeler ayrı, sarılabilen bir satırda: pencere daralınca kesilmek yerine alt satıra geçerler.
    // qx.ui.layout.Flow, VBox içinde doğal (tek satırlık) genişliğini üst kapsayıcıya dayatıp ondan
    // daha az yer verilmesini reddediyor (Stack/SplitPane zincirinde gözlemlendi: üst öğeler Flow'un
    // içerik genişliğine göre büyüyor, Flow asla sarmıyordu). Bu yüzden genişliği, sayfanın kendi
    // "resize" olayında elle sayfanın genişliğine kilitliyoruz; Flow o zaman zorunlu olarak sarar.
    this._actions = new qx.ui.container.Composite(new qx.ui.layout.Flow(6, 6));
    this.add(this._actions);
    this.addListener("resize", e => {
      const width = e.getData().width;
      if (width) {
        this._actions.setWidth(width);
      }
    });
  },

  members: {
    __tabView: null,
    __pendingTab: null,
    _user: null,
    _toolbar: null,
    _actions: null,
    _compact: false,

    /** Shell sayfayı her gösterdiğinde çağırır. */
    activate() {
      this.refresh();
    },

    async refresh() {
      try {
        await this._refresh();
      } catch (e) {
        if (e.status !== 401) {
          ankamon.ui.Dialog.error(e);
        }
      }
    },

    /** @abstract */
    async _refresh() {},

    _can(feature) {
      return this._user.is_admin || this._user.features.includes(feature);
    },

    /**
     * Düğme satırına (sarılabilir) bir düğme ekler. `this._compact = true` ayarlanmış sayfalarda
     * (çok düğmeli, kalabalık araç çubukları — ör. Tahtalar) düğmeler küçük dolgu + küçük yazı
     * tipiyle eklenir, satır daha az yer kaplar.
     */
    _addButton(label, handler) {
      const button = new qx.ui.form.Button(label);
      button.addListener("execute", handler, this);
      if (this._compact) {
        // Yalnız YATAY dolgu: dikey dolgu temada kalır. Bazı temalar (ör. SilverBlue [1, 7, 4, 5]) çerçeve
        // asimetrisini dikey dolguyla dengeler; eşit dikey dolgu etiketi alt kenara itiyordu.
        button.set({ paddingLeft: 9, paddingRight: 9, font: "small" });
      }
      this._actions.add(button);
      return button;
    },

    /**
     * Sütun tanımlarından tablo üretir. İlk sütun gizli kimlik sütunudur.
     * @param columns {Array} [{id, label, width?}] — width verilmeyen sütunlar esner
     * @param opts {Map} {checkable: true} verilirse, kimlikten hemen sonra tıklanabilir bir
     *   onay kutusu sütunu eklenir (satır başı çoklu seçim); bkz. _checkedIds/_checkAll.
     *   {storageKey: "ör. boards.columns"} verilirse: genişlikler içeriğe göre otomatik ayarlanır,
     *   kullanıcının elle ayarladığı genişlikler ve gizlenen sütunlar sunucuda saklanır, tablonun
     *   yerleşik sütun menüsü (sağ üstte) açılır — bkz. __setupColumnPrefs.
     *   {prefsKey: "ör. logs.columns"}: genişlikler OLDUĞU gibi (width/esnek) kalır; yalnız sütun sırası
     *   (başlığı sürükleyerek) ve gizlenen sütunlar kullanıcı başına sunucuda saklanır (storageKey de bunları yapar).
     *   {persistSort: true} (storageKey/prefsKey ile): sütun başlığıyla yapılan sıralama da kullanıcı başına saklanır
     *   (bkz. rememberSort — "<anahtar>.sort").
     *   {filterable: true}: kendi süzgeç mantığı olmayan grid'e sütun süzgeçleri ve hazır değer listeleri (bkz. _makeFilterable).
     */
    _createTable(columns, opts = {}) {
      const prefsKey = opts.storageKey || opts.prefsKey;
      const leadLabels = opts.checkable ? ["id", ""] : ["id"];
      const leadIds = opts.checkable ? ["id", "__checked"] : ["id"];
      const model = opts.model || new qx.ui.table.model.Simple();
      if (!opts.model) {
        ankamon.page.Base.keepSortOnReload(model);
      }
      model.setColumns(leadLabels.concat(columns.map(c => c.label)), leadIds.concat(columns.map(c => c.id)));
      const table = new qx.ui.table.Table(model, {
        tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj)
      }).set({
        statusBarVisible: false,
        columnVisibilityButtonVisible: !!prefsKey,
        rowHeight: 28
      });
      const columnModel = table.getTableColumnModel();
      columnModel.setColumnVisible(0, false);
      const behavior = columnModel.getBehavior();

      let offset = 1;
      if (opts.checkable) {
        // Onay kutusu salt-görsel (metin "✓"; qx.ui.table.cellrenderer.Boolean'ın resim simgeleri
        // Tangible temasında yok ve görünmez kalıyordu — bkz. ankamon.ui.table.CheckRenderer).
        columnModel.setDataCellRenderer(1, new ankamon.ui.table.CheckRenderer());
        behavior.setWidth(1, 32);
        // İşaretleme kuralları (kullanıcı isteği): düz tıklama yalnız satırı vurgular, işareti
        // değiştirmez. İşaret değişir: onay kutusu sütununa tıklayınca (aç/kapa), Ctrl/⌘+tıklamada
        // (o satırı aç/kapa) ve Shift+tıklamada (son tıklanan satırdan bu satıra kadarki aralık
        // işaretlenir — Explorer'daki aralık seçimi gibi). Shift'li aralık, işaretlemenin YANINDA
        // o satırların seçim ışıklandırmasını da uygulasın diye seçim kipi çoklu aralığa açılır.
        table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
        let anchor = null;
        // Zaten TEK BAŞINA ışıklı olan satıra düz tıklama da işareti aç/kapa yapar (kullanıcı isteği):
        // ilk tıklama yalnız ışıklandırır, ışıklı satıra ikinci tıklama işaretler, üçüncüsü kaldırır.
        // "Önceden ışıklı mıydı" bilgisi tıklama anında artık kaybolmuş olduğundan (seçim tıklamayla
        // değişir) son düz tıklanan satırın KİMLİĞİ tutulur; seçim başka yoldan (klavye, başka satır)
        // değişince sıfırlanır. Kimlik (satır no değil): tablo 5 sn'de bir yenilenip yeniden sıralanabilir.
        let litId = null;
        let toggles = []; // [{row, at}] — çift tıklamanın tıklamalarının işaret değişikliklerini geri almak için
        const singleSelectedId = () => {
          const rows = [];
          table.getSelectionModel().iterateSelection(r => rows.push(r));
          return rows.length === 1 ? table.getTableModel().getValue(0, rows[0]) : null;
        };
        table.getSelectionModel().addListener("changeSelection", () => {
          if (singleSelectedId() !== litId) {
            litId = null;
          }
        });
        table.addListener("cellTap", e => {
          const tm = table.getTableModel();
          const row = e.getRow();
          if (row === null || row === undefined) {
            return;
          }
          const id = tm.getValue(0, row);
          if (e.isShiftPressed() && anchor !== null && anchor < tm.getRowCount()) {
            const lo = Math.min(anchor, row);
            const hi = Math.max(anchor, row);
            for (let r = lo; r <= hi; r++) {
              tm.setValue(1, r, true);
            }
            table.getSelectionModel().setSelectionInterval(lo, hi);
            litId = null;
            return; // çapa yerinde kalır: Shift ile aralık genişletilebilir
          }
          const modifier = e.isCtrlPressed() || e.isMetaPressed();
          if (e.getColumn() === 1 || modifier || (litId !== null && litId === id && singleSelectedId() === id)) {
            tm.setValue(1, row, !tm.getValue(1, row));
            toggles = toggles.filter(t => Date.now() - t.at < 600).concat({ row, at: Date.now() });
          }
          litId = modifier ? null : id;
          anchor = row;
        });
        // Çift tıklama (ör. Tahtalar'da Düzenle) iki tıklama üretir; bunlar yukarıdaki kurala göre işareti
        // bir ya da iki kez değiştirmiş olabilir — çift tıklamanın amacı işaretlemek olmadığından net
        // değişiklik (tek sayıda değişiklik) geri alınır. Onay kutusu sütunundaki çift tıklama hariç.
        table.addListener("cellDbltap", e => {
          const row = e.getRow();
          const n = toggles.filter(t => t.row === row && Date.now() - t.at < 600).length;
          if (e.getColumn() !== 1 && n % 2 === 1) {
            const tm = table.getTableModel();
            tm.setValue(1, row, !tm.getValue(1, row));
          }
          toggles = [];
        });
        // Başlıkta onay kutusu (kullanıcı isteği): gösterilen (süzülmüş) satırların tümünü işaretler/kaldırır,
        // durumu da yansıtır (hepsi / hiçbiri / bir kısmı). Sütun sıralanmaz (başlık tıklaması kutunun).
        const header = new ankamon.ui.table.CheckHeaderRenderer(on => this._checkAll(table, on));
        columnModel.setHeaderCellRenderer(1, header);
        model.setColumnSortable(1, false);
        let syncPending = false;
        const syncHeader = () => {
          const tm = table.getTableModel();
          const can = table.getUserData("checkableRow");
          let total = 0;
          let checked = 0;
          for (let row = 0; row < tm.getRowCount(); row++) {
            if (!can || can(tm.getValue(0, row))) {
              total++;
              checked += tm.getValue(1, row) ? 1 : 0;
            }
          }
          header.sync(checked, total);
        };
        // Veri yenilenince (süzgeç/yenileme) satır sırası değişebilir; eski çapa geçersizdir.
        model.addListener("dataChanged", e => {
          const d = e.getData();
          if (!d || d.firstColumn !== 1 || d.lastColumn !== 1) {
            anchor = null;
          }
          // Toplu işaretleme satır başına bir olay üretir; başlık bir kez, döngü bitince güncellenir.
          if (!syncPending) {
            syncPending = true;
            Promise.resolve().then(() => {
              syncPending = false;
              if (!table.isDisposed()) {
                syncHeader();
              }
            });
          }
        });
        // Ctrl/⌘+A (kullanıcı isteği): tabloda hâlâ görünen (süzülmüş) TÜM satırları işaretler VE
        // seçili (ışıklandırılmış) yapar — zaten hepsi işaretliyse ikisi de kalkar (aç/kapa).
        table.addListener("keydown", e => {
          if (!(e.isCtrlPressed() || e.isMetaPressed()) || e.getKeyIdentifier() !== "A") {
            return;
          }
          e.preventDefault();
          const rowCount = table.getTableModel().getRowCount();
          if (!rowCount) {
            return;
          }
          const allChecked = this._checkedIds(table).length === rowCount;
          this._checkAll(table, !allChecked);
          if (allChecked) {
            table.getSelectionModel().resetSelection();
          } else {
            table.getSelectionModel().setSelectionInterval(0, rowCount - 1);
          }
        });
        offset = 2;
      }
      table.setUserData("offset", offset);

      if (opts.storageKey) {
        this.__setupColumnPrefs(table, columns, offset, opts.storageKey);
      } else {
        columns.forEach((column, index) => {
          behavior.setWidth(index + offset, column.width || "1*"); // width yoksa esner
        });
      }
      if (prefsKey) {
        ankamon.page.Base.setupColumnLayout(table, columns, offset, prefsKey, this._user, !!opts.storageKey);
        table.setUserData("prefsKey", prefsKey);
        // Cihaz grid'leri (kullanıcı isteği 2026-11-10): başlıkla yapılan sıralama oturum sahibinde saklanır, geri yüklenir.
        if (opts.persistSort) {
          ankamon.page.Base.rememberSort(table, columns, offset, prefsKey, this._user);
        }
      }
      if (opts.filterable) {
        this._makeFilterable(table, columns);
      }
      return table;
    },

    /**
     * storageKey'li tablolarda sütun genişliği ve görünürlüğü (kullanıcı isteği):
     *  - Genişlikler İÇERİĞE göre otomatik: her veri değişiminde başlık ve hücre metinleri ölçülüp
     *    hiçbir sütun kırpılmayacak genişliğe getirilir (esnek "1*" sütun yok — dar pencerede yatay
     *    kaydırma çıkar, sütun sıfıra inmez). Sütun tanımındaki width yalnız ilk çizim içindir.
     *  - Kullanıcı bir sütunu sürükleyerek boyutlandırırsa o genişlik SUNUCUDA saklanır (bkz.
     *    AuthApi::prefs, users.ui_prefs) ve o sütun artık otomatik ayarlanmaz — ta ki sütun
     *    menüsündeki "Sütun genişliklerini sıfırla" seçilene dek.
     *  - Gizlenen sütunlar da sunucuda saklanır (eskiden localStorage'daydı: yoksa bir kez oradan alınır).
     */
    __setupColumnPrefs(table, columns, offset, key) {
      const columnModel = table.getTableColumnModel();
      const behavior = columnModel.getBehavior();
      const prefs = this._user.ui_prefs || (this._user.ui_prefs = {});
      const widthsKey = key + ".widths";
      const hiddenKey = key + ".hidden";
      let userWidths = Object.assign({}, prefs[widthsKey] || {});
      const hidden = prefs[hiddenKey] || this.__loadJson(hiddenKey) || [];

      columns.forEach((column, index) => {
        const col = index + offset;
        behavior.setWidth(col, userWidths[column.id] || column.width || 100);
        if (hidden.includes(column.id)) {
          columnModel.setColumnVisible(col, false);
        }
      });

      const fit = () => {
        const tm = table.getTableModel();
        const measure = ankamon.page.Base._textWidth;
        const rows = Math.min(tm.getRowCount(), 500);
        columns.forEach((column, index) => {
          if (userWidths[column.id]) {
            return;
          }
          const col = index + offset;
          // Başlık: etiket (kalın olabilir) + sıralama oku + süzgeç kutusu için pay.
          let width = measure(column.label) * 1.1 + 34;
          for (let row = 0; row < rows; row++) {
            const value = tm.getValue(col, row);
            if (value !== null && value !== undefined && value !== "") {
              width = Math.max(width, measure(String(value).replace(/<[^>]*>/g, "")) + 22);
            }
          }
          width = Math.min(600, Math.max(50, Math.ceil(width)));
          if (Math.abs(columnModel.getColumnWidth(col) - width) > 2) {
            behavior.setWidth(col, width);
          }
        });
      };
      let fitPending = false;
      table.getTableModel().addListener("dataChanged", () => {
        if (!fitPending) {
          fitPending = true;
          qx.event.Timer.once(() => {
            fitPending = false;
            if (!table.isDisposed()) {
              fit();
            }
          }, this, 0);
        }
      });

      // Yalnız kullanıcının SÜRÜKLEMESİ (isPointerAction) saklanır; otomatik genişlik ve tablo
      // yeniden boyutlanınca davranışın yaptığı ayarlamalar saklanmaz.
      columnModel.addListener("widthChanged", e => {
        const data = e.getData();
        const column = columns[data.col - offset];
        if (!data.isPointerAction || !column) {
          return;
        }
        userWidths[column.id] = data.newWidth;
        // Davranışa da yazılır: yoksa tablo yeniden boyutlanınca sütun eski genişliğine döner.
        behavior.setWidth(data.col, data.newWidth);
        this.__savePref(widthsKey, Object.assign({}, userWidths));
      });
      columnModel.addListener("visibilityChanged", () => {
        const now = columns
          .filter((column, index) => !columnModel.isColumnVisible(index + offset))
          .map(column => column.id);
        this.__savePref(hiddenKey, now);
      });
      // Yerleşik sütun menüsü: kimlik (ve varsa işaret) sütunu hiç gizlenemeyeceğinden menüden
      // çıkarılır; sona "Sütun genişliklerini sıfırla" eklenir (kullanıcı genişliklerini siler,
      // bütün sütunlar yeniden içeriğe göre otomatik ayarlanır).
      table.addListener("columnVisibilityMenuCreateEnd", e => {
        const menu = e.getData().menu;
        const children = menu.getChildren();
        // Kısa başlıklı sütunlar menüde tam adlarıyla ("hint") görünür. Menü sırası Table'ınkiyle
        // aynı: i. düğme = getOverallColumnAtX(i).
        children.forEach((button, i) => {
          const column = columns[columnModel.getOverallColumnAtX(i) - offset];
          if (column && column.hint && button.setLabel) {
            button.setLabel(column.hint);
          }
        });
        for (let i = offset - 1; i >= 0; i--) {
          if (children[i]) {
            menu.remove(children[i]);
          }
        }
        menu.add(new qx.ui.menu.Separator());
        const reset = new qx.ui.menu.Button("Sütun genişliklerini sıfırla");
        reset.addListener("execute", () => {
          userWidths = {};
          this.__savePref(widthsKey, null);
          fit();
        });
        menu.add(reset);
      });
    },

    /**
     * Sekme hafızası (kullanıcı isteği): sayfadaki TabView'ın son seçili sekmesi kullanıcı başına
     * sunucuda (users.ui_prefs["tab.<name>"], bkz. AuthApi::prefs) saklanır; sayfa yeniden açılınca ya
     * da tarayıcı tazelenince o sekme seçili gelir. Sekme kimliği: userData "key" varsa o, yoksa
     * etiketi (sondaki "(3)" gibi sayaç hariç). Kayıtlı sekme artık yoksa (yetki değişti) ilk sekme kalır.
     * Sayfanın kendi changeSelection dinleyicisinden ÖNCE çağrılmalı: geri yükleme onu tetiklemesin.
     * @param tabs {qx.ui.tabview.TabView} sekmeleri eklenmiş görünüm
     * @param name {String} sayfaya özgü kısa ad, ör. "boards"
     */
    _rememberTab(tabs, name) {
      const key = "tab." + name;
      const idOf = tab => this.__tabId(tab);
      // Ağaçtan istenmiş ama sekmeler henüz kurulmamışsa (ör. Ayarlar her yüklemede yeniden kurar) o sekme.
      const saved = this.__pendingTab || (this._user.ui_prefs || {})[key];
      this.__pendingTab = null;
      this.__tabView = tabs;
      const tab = saved && tabs.getChildren().find(t => idOf(t) === saved);
      if (tab && tabs.getSelection()[0] !== tab) {
        tabs.setSelection([tab]);
      }
      tabs.addListener("changeSelection", e => {
        const selected = e.getData()[0];
        if (selected && idOf(selected) !== (this._user.ui_prefs || {})[key]) {
          this.__savePref(key, idOf(selected));
        }
        // Sol ağaç açık sekmenin yaprağını vurgulasın (sekme sayfanın içinden değiştiğinde de — bkz. ui.Shell).
        if (selected) {
          qx.event.message.Bus.dispatchByName(ankamon.page.Base.TAB_CHANGED, { page: this, tab: idOf(selected) });
        }
      });
      // Sekmeler geç kurulan sayfada (Ayarlar her yüklemede yeniden kurar) açılışta seçilen sekme de bildirilsin.
      qx.event.Timer.once(() => {
        const current = !tabs.isDisposed() && tabs.getSelection()[0];
        if (current) {
          qx.event.message.Bus.dispatchByName(ankamon.page.Base.TAB_CHANGED, { page: this, tab: idOf(current) });
        }
      }, this, 0);
    },

    /** Sekme kimliği: userData "key" varsa o, yoksa etiket (sondaki "(3)" gibi sayaç hariç). */
    __tabId(tab) {
      return tab.getUserData("key") || String(tab.getLabel() || "").replace(/\s*\(\d+\)$/, "");
    },

    /**
     * Sol ağaçtaki sekme seçeneği (bkz. ui.Shell PAGES tabs): sayfanın _rememberTab'a verdiği TabView'da o
     * sekmeyi seçer. Sekmeler henüz kurulmadıysa istek bekletilir, kurulunca (_rememberTab) uygulanır.
     * @return {Boolean} hemen seçildi mi
     */
    selectTab(key) {
      const tabs = this.__tabView && !this.__tabView.isDisposed() ? this.__tabView : null;
      const tab = tabs && tabs.getChildren().find(t => this.__tabId(t) === key);
      if (!tab) {
        this.__pendingTab = key;
        return false;
      }
      if (tabs.getSelection()[0] !== tab) {
        tabs.setSelection([tab]);
      }
      return true;
    },

    /** O an açık sekmenin kimliği (ağaçta vurgulamak için); sekmesiz sayfada null. */
    currentTab() {
      const tabs = this.__tabView && !this.__tabView.isDisposed() ? this.__tabView : null;
      const tab = tabs && tabs.getSelection()[0];
      return tab ? this.__tabId(tab) : null;
    },

    /** Tek bir arayüz tercihini sunucuya yazar (bkz. Base.savePref). */
    __savePref(name, value) {
      ankamon.page.Base.savePref(this._user, name, value);
    },

    __loadJson(key) {
      try {
        const raw = localStorage.getItem("ankamon." + key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    /**
     * Her sütun başlığının İÇİNE (etikete bitişik, altında) küçük bir süzgeç metin kutusu ekler
     * (Excel tarzı sütun filtresi) — ayrı bir satır DEĞİL, grid'in kendi başlık hücresinin bir
     * parçası (bkz. ui.table.FilterHeaderRenderer/FilterHeaderCell). Kutuya yazıldıkça `onChange`
     * çağrılır. Kutular gerçekten o sütunun başlık hücresinde yaşadığından sürükleyerek yeniden
     * boyutlandırma/gizleme ile otomatik hizalı kalır — ayrıca senkron kodu gerekmez.
     *
     * Hazır değer listesi (kullanıcı isteği, bütün grid'lerde): az çeşitli değerli sütunlarda (bkz.
     * choicesSuitable; sütun tanımında `choices: true|false` ile zorlanabilir) kutunun sağında ▾ düğmesi
     * çıkar; onay kutulu listeden birden çok değer seçilebilir, seçim kutuya `"A" | "B"` olarak yazılır
     * (elle de düzenlenebilir). Liste, öteki sütunların süzgeçlerine uyan satırlardaki değerlerden ve
     * sayılarından oluşur (Excel'deki gibi). Satır eşleşmesi çağıranda `Base.filterMatch(hücre, metin)` ile.
     * @param table {qx.ui.table.Table} _createTable'ın döndürdüğü tablo (offset bilgisi için)
     * @param columns {Array} _createTable'a verilen aynı dizi
     * @param onChange {Function} her değişiklikte çağrılır (parametresiz)
     * @param opts {Map?} {rows: Function} — süzülmemiş BÜTÜN satırlar (tablo modeli satırı biçiminde: kimlik
     *   [+ onay] + sütunlar). Verilmezse hazır liste çıkmaz (yalnız elle yazım).
     *   {persist: true | "anahtar" | Function} — süzgeç değerleri oturum sahibinde saklanır ve grid kurulurken geri
     *   yüklenir (kullanıcı isteği 2026-11-10: cihaz grid'leri). true: tablonun prefsKey'i; Function: o anki görünümün
     *   anahtarı (ör. Ağ ▸ varlık grupları — görünüm değişince fields.restoreSaved() çağrılır). Kayıt "<anahtar>.filters".
     * @return {Map} {columnId: TextField} — değerlerini okumak için (bkz. çağıranların __apply'ı)
     */
    /**
     * Kendi süzgeç mantığı olmayan grid'e sütun süzgeçleri + hazır değer listeleri (kullanıcı isteği 2026-11-10: BÜTÜN grid'ler
     * — Loglar, Genel bakış, Sağlık ▸ Tara/Bildirimler, Yazılımlar, Hesaplar…). Modelin setData'sı sarılır: çağıran yine BÜTÜN
     * satırları verir; burada saklanır ve yalnız süzgeçlere uyanlar tabloya yazılır (satır dizileri ortak — onay kutusu
     * değerleri süzme sırasında korunur). Eşleşme filterMatch ile (hazır listedeki "A" | "B" seçimleri dahil).
     * @return {Map} süzgeç kutuları (bkz. _addColumnFilters)
     */
    _makeFilterable(table, columns) {
      const B = ankamon.page.Base;
      const model = table.getTableModel();
      const offset = table.getUserData("offset") ?? 1;
      const inner = model.setData;
      let all = (model.getData && model.getData()) || []; // tablo süzgeçlenmeden önce doldurulmuşsa o satırlar
      let fields = null;
      const shown = () => {
        const active = fields ? columns.map((c, i) => ({ i: i + offset, text: (fields[c.id].getValue() || "").trim() })).filter(f => f.text) : [];
        return active.length ? all.filter(row => active.every(f => B.filterMatch(row[f.i], f.text))) : all;
      };
      model.setData = function(rows, clearSorting) {
        all = rows || [];
        return inner.call(this, shown(), clearSorting);
      };
      fields = this._addColumnFilters(table, columns, () => inner.call(model, shown()), { rows: () => all });
      return fields;
    },

    _addColumnFilters(table, columns, onChange, opts = {}) {
      const columnModel = table.getTableColumnModel();
      const offset = table.getUserData("offset") ?? 1;
      const B = ankamon.page.Base;
      const buttons = {};
      const allRows = () => (opts.rows && opts.rows()) || [];
      const valuesOf = (rows, index) => rows.map(cells => cells[offset + index]);
      // ▾ düğmeleri yalnız uygun sütunlarda: veri değiştikçe yeniden değerlendirilir (tek turda bir kez).
      let pending = false;
      const refreshButtons = () => {
        if (pending) {
          return;
        }
        pending = true;
        qx.event.Timer.once(() => {
          pending = false;
          if (table.isDisposed()) {
            return;
          }
          const rows = allRows();
          columns.forEach((column, index) => {
            const button = buttons[column.id];
            if (!button || button.isDisposed()) {
              return;
            }
            // Başlıksız sütun (ör. Ağ'daki aç/kapa oku) liste almaz.
            const show = column.choices === undefined ? !!column.label && B.choicesSuitable(valuesOf(rows, index)) : !!column.choices;
            // Seçim yapılmışken sütun "uygunsuz"a dönse de (ör. veri azaldı) düğme kalsın — seçim düzenlenebilsin.
            button.setVisibility(show || B.parseChoices(fields[column.id].getValue()) ? "visible" : "excluded");
          });
        }, this, 0);
      };
      table.getTableModel().addListener("dataChanged", refreshButtons);
      const openChoices = (column, index, button) => {
        const others = columns.map((c, i) => ({ i, text: c === column ? "" : (fields[c.id].getValue() || "") }))
          .filter(f => f.text.trim());
        const counts = new Map();
        allRows().filter(cells => others.every(f => B.filterMatch(cells[offset + f.i], f.text)))
          .forEach(cells => {
            const key = B.filterText(cells[offset + index]);
            const entry = counts.get(key) || { label: String(cells[offset + index] ?? "").replace(/<[^>]*>/g, "").trim(), n: 0 };
            entry.n++;
            counts.set(key, entry);
          });
        // Tırnak/"|" içeren değer bu biçimle yazılamaz — listede gösterilmez (elle yazımla süzülebilir).
        const keys = [...counts.keys()].filter(k => !/["|]/.test(counts.get(k).label))
          .sort((a, b) => (a === "") - (b === "") || a.localeCompare(b, "tr", { numeric: true }));
        const chosen = new Set((B.parseChoices(fields[column.id].getValue()) || []).map(v => B.filterText(v)));
        this.__choicePopup(button, keys.map(k => ({ key: k, label: counts.get(k).label || "(Boş)", n: counts.get(k).n })),
          chosen, selected => {
            // Kutuya değerlerin özgün yazımı (eşleşme büyük/küçük harf duyarsız — bkz. filterMatch).
            fields[column.id].setValue(selected.length ? selected.map(k => `"${counts.get(k).label}"`).join(" | ") : "");
          });
      };
      // Kutular başlık hücresi ÇİZİLİNCE oluşur — gizli sütunun (bkz. sütun gizleme) başlığı hiç
      // çizilmez. Çağıranlar her sütunun kutusunu okuduğundan (fields[id].getValue()) her sütun için
      // baştan sayfaya eklenmemiş bir yedek kutu konur; gerçek kutu gelince (sütun gösterilince) yerini
      // alır ve yedekteki değeri devralır. (Yedeksiz: gizli sütunlu grid'de "reading 'getValue'" hatası.)
      const fields = {};
      columns.forEach(column => {
        fields[column.id] = new qx.ui.form.TextField();
      });
      // Kalıcı süzgeçler: kayıtlı değerler yedek kutulara yazılır (gerçek kutu çizilince devralır ve süzer).
      let persist = null;
      if (opts.persist) {
        const prefsKey = table.getUserData("prefsKey");
        const keyOf = typeof opts.persist === "function" ? opts.persist
          : () => (typeof opts.persist === "string" ? opts.persist : prefsKey);
        persist = B.filterPersistence(fields, keyOf, this._user);
        persist.restore();
        Object.defineProperty(fields, "restoreSaved", { value: () => persist.restore(), enumerable: false });
      }
      const changed = e => {
        onChange.call(this, e);
        if (persist) {
          persist.save();
        }
      };
      const renderer = new ankamon.ui.table.FilterHeaderRenderer((col, field, button) => {
        const column = columns[col - offset];
        if (!column) {
          return;
        }
        // İpucu sütun adını tekrarlamaz (etiket hemen üstte); kutunun ne işe yaradığını söyler.
        field.setPlaceholder("Süz…");
        field.setToolTipText((column.hint || column.label) + " sütununda süz (birden çok değer: | ile ayırın)");
        // Sütun tanımında hint varsa başlık etiketinin de ipucu olur (kutu → satır → FilterHeaderCell).
        const cell = field.getLayoutParent() && field.getLayoutParent().getLayoutParent();
        if (column.hint && cell instanceof ankamon.ui.table.FilterHeaderCell) {
          cell.getChildControl("label").setToolTipText(column.hint);
        }
        const previous = fields[column.id];
        field.addListener("changeValue", changed, this);
        fields[column.id] = field;
        // Liste yalnız tam satırları veren (ve eşleşmeyi filterMatch ile yapan) grid'de: tırnaklı seçim düz
        // `includes` ile hiçbir satırla eşleşmezdi (henüz güncellenmemiş eklenti grid'i yanlış süzmesin).
        if (button && opts.rows) {
          buttons[column.id] = button;
          button.addListener("execute", () => openChoices(column, col - offset, button));
          refreshButtons();
        }
        // Yedekte bekleyen değer (ör. Genel bakış kartından "Çevrimiçi") gerçek kutuya geçer ve süzer.
        if (previous && previous !== field && previous.getValue() && !field.getValue()) {
          field.setValue(previous.getValue());
        }
      });
      columns.forEach((column, index) => columnModel.setHeaderCellRenderer(index + offset, renderer));
      // Varsayılan (16) yalnız etiket için; süzgeç kutusu (22 px, bkz. FilterHeaderCell) alt satıra
      // ekleniyor, ikisine de yer açılır. 52 + kutu etiketin hemen altında (bkz. FilterHeaderCell
      // rowFlex): kutunun altında en dar temada (Gümüş Mavi, etiketi 21 px) 2 px, diğerlerinde 4-7 px
      // pay kalır (48'de Gümüş Mavi'de 4 px kesiliyordu) — 17 temanın hepsinde tarayıcıda ölçüldü.
      table.setHeaderCellHeight(52);
      return fields;
    },

    /**
     * Süzgeç kutusunun hazır değer listesi (bkz. _addColumnFilters): onay kutulu değerler (sayılarıyla),
     * "Tümü" (üç durumlu) ve "Temizle". Seçim her değişiklikte hemen uygulanır (onSelect).
     * Kullanıcı isteği 2026-11-10: liste geniş ve yüksek (pencerenin yüksekliğine göre, en çok ~%60'ı) ve üstündeki
     * arama kutusuyla listenin kendisi süzülür (Excel'deki gibi): aramaya uymayan değerler gizlenir, "Tümü" yalnız
     * görünenleri seçer/kaldırır; gizlenen bir değerin seçimi korunur.
     * @param items {Array} [{key, label, n}] @param chosen {Set} seçili anahtarlar @param onSelect {Function} (keys)
     */
    __choicePopup(button, items, chosen, onSelect) {
      const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1280, height: 800 };
      const popup = new qx.ui.popup.Popup(new qx.ui.layout.VBox(6)).set({
        padding: 8, minWidth: Math.min(360, root.width - 20), maxWidth: Math.min(640, root.width - 20)
      });
      const checks = [];
      const all = new qx.ui.form.CheckBox("Tümü").set({ triState: true, font: "bold" });
      const apply = () => onSelect(checks.filter(c => c.getValue()).map(c => c.getUserData("key")));
      const visible = () => checks.filter(c => c.isVisible());
      const syncAll = () => {
        const shown = visible();
        const n = shown.filter(c => c.getValue()).length;
        all.setValue(n === 0 ? false : (n === shown.length ? true : null));
        all.setEnabled(shown.length > 0);
      };
      const list = new qx.ui.container.Composite(new qx.ui.layout.VBox(3));
      items.forEach(item => {
        const check = new qx.ui.form.CheckBox(`${item.label}  (${item.n})`).set({ value: chosen.has(item.key), toolTipText: item.label });
        check.setUserData("key", item.key);
        check.setUserData("text", ankamon.page.Base.filterText(item.label));
        check.addListener("changeValue", () => {
          syncAll();
          apply();
        });
        checks.push(check);
        list.add(check);
      });
      all.addListener("execute", () => {
        // Üç durumluda tıklama sırası null → true: kısmi seçimden "hepsi"; hepsi seçiliyken "hiçbiri". Yalnız görünenler.
        const shown = visible();
        const on = shown.some(c => !c.getValue());
        shown.forEach(c => c.setValue(on));
      });
      let search = null;
      const count = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
      const updateCount = () => {
        const shown = visible().length;
        count.setValue(shown === checks.length ? `${checks.length} değer` : `${shown} / ${checks.length} değer`);
      };
      if (!items.length) {
        popup.add(new qx.ui.basic.Label("Öteki süzgeçlere uyan satır yok.").set({ textColor: "app-muted" }));
      } else {
        // Listenin kendi süzgeci: yazdıkça uymayan değerler gizlenir (büyük/küçük harf ve Türkçe harf duyarsız — filterText).
        search = new qx.ui.form.TextField().set({ placeholder: "Listede ara…", liveUpdate: true });
        search.addListener("changeValue", e => {
          const text = ankamon.page.Base.filterText(e.getData() || "").trim();
          checks.forEach(c => c.setVisibility(!text || c.getUserData("text").includes(text) ? "visible" : "excluded"));
          syncAll();
          updateCount();
        });
        popup.add(search);
        const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
        head.add(all, { flex: 1 });
        head.add(count);
        popup.add(head);
        // Scroll içeriğine göre büyümez: yükseklik değer sayısından (satır ~26 px), en çok pencerenin ~%60'ı.
        const maxH = Math.max(200, Math.round(root.height * 0.6) - 110);
        const scroll = new qx.ui.container.Scroll(list).set({ height: Math.min(items.length * 26 + 6, maxH), maxHeight: maxH });
        popup.add(scroll, { flex: 1 });
        updateCount();
      }
      syncAll();
      const clear = new qx.ui.form.Button("Temizle").set({ allowGrowX: false, alignX: "right" });
      clear.addListener("execute", () => {
        checks.forEach(c => c.setValue(false));
        onSelect([]);
        popup.hide();
      });
      popup.add(clear);
      popup.addListener("disappear", () => qx.event.Timer.once(() => popup.dispose(), this, 0));
      popup.placeToWidget(button, true);
      popup.show();
      if (search) {
        qx.event.Timer.once(() => !search.isDisposed() && search.focus(), this, 50);
      }
    },

    /** Tabloda seçili satırların kimlik sütunu değerleri (tek seçimli, satır vurgusuna dayalı). */
    _selectedIds(table) {
      const ids = [];
      table.getSelectionModel().iterateSelection(row => ids.push(table.getTableModel().getValue(0, row)));
      return ids;
    },

    /** _createTable(columns, {checkable:true}) ile kurulmuş tabloda işaretli satırların kimlikleri. */
    _checkedIds(table) {
      const tm = table.getTableModel();
      const ids = [];
      for (let row = 0; row < tm.getRowCount(); row++) {
        if (tm.getValue(1, row)) {
          ids.push(tm.getValue(0, row));
        }
      }
      return ids;
    },

    /**
     * Şu an görünen (süzülmüş) bütün satırların onay kutusunu işaretler/kaldırır. Tablonun "checkableRow"
     * userData'sı (kimlik → Boolean) verilmişse yalnız onun kabul ettiği satırlar (ör. Ağ'da alt satırlar değil).
     */
    _checkAll(table, checked) {
      const tm = table.getTableModel();
      const can = table.getUserData("checkableRow");
      for (let row = 0; row < tm.getRowCount(); row++) {
        if ((!can || can(tm.getValue(0, row))) && !!tm.getValue(1, row) !== checked) {
          tm.setValue(1, row, checked);
        }
      }
    }
  }
});
