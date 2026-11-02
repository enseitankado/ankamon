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
 * Tahtalar ▸ Liste ve Ekranlar sekmelerinin üstündeki araç çubuğu: sağ menü işlevleri simgeli düğmeler olarak.
 *
 * TEK KAYNAK sağ menüdür: düğmenin her basışında menü, o anki seçimle baştan kurulur (getMenu) ve maddeler gruplara
 * dağıtılır. Yetki, tahta durumuna göre devre dışı bırakma, çoklu seçim ve işleyiciler menüden gelir; çubukta işlev
 * kodu yoktur. GROUPS'ta adı geçmeyen yeni menü maddesi "Diğer" düğmesinde kendiliğinden görünür.
 * Menüye eklenen, değişen ya da çıkan her madde için burada GROUPS/ITEMS da gözden geçirilir (kalıcı kural).
 *
 * Düğme: simgeye basmak grubun birincil işini yapar (primary yoksa ya da o an uygulanamıyorsa menüyü açar); ▾ aynı
 * türdeki bütün işleri açar. Güç gibi tek basışta tehlikeli işlerde bilerek primary yoktur.
 */
qx.Class.define("ankamon.ui.boards.ActionBar", {
  extend: qx.ui.container.Composite,

  statics: {
    /** Düğmeler, soldan sağa. noSelection: hiç tahta seçili değilken de çalışan maddeler. */
    GROUPS: [
      { id: "watch", label: "Ekran", icon: "deviceDesktop", primary: "Ekranı göster" },
      { id: "display", label: "Uyku", icon: "zzz", primary: "Uyut" },
      { id: "lock", label: "Kilit", icon: "lock", primary: "Kilitle" },
      { id: "cast", label: "Yansıt", icon: "cast" },
      { id: "shot", label: "Görüntü al", icon: "camera", primary: "Ekran görüntüsü al" },
      { id: "command", label: "Komut", icon: "terminal2", primary: "Hazır / Serbest komut çalıştır" },
      { id: "users", label: "Kullanıcılar", icon: "users" },
      { id: "files", label: "Dosyalar", icon: "folders", primary: "Dosya yöneticisi" },
      { id: "taskmgr", label: "Görevler", icon: "activity", primary: "Görev yöneticisi" },
      { id: "web", label: "Web sitesi", icon: "worldWww", primary: "Web sitesi aç…" },
      { id: "webfilter", label: "Web Filtre", icon: "filter" },
      { id: "wifi", label: "Wi-Fi", icon: "wifi", primary: "Wi-Fi Monitör" },
      { id: "chat", label: "Sohbet", icon: "messages", primary: "Sohbet" },
      { id: "power", label: "Güç", icon: "power" },
      { id: "info", label: "Bilgi", icon: "infoCircle", primary: "Bilgi kartı" },
      { id: "record", label: "Kayıt", icon: "edit", noSelection: ["Tahta ekle…"] },
      { id: "select", label: "Seçim", icon: "checkbox", primary: "Tümünü işaretle", noSelection: ["Tümünü işaretle", "İşaretleri kaldır"] },
      { id: "other", label: "Diğer", icon: "dots" }
    ],

    /** Alt menüsü düğmelere dağıtılan üst maddeler → içindeki bilinmeyen maddenin grubu. */
    CONTAINERS: { "Komut çalıştır": "command", "Ekran": "watch", "Kullanıcılar": "users", "Dosyalar": "files", "Web Filtre": "webfilter", "Web Filtre…": "webfilter" },

    /** Menü maddesi → grup (menüdeki etiket, tahta sayısı eki olmadan — bkz. BoardOps.menuButton). */
    ITEMS: {
      "Ekranı göster": "watch", "Ekranı yönet": "watch",
      "Uyandır": "display", "Uyut": "display",
      "Kilitle": "lock", "Kilidi aç": "lock", "Klavyeyi kilitle": "lock", "Klavye kilidini aç": "lock", "Fareyi kilitle": "lock",
      "Fare kilidini aç": "lock", "Dokunmatiği kilitle": "lock", "Dokunmatik kilidini aç": "lock",
      "Ekranımı yansıt": "cast", "Ekranı başka bilgisayara aktar…": "cast", "Ekran aktarımını durdur": "cast",
      "Ekran görüntüsü al": "shot",
      "Görev yöneticisi": "taskmgr", "Web sitesi aç…": "web", "Wi-Fi Monitör": "wifi", "Sohbet": "chat",
      "Bilgisayarı aç (WoL)": "power", "Bilgisayarı kapat": "power", "Bilgisayarı yeniden başlat": "power",
      "Bilgi kartı": "info", "Logları göster": "info",
      "Düzenle": "record", "Sil": "record", "Tahta ekle…": "record",
      "Tümünü işaretle": "select", "İşaretleri kaldır": "select"
    },

    /** Menüde tek tahtaya uygulanan maddeler: çoklu seçimde her tahta için ayrı açılır (pencere başına tahta). */
    PER_BOARD: ["Ekranı yönet", "Görev yöneticisi", "Wi-Fi Monitör", "Sohbet", "Dosya yöneticisi", "Düzenle"],
    PER_BOARD_CONFIRM: 6
  },

  /**
   * @param getMenu {Function} (tahta, tahtalar) → qx.ui.menu.Menu|null: sağ menüyü kurar
   * @param getSelected {Function} () → seçili tahtalar
   */
  construct(getMenu, getSelected) {
    super(new qx.ui.layout.Flow(2, 2).set({ alignY: "middle" }));
    this.__getMenu = getMenu;
    this.__getSelected = getSelected;
    this.__widgets = new Map();
    this.set({ appearance: "toolbar", padding: [2, 6] });
    this.__build();
    this.__count = new qx.ui.basic.Label("").set({ textColor: "app-muted", alignY: "middle", marginLeft: 10 });
    this.add(this.__count);
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
    __widgets: null,
    __count: null,
    __open: null,
    __stateKey: null,

    /** Yetkiye göre var olan düğmeler: sentetik çevrimiçi ve çevrimdışı tahtanın menülerinden. */
    __build() {
      const present = new Set();
      [true, false].forEach(online => {
        const probe = { id: 0, online, facts: {}, label: "" };
        const menu = this.__getMenu(probe, [probe, Object.assign({}, probe, { id: -1 })]);
        if (menu) {
          this.__collect(menu).forEach((leaves, id) => leaves.length && present.add(id));
          this.__dropMenu(menu);
        }
      });
      ankamon.ui.boards.ActionBar.GROUPS.filter(g => present.has(g.id)).forEach(group => this.__addButton(group));
    },

    __addButton(group) {
      const box = new qx.ui.container.Composite(new qx.ui.layout.HBox(0).set({ alignY: "middle" }));
      const html = `${ankamon.ui.boards.ActionIcons.svg(group.icon)}` +
        `<div style="margin-top:2px;font-size:11px;line-height:13px;text-align:center;white-space:nowrap">${qx.bom.String.escape(group.label)}</div>`;
      const main = new qx.ui.toolbar.Button(html).set({ rich: true, show: "label", center: true, padding: [4, 6], minWidth: 58 });
      const arrow = new qx.ui.toolbar.Button("▾").set({ show: "label", padding: [4, 2], minWidth: 14, toolTipText: `${group.label}: tüm seçenekler` });
      main.addListener("execute", () => this.__pressMain(group, main));
      arrow.addListener("execute", () => this.__openMenu(group, arrow));
      box.add(main);
      box.add(arrow);
      this.add(box);
      this.__widgets.set(group.id, { box, main, arrow });
    },

    /** Menü → {grup kimliği → yapraklar}. Üst madde alt menüsüyle dağıtılır; alt menülü yaprak (ör. Oturum aç) olduğu gibi kalır. */
    __collect(menu) {
      const Bar = ankamon.ui.boards.ActionBar;
      const groups = new Map();
      const push = (id, leaf) => groups.set(id, (groups.get(id) || []).concat([leaf]));
      const key = item => item.getUserData("ankamon.menuKey") || "";
      const walk = (target, fallback) => target.getChildren().forEach(item => {
        if (!(item instanceof qx.ui.menu.Button)) {
          return;
        }
        const name = key(item);
        if (item.getMenu() && Bar.CONTAINERS[name]) {
          walk(item.getMenu(), Bar.CONTAINERS[name]);
        } else {
          push(Bar.ITEMS[name] || fallback || "other", item);
        }
      });
      walk(menu, null);
      // Yetkisi olmayan birincil yoksa düğme de yok; noSelection maddeleri seçimsiz durumda süzülür (bkz. __leaves).
      return groups;
    },

    /** Seçim boşken yalnız noSelection maddeleri çalışır: sentetik kayıt üzerinde başka madde sunulmaz. */
    __leaves(group, groups, none) {
      const leaves = groups.get(group.id) || [];
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
      const key = JSON.stringify(boards.map(b => [b.id, b.online, b.session_username, b.session_locked, b.screen_locked, b.input_locks,
        b.display_state, b.relay_source, b.relay_is_source]));
      if (key === this.__stateKey) {
        return;
      }
      this.__stateKey = key;
      const cur = this.__current();
      const groups = cur.menu ? this.__collect(cur.menu) : new Map();
      ankamon.ui.boards.ActionBar.GROUPS.forEach(group => {
        const w = this.__widgets.get(group.id);
        if (!w) {
          return;
        }
        const leaves = this.__leaves(group, groups, cur.none);
        const on = leaves.some(l => l.getEnabled());
        [w.main, w.arrow].forEach(b => {
          b.setEnabled(on);
          b.setOpacity(on ? 1 : ankamon.ui.BoardOps.DISABLED_OPACITY);
        });
        w.arrow.setVisibility(leaves.length > 1 || !group.primary ? "visible" : "excluded");
        w.main.setToolTipText(this.__tip(group, leaves));
      });
      if (cur.menu) {
        this.__dropMenu(cur.menu);
      }
      this.__count.setValue(boards.length ? `${boards.length} tahta seçili` : "Tahta seçili değil");
    },

    __tip(group, leaves) {
      const primary = group.primary && leaves.find(l => l.getUserData("ankamon.menuKey") === group.primary);
      return primary && primary.getEnabled() ? group.primary : `${group.label}: seçenekler`;
    },

    __pressMain(group, button) {
      const cur = this.__current();
      const groups = cur.menu ? this.__collect(cur.menu) : new Map();
      const leaves = this.__leaves(group, groups, cur.none);
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
      this.__show(this.__leaves(group, groups, cur.none), cur, button);
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
        if (cur.boards.length > 1 && ankamon.ui.boards.ActionBar.PER_BOARD.includes(key)) {
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
      if (boards.length > 1 && ankamon.ui.boards.ActionBar.PER_BOARD.includes(key)) {
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
