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
 * Tahtalar sayfasının üstündeki araç çubuğu: sağ menü işlevleri simgeli düğmeler olarak.
 *
 * TEK KAYNAK sağ menüdür: düğmenin her basışında menü, o anki seçimle baştan kurulur (getMenu) ve maddeler gruplara
 * dağıtılır. Yetki, tahta durumuna göre devre dışı bırakma, çoklu seçim ve işleyiciler menüden gelir; çubukta işlev
 * kodu yoktur. GROUPS'ta adı geçmeyen yeni menü maddesi "Diğer" düğmesinde kendiliğinden görünür.
 * Menüye eklenen, değişen ya da çıkan her madde için burada GROUPS/ITEMS da gözden geçirilir (kalıcı kural).
 *
 * Düğme: simgeye basmak grubun birincil işini yapar (primary yoksa ya da o an uygulanamıyorsa menüyü açar); ▾ aynı
 * türdeki bütün işleri açar. Güç gibi tek basışta tehlikeli işlerde bilerek primary yoktur.
 *
 * Çubuğun başında görünüm bölümü (addViewControls): ne gösterildiğini seçer, menüden gelmez. Çubuk sayfanın üstünde
 * ayrı bir panel görünür (bkz. __panel): kendi zemini, çerçevesi ve gölgesi vardır, işler ayırıcılarla kümelenir.
 */
qx.Class.define("ankamon.ui.boards.ActionBar", {
  extend: qx.ui.container.Composite,

  statics: {
    /** Kapalı düğme: yazı rengi tam kalır, yalnız bu opaklık uygulanır (temanın soluk yazısıyla çarpılınca okunmuyordu). */
    OFF_OPACITY: 0.42,

    /**
     * Düğmeler, soldan sağa. noSelection: hiç tahta seçili değilken de çalışan maddeler. single: yalnız TEK tahta
     * seçiliyken kullanılabilir; single: "primary" → yalnız birincil madde (ve extra maddeleri) tek tahtada, menünün
     * geri kalanı çoklu seçimde de (Ekran düğmesi: Ekranı göster tek tahta; çoklu izleme Ekranlar sekmesindedir).
     * mirror: düğmenin menüsü sağ menüdeki o grubun alt menüsünün AYNISIDIR (alt menüler dahil, sıra korunur) —
     * KALICI KURAL (kullanıcı, 2026-11-05): sağ menü ↔ araç çubuğu senkron: "Yönet" ↔ Yönet düğmesi, "Ekran" ↔ Ekran
     * düğmesi (+ Ekranı göster). Menüye eklenen madde düğmede kendiliğinden görünür. extra: aynanın başına eklenen,
     * menünün başka yerindeki maddeler. Kilit ve Güç düğmeleri Yönet'teki kilit/uyandırma maddelerinin kısayoludur.
     */
    GROUPS: [
      { id: "watch", label: "Ekran", icon: "deviceDesktop", primary: "Ekranı göster", single: "primary", mirror: "Ekran",
        extra: ["Ekranı göster"] },
      { id: "manage", label: "Yönet", icon: "mouse", primary: "Bilgisayarı yönet", mirror: "Yönet" },
      { id: "lock", label: "Kilit", icon: "lock", primary: "Kilitle" },
      { id: "command", label: "Komut", icon: "terminal2", primary: "Hazır / Serbest komut çalıştır", sep: true },
      { id: "users", label: "Kullanıcılar", icon: "users" },
      { id: "files", label: "Dosyalar", icon: "folders", primary: "Dosya yöneticisi" },
      { id: "taskmgr", label: "Görevler", icon: "activity", primary: "Görev yöneticisi" },
      { id: "web", label: "Web sitesi", icon: "worldWww", primary: "Web sitesi aç…", sep: true },
      { id: "wifi", label: "Wi-Fi", icon: "wifi", primary: "Wi-Fi Monitör" },
      { id: "chat", label: "Sohbet", icon: "messages", primary: "Sohbet" },
      { id: "power", label: "Güç", icon: "power", sep: true },
      { id: "info", label: "Bilgi", icon: "infoCircle", primary: "Bilgi kartı" },
      { id: "record", label: "Kayıt", icon: "edit", noSelection: ["Tahta ekle…"] },
      { id: "other", label: "Diğer", icon: "dots" }
    ],

    /** Alt menüsü düğmelere dağıtılan üst maddeler → içindeki bilinmeyen maddenin grubu. */
    CONTAINERS: { "Komut çalıştır": "command", "Yönet": "manage", "Ekran": "watch", "Kullanıcılar": "users", "Dosyalar": "files",
      "Web filtresi": "manage" },

    /** Menü maddesi → grup (menüdeki etiket, tahta sayısı eki olmadan — bkz. BoardOps.menuButton). */
    ITEMS: {
      "Ekranı göster": "watch", "Ekran görüntüsü al": "watch", "Bilgisayarı yönet": "manage",
      "Uyandır": "power", "Uyut": "power",
      "Kilitle": "lock", "Kilidi aç": "lock", "Klavyeyi kilitle": "lock", "Klavye kilidini aç": "lock", "Fareyi kilitle": "lock",
      "Fare kilidini aç": "lock", "Dokunmatiği kilitle": "lock", "Dokunmatik kilidini aç": "lock",
      "Ekranımı yansıt": "watch", "Ekranı başka bilgisayara aktar…": "watch", "Ekran aktarımını durdur": "watch",
      "Görev yöneticisi": "taskmgr", "Web sitesi aç…": "web", "Wi-Fi Monitör": "wifi", "Sohbet": "chat",
      "Bilgisayarı aç (WoL)": "power", "Bilgisayarı kapat": "power", "Bilgisayarı yeniden başlat": "power",
      "Bilgi kartı": "info", "Logları göster": "info",
      "Düzenle": "record", "Sil": "record", "Tahta ekle…": "record",
      // Seçim düğmesi kalktı (kullanıcı isteği, 2026-11-05): işaretleme Ctrl+A / satır kutuları; bu maddeler çubukta yok.
      "Tümünü işaretle": "hidden", "İşaretleri kaldır": "hidden"
    },

    /** Menüde tek tahtaya uygulanan maddeler: çoklu seçimde her tahta için ayrı açılır (pencere başına tahta). Görev
     * yöneticisi çoklu seçimde tek pencerede bütün tahtaları gösterir (bilgisayar süzgeciyle), burada değil. */
    PER_BOARD: ["Bilgisayarı yönet", "Sohbet", "Dosya yöneticisi", "Düzenle"],
    PER_BOARD_CONFIRM: 6
  },

  /**
   * @param getMenu {Function} (tahta, tahtalar) → qx.ui.menu.Menu|null: sağ menüyü kurar
   * @param getSelected {Function} () → seçili tahtalar
   * @param config {Map?} groups/items/containers/perBoard (eklenti araç çubuğu); getAll: () → tüm tahtalar (verilirse
   *   durum yazısı "çevrim içi N (k seçili) · çevrim dışı M (j seçili)" olur)
   */
  construct(getMenu, getSelected, config) {
    super(new qx.ui.layout.Flow(1, 2).set({ alignY: "middle" }));
    this.__getMenu = getMenu;
    this.__getSelected = getSelected;
    // Grup/madde eşlemesi: varsayılan çekirdek statikleri (Tahtalar araç çubuğu). Bir eklenti, bu çubuğu yeniden
    // yazmadan kendi sağ menüsüne dayalı bir araç çubuğu kurabilsin diye grupları/maddeleri config ile geçebilir
    // (her grup kendi iconSvg'sini de verebilir — bkz. __svgIcon; örnek: ankamonext.ahenk.AhenkBar).
    const Bar = ankamon.ui.boards.ActionBar;
    config = config || {};
    this.__groups = config.groups || Bar.GROUPS;
    this.__items = config.items || Bar.ITEMS;
    this.__containers = config.containers || Bar.CONTAINERS;
    this.__perBoard = config.perBoard || Bar.PER_BOARD;
    this.__getAll = config.getAll || null;
    this.__widgets = new Map();
    this.__tools = [];
    this.set({ padding: [3, 6], margin: [6, 8, 8, 8] });
    this.__applyPanel();
    this.__build();
    this.__count = new qx.ui.basic.Label("").set({ rich: true, textColor: "app-muted", alignY: "middle", marginLeft: 6 });
    this.add(this.__count);
    this.addListener("resize", this.__queueSeparators, this);
    this.refresh();
  },

  destruct() {
    if (this.__open) {
      this.__dropMenu(this.__open);
    }
  },

  members: {
    __getMenu: null,
    __getSelected: null,
    __groups: null,
    __items: null,
    __containers: null,
    __perBoard: null,
    __getAll: null,
    __totals: null,
    __widgets: null,
    __count: null,
    __open: null,
    __stateKey: null,
    __colors: null,
    __flatDecorator: null,
    __separators: null,
    __separatorTimer: null,
    __tools: null,
    __iconOnly: false,
    __fullWidth: 0,
    __selectedCount: 0,

    /**
     * Panel görünümü: sayfadan ayrı dursun diye zemin temanın yüzey renginden biraz koyu (koyu temada açık), çerçeve ve
     * gölge var. Temalarda parçanın kendi arka plan rengi süslemenin (decorator) renginin önüne geçer: renk parçaya verilir.
     * Tema değişince sayfa yeniden yüklenir; renkler bir kez hesaplanır.
     */
    __applyPanel() {
      const mgr = qx.theme.manager.Color.getInstance();
      const name = ["surface", "background"].find(n => mgr.isDynamic(n));
      const rgb = qx.util.ColorUtil.cssStringToRgb(mgr.resolve(name || "#ffffff")).slice(0, 3);
      const light = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 >= 128;
      const shade = amount => `rgb(${rgb.map(c => Math.round(light ? c * (1 - amount) : c + (255 - c) * amount)).join(",")})`;
      // Yazı rengi de buradan: temaların araç çubuğu yazı rengi koyu zeminde koyu kalabiliyor (Liste ve Başarım okunmuyordu).
      this.__colors = { hover: shade(0.13), pressed: shade(0.2), text: light ? "#242424" : "#f2f2f2" };
      this.set({
        backgroundColor: shade(0.055),
        decorator: new qx.ui.decoration.Decorator().set({
          width: 1, color: "app-border", radius: 8,
          shadowHorizontalLength: 0, shadowVerticalLength: 2, shadowBlurRadius: 7,
          shadowColor: light ? "rgba(0,0,0,0.16)" : "rgba(0,0,0,0.45)"
        })
      });
    },

    /** Panel düğmesi düz: yalnız üzerine gelince ya da basılıyken renklenir (temanın kutulu görünümü panelde kalabalık duruyordu). */
    __flatten(button) {
      const flat = this.__flatDecorator || (this.__flatDecorator = new qx.ui.decoration.Decorator().set({ radius: 5 }));
      // Kenar boşluğu sıfır: bazı temalar (Simple) düğme başına 10 piksel ekliyor, çubuk sığmıyordu.
      button.set({ decorator: flat, backgroundColor: "transparent", margin: 0, showToolTipWhenDisabled: true });
      button.getChildControl("label").setTextColor(this.__colors.text);
      const paint = color => {
        if (!button.getUserData("ankamon.checked")) {
          button.setBackgroundColor(color);
        }
      };
      button.addListener("pointerover", () => button.getEnabled() && paint(this.__colors.hover));
      button.addListener("pointerout", () => paint("transparent"));
      button.addListener("pointerdown", () => button.getEnabled() && paint(this.__colors.pressed));
      button.addListener("pointerup", () => button.getEnabled() && paint(this.__colors.hover));
    },

    /** Kümeleri ayıran ince dikey çizgi. */
    __separator() {
      const line = new qx.ui.core.Widget().set({
        width: 1, height: 40, allowGrowY: false, alignY: "middle", backgroundColor: "app-border", marginLeft: 3, marginRight: 3
      });
      (this.__separators || (this.__separators = [])).push(line);
      return line;
    },

    __queueSeparators() {
      if (!this.__separatorTimer) {
        this.__separatorTimer = qx.event.Timer.once(() => {
          this.__separatorTimer = null;
          if (this.__fitLabels()) {
            this.__queueSeparators();   // düğmeler yeniden yerleşsin, ayırıcılar ona göre bakılsın
          } else {
            this.__tidySeparators();
          }
        }, this, 30);
      }
    },

    /** Durum yazısı. Simge kipinde yer açmak için seçim yoksa gizli, varsa yalnız sayı (ayrıntı ipucunda). */
    __showCount() {
      const n = this.__selectedCount;
      const t = this.__totals;
      if (t) {
        // Seçim düğmesinin yerine (kullanıcı isteği, 2026-11-05): kaç tahta çevrim içi / dışı ve bunlardan kaçı seçili.
        const sel = k => (k ? ` <span style="font-weight:bold">(${k} seçili)</span>` : "");
        const on = `<span style="color:#1e8e3e">●</span>`;
        const off = `<span style="color:#9aa0a6">●</span>`;
        const value = this.__iconOnly
          ? `${on} ${t.on}${t.onSel ? ` (${t.onSel})` : ""} ${off} ${t.off}${t.offSel ? ` (${t.offSel})` : ""}`
          : `${on} ${t.on} çevrim içi${sel(t.onSel)} &nbsp;${off} ${t.off} çevrim dışı${sel(t.offSel)}`;
        this.__count.set({
          value, visibility: "visible",
          toolTipText: `${t.on} çevrim içi (${t.onSel} seçili), ${t.off} çevrim dışı (${t.offSel} seçili)`
        });
        return;
      }
      const text = n ? `${n} seçili` : "Seçim yok";
      this.__count.set({
        value: this.__iconOnly ? String(n) : text,
        visibility: this.__iconOnly && !n ? "excluded" : "visible",
        toolTipText: n ? `${n} tahta seçili` : "Tahta seçili değil"
      });
    },

    __registerTool(button, icon) {
      button.setUserData("ankamon.fullLabel", button.getLabel());
      button.setUserData("ankamon.iconLabel", icon);
      this.__tools.push(button);
    },

    /**
     * Yazılarla tek satıra sığmayan çubuk yalnız simge gösterir: işlev adı ipucunda kalır, düğmeler satır satır sarılmaz.
     * Yer açılınca yazılar döner. @return {Boolean} kip değişti mi
     */
    __fitLabels() {
      const bounds = this.getBounds();
      if (!bounds) {
        return false;
      }
      const insets = this.getInsets();
      const inner = bounds.width - insets.left - insets.right;
      let wrapped = false;
      if (!this.__iconOnly) {
        const shown = this.getChildren().filter(w => w.getVisibility() !== "excluded");
        this.__fullWidth = shown.reduce((sum, w) => sum + w.getSizeHint().width + w.getMarginLeft() + w.getMarginRight() + 1, 0);
        const first = shown[0].getBounds();
        wrapped = !!first && shown.some(w => w.getBounds() && w.getBounds().top >= first.top + first.height);
      }
      // Geçiş ölçüye değil gerçek sarılmaya bakar; dönüşte küçük pay: seçim sayısı uzayınca kip gidip gelmesin.
      const iconOnly = this.__iconOnly ? inner < this.__fullWidth + 4 : wrapped;
      if (iconOnly === this.__iconOnly) {
        return false;
      }
      this.__iconOnly = iconOnly;
      this.__tools.forEach(button => {
        button.setLabel(button.getUserData(iconOnly ? "ankamon.iconLabel" : "ankamon.fullLabel"));
        button.setMinWidth(iconOnly ? 34 : 46);
      });
      this.__showCount();
      return true;
    },

    /** Çubuk sarılınca satır başına ya da sonuna düşen ayırıcı gizlenir. Yeri korunur: yerleşim değişmez, boyut döngüsü olmaz. */
    __tidySeparators() {
      const shown = this.getChildren().filter(w => w.isVisible() || this.__separators.includes(w));
      this.__separators.forEach(line => {
        const at = shown.indexOf(line);
        const own = line.getBounds();
        const prev = (shown[at - 1] || line).getBounds();
        const next = (shown[at + 1] || line).getBounds();
        if (own && prev && next) {
          const edge = at === 0 || prev.top + prev.height <= own.top || next.top >= own.top + own.height;
          line.setVisibility(edge ? "hidden" : "visible");
        }
      });
    },

    /**
     * Çubuğun başına görünüm bölümü ekler. @param items {Array} [{id, label, icon, tip, group?}]: group verilenler aynı anda
     * biri seçili iki durumlu, verilmeyenler açılıp kapanan düğmedir. @param onChange {Function} (id, açık mı)
     * @return {Map} id → düğme (setValue, setEnabled)
     */
    addViewControls(items, onChange) {
      const mgr = qx.theme.manager.Color.getInstance();
      const accent = ["primary", "background-selected"].find(n => mgr.isDynamic(n)) || "#0067c0";
      const buttons = new Map();
      const radio = new qx.ui.form.RadioGroup();
      const [r, g, b] = qx.util.ColorUtil.cssStringToRgb(mgr.resolve(accent));
      const onAccent = (r * 299 + g * 587 + b * 114) / 1000 >= 130 ? "#111111" : "white";   // koyu temaların vurgusu açık: beyaz okunmaz
      // Temaların "basılı" görünümü çoğunda belirgin değil (kullanıcı bildirimi): seçili düğme her temada dolu renkli, yazısı beyaz.
      // Kapalı düğme (Liste görünümünde Sensörler) değerini korur ama seçili görünmez.
      const paint = button => {
        const on = button.getValue() && button.getEnabled();
        button.setUserData("ankamon.checked", on);
        button.setBackgroundColor(on ? accent : "transparent");
        button.setOpacity(button.getEnabled() ? 1 : ankamon.ui.boards.ActionBar.OFF_OPACITY);
        button.getChildControl("label").setTextColor(on ? onAccent : this.__colors.text);
      };
      items.forEach((item, index) => {
        const icon = this.__svgIcon(item);
        const html = `${icon}` +
          `<div style="margin-top:2px;font-size:11px;line-height:13px;text-align:center;white-space:nowrap">${qx.bom.String.escape(item.label)}</div>`;
        const button = item.group ? new qx.ui.toolbar.RadioButton(html) : new qx.ui.toolbar.CheckBox(html);
        button.set({ rich: true, show: "label", center: true, padding: [4, 3], minWidth: 46, toolTipText: item.tip });
        this.__flatten(button);
        this.__registerTool(button, icon);
        if (item.group) {
          radio.add(button);
        }
        button.addListener("changeValue", e => {
          paint(button);
          onChange(item.id, e.getData());
        });
        button.addListener("changeEnabled", () => paint(button));
        // Görünüm bölümü işlerden önce gelir: sırayla başa.
        this.addAt(button, index);
        buttons.set(item.id, button);
        paint(button);
      });
      this.addAt(this.__separator(), items.length);
      return buttons;
    },

    /** Yetkiye göre var olan düğmeler: sentetik çevrimiçi ve çevrimdışı tahtanın menülerinden. */
    __build() {
      const present = new Set();
      [true, false].forEach(online => {
        const probe = { id: 0, online, facts: {}, label: "" };
        const menu = this.__getMenu(probe, [probe, Object.assign({}, probe, { id: -1 })]);
        if (menu) {
          const groups = this.__collect(menu);
          groups.forEach((leaves, id) => leaves.length && present.add(id));
          this.__groups.filter(g => g.mirror && groups.containers[g.mirror]).forEach(g => present.add(g.id));
          this.__dropMenu(menu);
        }
      });
      this.__groups.filter(g => present.has(g.id)).forEach(group => this.__addButton(group));
    },

    /** Grup/öğe simgesi: eklenti kendi tam <svg> dizgesini (iconSvg) verebilir; yoksa ortak simge kümesinden ada göre. */
    __svgIcon(spec) {
      return spec.iconSvg || ankamon.ui.boards.ActionIcons.svg(spec.icon);
    },

    __addButton(group) {
      if (group.sep) {
        this.add(this.__separator());
      }
      const box = new qx.ui.container.Composite(new qx.ui.layout.HBox(0).set({ alignY: "middle" }));
      box.setBackgroundColor("transparent");   // temanın "widget" zemini panelde kutu gibi görünüyordu
      const icon = this.__svgIcon(group);
      const html = `${icon}` +
        `<div style="margin-top:2px;font-size:11px;line-height:13px;text-align:center;white-space:nowrap">${qx.bom.String.escape(group.label)}</div>`;
      const main = new qx.ui.toolbar.Button(html).set({ rich: true, show: "label", center: true, padding: [4, 3], minWidth: 46 });
      const arrow = new qx.ui.toolbar.Button("▾").set({ show: "label", padding: [4, 1], minWidth: 12, toolTipText: `${group.label}: tüm seçenekler` });
      this.__flatten(main);
      this.__registerTool(main, icon);
      this.__flatten(arrow);
      main.addListener("execute", () => this.__pressMain(group, main));
      arrow.addListener("execute", () => this.__openMenu(group, arrow));
      box.add(main);
      box.add(arrow);
      this.add(box);
      this.__widgets.set(group.id, { box, main, arrow });
    },

    /** Menü → {grup kimliği → yapraklar}. Üst madde alt menüsüyle dağıtılır; alt menülü yaprak (ör. Oturum aç) olduğu gibi kalır. */
    __collect(menu) {
      const groups = new Map();
      groups.containers = {};   // kapsayıcı adı → alt menüsü (mirror grupları için, bkz. __leaves)
      const push = (id, leaf) => groups.set(id, (groups.get(id) || []).concat([leaf]));
      const key = item => item.getUserData("ankamon.menuKey") || "";
      const walk = (target, fallback) => target.getChildren().forEach(item => {
        if (!(item instanceof qx.ui.menu.Button)) {
          return;
        }
        const name = key(item);
        if (item.getMenu() && this.__containers[name]) {
          groups.containers[name] = item.getMenu();
          walk(item.getMenu(), this.__containers[name]);
        } else {
          push(this.__items[name] || fallback || "other", item);
        }
      });
      walk(menu, null);
      // Yetkisi olmayan birincil yoksa düğme de yok; noSelection maddeleri seçimsiz durumda süzülür (bkz. __leaves).
      return groups;
    },

    /** Seçim boşken yalnız noSelection maddeleri çalışır: sentetik kayıt üzerinde başka madde sunulmaz. */
    __leaves(group, groups, none, count) {
      let leaves = groups.get(group.id) || [];
      if (group.mirror) {
        const box = groups.containers && groups.containers[group.mirror];
        const own = box ? box.getChildren().filter(item => item instanceof qx.ui.menu.Button) : [];
        // extra (ör. Ekranı göster): tek tahta şartlı birincilse çoklu seçimde konmaz.
        const single = group.single !== "primary" || count === 1;
        const all = [...groups.values()].flat();
        const extra = single ? (group.extra || []).map(k => all.find(l => l.getUserData("ankamon.menuKey") === k)).filter(Boolean) : [];
        leaves = extra.concat(own.filter(l => !extra.includes(l)));
      }
      return none ? leaves.filter(l => (group.noSelection || []).includes(l.getUserData("ankamon.menuKey"))) : leaves;
    },

    __current() {
      const boards = this.__getSelected();
      const anchor = boards.find(b => b.online) || boards[0] || { id: 0, online: false, facts: {}, label: "" };
      return { boards, none: !boards.length, menu: this.__getMenu(anchor, boards.length ? boards : [anchor]) };
    },

    /** Seçim ya da seçili tahtaların durumu değiştiyse düğmelerin etkinliğini ve sayıyı tazeler. */
    refresh() {
      const boards = this.__getSelected();
      const all = this.__getAll ? this.__getAll() : null;
      if (all) {
        const chosen = new Set(boards.map(b => b.id));
        const online = all.filter(b => b.online);
        this.__totals = { on: online.length, off: all.length - online.length,
          onSel: online.filter(b => chosen.has(b.id)).length, offSel: all.filter(b => !b.online && chosen.has(b.id)).length };
      }
      const key = JSON.stringify([this.__totals, boards.map(b => [b.id, b.online, b.session_username, b.session_locked, b.screen_locked, b.input_locks,
        b.display_state, b.relay_source, b.relay_is_source])]);
      if (key === this.__stateKey) {
        return;
      }
      this.__stateKey = key;
      const cur = this.__current();
      const groups = cur.menu ? this.__collect(cur.menu) : new Map();
      this.__groups.forEach(group => {
        const w = this.__widgets.get(group.id);
        if (!w) {
          return;
        }
        const leaves = this.__leaves(group, groups, cur.none, boards.length);
        // single: true → düğmenin tamamı tek tahtada; "primary" → menü çoklu seçimde de açılır, birincil yalnız tek tahtada.
        const single = !group.single || group.single === "primary" || boards.length === 1;
        const on = single && leaves.some(l => l.getEnabled());
        [w.main, w.arrow].forEach(b => {
          b.setEnabled(on);
          b.setOpacity(on ? 1 : ankamon.ui.boards.ActionBar.OFF_OPACITY);
        });
        w.arrow.setVisibility(leaves.length > 1 || !group.primary ? "visible" : "excluded");
        // Birincil madde zengin ipucu taşıyorsa (userData "ankamon.menuHint", HTML — ör. Ahenk ▸ ETAP kontrol)
        // düğmede de o gösterilir; yoksa (seçim yokken madde de yok) grubun sabit hint'i (HTML, eklenti verir).
        // Düz toolTipText tek satırdır, uzun açıklama sığmaz.
        const primary = group.primary && leaves.find(l => l.getUserData("ankamon.menuKey") === group.primary);
        const rich = (primary && primary.getUserData("ankamon.menuHint")) || group.hint;
        if (group.single === "primary" && boards.length > 1) {
          w.main.setToolTip(null);
          w.main.setToolTipText(`${group.label}: seçenekler (${group.primary} yalnız tek tahta seçiliyken)`);
        } else if (!single) {
          w.main.setToolTip(null);
          w.main.setToolTipText(`${group.label}: yalnız tek tahta seçiliyken`);
        } else if (rich) {
          w.tip = w.tip || new qx.ui.tooltip.ToolTip().set({ rich: true, maxWidth: 460 });
          w.tip.setLabel(rich);
          w.main.setToolTip(w.tip);
        } else {
          w.main.setToolTip(null);
          w.main.setToolTipText(this.__tip(group, leaves));
        }
      });
      if (cur.menu) {
        this.__dropMenu(cur.menu);
      }
      this.__queueSeparators();
      this.__selectedCount = boards.length;
      this.__showCount();
    },

    __tip(group, leaves) {
      const primary = group.primary && leaves.find(l => l.getUserData("ankamon.menuKey") === group.primary);
      return primary && primary.getEnabled() ? group.primary : `${group.label}: seçenekler`;
    },

    __pressMain(group, button) {
      const cur = this.__current();
      const groups = cur.menu ? this.__collect(cur.menu) : new Map();
      const leaves = this.__leaves(group, groups, cur.none, cur.boards.length);
      const primary = group.primary && leaves.find(l => l.getUserData("ankamon.menuKey") === group.primary && l.getEnabled());
      if (primary && !primary.getMenu()) {
        this.__run(primary, cur.boards);
        this.__dropMenu(cur.menu);
        return;
      }
      this.__show(leaves, cur, button);
    },

    __openMenu(group, button) {
      const cur = this.__current();
      const groups = cur.menu ? this.__collect(cur.menu) : new Map();
      this.__show(this.__leaves(group, groups, cur.none, cur.boards.length), cur, button);
    },

    /** Yaprakları kendi menülerinden alıp düğmenin altında açar; PER_BOARD maddeleri çoklu seçimde her tahtaya uygulanır. */
    __show(leaves, cur, button) {
      if (this.__open) {
        const old = this.__open;
        qx.event.Timer.once(() => this.__dropMenu(old), null, 0);
      }
      const dropdown = new qx.ui.menu.Menu();
      leaves.forEach(leaf => {
        leaf.getLayoutParent().remove(leaf);
        const key = leaf.getUserData("ankamon.menuKey");
        if (cur.boards.length > 1 && this.__perBoard.includes(key)) {
          const each = ankamon.ui.BoardOps.menuButton(leaf.getUserData("ankamon.menuIcon"), `${key} (${cur.boards.length} tahta)`,
            () => this.__runEach(key, cur.boards));
          each.setEnabled(leaf.getEnabled());
          each.setUserData("ankamon.menuKey", key);
          dropdown.add(each);
          leaf.destroy();
        } else {
          dropdown.add(leaf);
        }
      });
      if (cur.menu) {
        this.__dropMenu(cur.menu);
      }
      this.__open = dropdown;
      dropdown.setOpener(button);
      dropdown.open();
    },

    /** Birincil işi çalıştırır; tek tahtalık madde çoklu seçimde her tahta için. */
    __run(leaf, boards) {
      const key = leaf.getUserData("ankamon.menuKey");
      if (boards.length > 1 && this.__perBoard.includes(key)) {
        this.__runEach(key, boards);
      } else {
        leaf.execute();
      }
    },

    async __runEach(key, boards) {
      const Bar = ankamon.ui.boards.ActionBar;
      if (boards.length > Bar.PER_BOARD_CONFIRM &&
          !await ankamon.ui.Dialog.confirm(`"${qx.bom.String.escape(key)}" <b>${boards.length} tahta</b> için ayrı ayrı açılsın mı?`, "Aç")) {
        return;
      }
      boards.forEach(board => {
        const menu = this.__getMenu(board, [board]);
        if (!menu) {
          return;
        }
        const leaf = [...this.__collect(menu).values()].flat().find(l => l.getUserData("ankamon.menuKey") === key);
        if (leaf && leaf.getEnabled()) {
          leaf.execute();
        }
        this.__dropMenu(menu);
      });
    },

    /** Menüyü ve alt menülerini kaldırır (aynı olay turunda değil: çalışan işleyici kendi düğmesini yok etmesin). */
    __dropMenu(menu) {
      const destroy = target => {
        if (target.isDisposed()) {
          return;
        }
        target.getChildren().slice().forEach(child => {
          if (child.getMenu && child.getMenu()) {
            destroy(child.getMenu());
          }
          child.destroy();
        });
        target.destroy();
      };
      qx.event.Timer.once(() => destroy(menu), null, 0);
    }
  }
});
