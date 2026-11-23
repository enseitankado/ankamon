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
 * Kullanıcı ekle / düzenle penceresinin yetki seçicisi (kullanıcı isteği 2026-11-23: "çok fazla özellik seçeneği var;
 * kullanım senaryolarına göre hazır seçim sağlayan gruplara ayır"):
 *  - Üstte HAZIR ROLLER (ROLES): okuldaki tipik görevler için yetki ön ayarları. Tıklama seçimi o rolle DEĞİŞTİRİR
 *    ("yalnız bu"); Ctrl ya da Shift ile tıklama rolün yetkilerini mevcut seçime EKLER (roller birleşir). Değişiklik
 *    durum satırında "+n / −n" olarak yazılır ve "Geri al" ile önceki seçime dönülür.
 *  - Altta KONU GRUPLARI (GROUPS): başlıklı, katlanır bölümler; başlıktaki üç durumlu kutu grubun hepsini seçer/kaldırır,
 *    sayaç (seçili/toplam) katlıyken de görünür. Tabloda olmayan yetki (yeni çekirdek ya da eklenti yetkisi) "Diğer"e düşer.
 *  - Bağımlılıklar (feature.parent, bkz. backend/config/feature_deps.php): alt yetki seçilince üstü de seçilir, üst
 *    kaldırılınca altları da kalkar (sunucu da kaydederken üstü ekler — UsersApi). Üstü başka grupta olan alt yetkinin
 *    yanında "gerektirir: …" yazar.
 *
 * GELECEK YETKİLER: backend/config/features.php'ye (ya da bir eklentinin features.php'sine) yeni yetki eklenince
 * buradaki GROUPS'ta uygun gruba ve ROLES'ta onu alması gereken rollere de eklenmeli; eklenmezse "Diğer" grubunda
 * görünür ve yalnız "all: true" rollere (BT sorumlusu, Tam yetki) girer — yıkıcı (silme vb.) bir yetkiyse BT
 * sorumlusunun "except" listesine de yazılmalı.
 */
qx.Class.define("ankamon.ui.users.FeatureRolePicker", {
  extend: qx.core.Object,

  /**
   * @param features {Array} /api/features kataloğu ([{key, label, parent}])
   * @param selected {Array} başlangıçta seçili yetki anahtarları
   */
  construct(features, selected) {
    super();
    const keys = new Set(features.map(f => f.key));
    this.__features = features;
    this.__parentOf = new Map(features.map(f => [f.key, f.parent && keys.has(f.parent) ? f.parent : null]));
    this.__labelOf = new Map(features.map(f => [f.key, f.label]));
    this.__boxes = new Map();
    this.__groups = [];
    this.__buildRoleBar();
    this.__buildGroups();
    // Eski kayıtta alt yetki açık ama üstü kapalıysa üst açılır (sunucu da kaydederken aynısını yapar).
    this.__setSelection(this.__closure(selected.filter(key => keys.has(key))));
    this.__boxes.forEach((box, key) => box.addListener("changeValue", e => this.__onBoxChange(key, e.getData())));
    this.__update();
  },

  statics: {
    /**
     * Konu grupları (sırası pencerede görünen sıradır). keys içindeki sıra grubun içindeki sıradır — üst yetki
     * alt yetkisinden önce yazılır (aynı gruptaki altlar girintili çizilir). Katalogda olmayan anahtar atlanır.
     */
    GROUPS: [
      { id: "izleme", label: "Cihaz izleme",
        hint: "Genel bakış, cihaz listesi, ekranları canlı izleme — cihaz yetkilerinin çoğu 'Cihazları görüntüleme'yi gerektirir (kendiliğinden seçilir)",
        keys: ["dashboard", "devices", "screen", "screen.screenshot"] },
      { id: "sinif", label: "Sınıf etkileşimi (ekran ve iletişim)",
        hint: "Sohbet, ekran yansıtma, web sitesi açma, ekran/klavye kilidi, ekran aktarımı, uzaktan müdahale",
        keys: ["devices.chat", "cast", "screen.web", "screen.lock", "screen.input", "screen.relay", "screen.control"] },
      { id: "yonetim", label: "Cihaz yönetimi ve komut",
        hint: "Kayıt düzenleme, aç/kapat, hazır işlemler, görev yöneticisi, web filtresi, root komut ve dosya erişimi",
        keys: ["devices.manage", "power", "actions", "taskmgr", "devices.webfilter", "devices.login", "shell", "filemanager", "tiha"] },
      { id: "hesap", label: "Cihaz hesapları, parolalar ve yedek",
        hint: "Cihazda kullanıcı açma/silme, parola ayarlama, ev dizini yedekleme ve geri yükleme",
        keys: ["devices.users", "devices.passwords", "devices.passwords.etapadmin", "devices.passwords.root",
          "devices.backup", "devices.restore"] },
      { id: "saglik", label: "Sağlık, bakım ve sensörler", hint: "Anomaliler, bildirimler, sorun tespiti (SMART, sıcaklık), sensör grafikleri",
        keys: ["anomalies", "anomalies.notify", "diagnose", "metrics"] },
      { id: "kayit", label: "Oturumlar, ligler ve loglar",
        hint: "Cihaz oturumları, sohbet geçmişi, kullanım ligleri ve loglar ('Logları görüntüleme' bu sayfaları açar)",
        keys: ["logs", "logs.exclude", "leagues.exclude", "sessions.hosts", "sessions.manage"] },
      { id: "ag", label: "Ağ ve varlıklar", hint: "Ağ envanteri (Varlıklar): ağdaki bütün cihazlar ve servisleri",
        keys: ["network", "network.manage"] },
      { id: "envanter", label: "Envanter ve arıza", hint: "Cihaz kartları, arıza künyeleri, dış servis çağrıları, raporlar (eklenti)",
        keys: ["envanter", "envanter.yonetim", "ariza", "ariza.yonetim"] },
      { id: "sistem", label: "Sistem", hint: "Ankamon oturum denetimi, kalıcı veri silme (Disk kullanımı)",
        keys: ["logins", "logs.manage"] }
    ],

    /** Tabloda olmayan yetkilerin grubu. */
    OTHER_GROUP: { id: "diger", label: "Diğer", hint: "Gruplanmamış yetkiler (yeni ya da eklenti yetkileri)" },

    /**
     * Hazır roller. keys: rolün yetkileri (üst yetkiler kendiliğinden eklenir; katalogda olmayan atlanır — eklenti
     * kurulu değilse ör. "envanter"). all: true → katalogdaki bütün yetkiler, except hariç.
     */
    ROLES: [
      { id: "ogretmen", label: "Ders öğretmeni",
        hint: "Sınıftaki tahtayı izler ve öğrenciyle etkileşir: ekranı izleme ve görüntüsünü alma, sohbet, kendi ekranını "
          + "yansıtma, web sitesi açma, ekran ve klavye/fare kilidi. Komut çalıştıramaz, cihazı kapatamaz, ayar değiştiremez.",
        keys: ["dashboard", "devices", "screen", "screen.screenshot", "screen.web", "screen.lock", "screen.input",
          "devices.chat", "cast"] },
      { id: "idareci", label: "İdareci / müdür yardımcısı",
        hint: "Yalnız izleme ve raporlar: genel bakış, ekranları izleme, oturumlar / ligler / loglar, sağlık ve sensörler, "
          + "Varlıklar, Ankamon oturum denetimi, envanter raporları ve arıza kaydı. Cihaza müdahale etmez.",
        keys: ["dashboard", "devices", "screen", "screen.screenshot", "logs", "anomalies", "metrics", "network", "logins",
          "envanter", "ariza"] },
      { id: "envanter", label: "Envanter ve arıza sorumlusu",
        hint: "Demirbaş ve arıza takibi: cihaz ve varlık kayıtlarını düzenleme, envanter kartları, arıza künyeleri ve dış "
          + "servis (silme dahil), sağlık / sorun tespiti ve sensörler. Ekran izleme ve komut yok.",
        keys: ["dashboard", "devices", "devices.manage", "network", "network.manage", "envanter", "envanter.yonetim",
          "ariza", "ariza.yonetim", "anomalies", "diagnose", "metrics"] },
      { id: "teknik", label: "Teknik servis / bakım",
        hint: "Donanım bakımı ve arıza giderme: aç/kapat, hazır işlemler, görev yöneticisi, sorun tespiti, uzaktan ekran "
          + "müdahalesi, cihaz hesapları ve parolaları (etapadmin/root hariç), ev dizini yedek/geri al, loglar, envanter ve "
          + "arıza kaydı. Serbest root komut, dosya sistemi, TiHA ve kalıcı silme yok.",
        keys: ["dashboard", "devices", "devices.manage", "power", "actions", "taskmgr", "diagnose", "anomalies", "metrics",
          "logs", "screen", "screen.control", "screen.screenshot", "network", "devices.backup", "devices.restore",
          "devices.users", "devices.passwords", "devices.login", "envanter", "ariza"] },
      { id: "bt", label: "Bilişim öğretmeni / BT sorumlusu",
        hint: "Okulun günlük işletmesi: cihaz ve ağ yönetiminin tamamı (root komut, dosya sistemi, TiHA, parolalar, web "
          + "filtresi, bildirimler dahil). Kalıcı veri silme (loglar/oturum kayıtları/envanter ve arıza kayıtları) ve "
          + "Ankamon oturum denetimi hariç.",
        all: true, except: ["logs.manage", "sessions.manage", "sessions.hosts", "envanter.yonetim", "ariza.yonetim", "logins"] },
      { id: "tam", label: "Tam yetki (yönetici olmadan)",
        hint: "Listedeki bütün yetkiler. Kullanıcı hesapları ve Ayarlar yine yalnız etapadmin'dedir.",
        all: true }
    ]
  },

  members: {
    __features: null,
    __parentOf: null,
    __labelOf: null,
    __boxes: null,
    __groups: null,
    __roleBar: null,
    __roleButtons: null,
    __status: null,
    __undo: null,
    __undoButton: null,
    __list: null,
    __quiet: false,
    __additive: false,

    /** Pencerenin üstüne konacak rol düğmeleri + durum satırı. */
    getRoleBar() {
      return this.__roleBar;
    },

    /** Katlanır grupların listesi (pencere bunu kaydırılabilir alana koyar). */
    getList() {
      return this.__list;
    },

    /** Seçili yetki anahtarları (katalog sırasıyla). */
    getSelected() {
      return this.__features.map(f => f.key).filter(key => this.__boxes.get(key).getValue());
    },

    /** İçeriği seçili olmayan grupları katlar (pencere ölçüldükten sonra çağrılır: liste açıkken ölçülür). */
    collapseEmptyGroups() {
      this.__groups.forEach(group => this.__setOpen(group, group.keys.some(key => this.__boxes.get(key).getValue())));
    },

    /** Rolün yetki kümesi (yalnız katalogdakiler, üstleri dahil). */
    roleKeys(role) {
      const keys = this.__features.map(f => f.key);
      const wanted = role.all ? keys.filter(key => !(role.except || []).includes(key)) : role.keys.filter(key => this.__boxes.has(key));
      return this.__closure(wanted);
    },

    __closure(keys) {
      const out = new Set();
      keys.forEach(key => {
        for (let k = key; k && !out.has(k); k = this.__parentOf.get(k)) {
          out.add(k);
        }
      });
      return out;
    },

    __buildRoleBar() {
      const Policy = ankamon.ui.ToolTipPolicy;
      this.__roleBar = new qx.ui.container.Composite(new qx.ui.layout.VBox(4));
      const head = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      head.add(new qx.ui.basic.Label("Hazır roller").set({ font: "bold" }));
      head.add(new qx.ui.basic.Label("tıklama: seçimi bu rolle değiştirir · Ctrl/Shift + tıklama: mevcut seçime ekler")
        .set({ textColor: "text-placeholder" }));
      this.__roleBar.add(head);
      const flow = new qx.ui.container.Composite(new qx.ui.layout.Flow(6, 6));
      this.__roleButtons = [];
      const tail = "\n\nTıklama: seçimi bu rolle DEĞİŞTİRİR (yalnız bu rol).\nCtrl ya da Shift ile tıklama: rolün yetkilerini mevcut "
        + "seçime EKLER (birden çok rol birleşir).\nDüğme basılı görünüyorsa rolün bütün yetkileri seçili demektir.";
      this.constructor.ROLES.forEach(role => {
        const button = new qx.ui.form.ToggleButton(role.label).set({ focusable: true });
        button.setToolTip(Policy.wrapped(role.hint + tail, 460));
        // execute'ta tuş bilgisi yok: basıştaki Ctrl/Shift saklanır (klavyeyle basış = değiştir).
        button.addListener("pointerdown", e => {
          this.__additive = e.isCtrlPressed() || e.isShiftPressed();
        });
        button.addListener("execute", () => {
          this.__applyRole(role, this.__additive);
          this.__additive = false;
        });
        this.__roleButtons.push({ role, button });
        flow.add(button);
      });
      const none = new qx.ui.form.Button("Hiçbiri");
      none.setToolTip(Policy.wrapped("Bütün yetki işaretlerini kaldırır (\"Geri al\" ile dönülebilir)."));
      none.addListener("execute", () => this.__applySet(new Set(), "Bütün yetkiler kaldırıldı"));
      flow.add(none);
      this.__roleBar.add(flow);

      const statusRow = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      this.__status = new qx.ui.basic.Label("").set({ rich: true });
      this.__undoButton = new qx.ui.form.Button("Geri al").set({ visibility: "excluded", padding: [1, 8] });
      this.__undoButton.setToolTip(Policy.wrapped("Rol uygulanmadan / grup değiştirilmeden önceki seçime döner."));
      this.__undoButton.addListener("execute", () => {
        if (this.__undo) {
          const prev = this.__undo;
          this.__undo = null;
          this.__setSelection(prev);
          this.__undoButton.exclude();
          this.__update("Önceki seçime dönüldü.");
        }
      });
      statusRow.add(this.__status);
      statusRow.add(this.__undoButton);
      this.__roleBar.add(statusRow);
    },

    __buildGroups() {
      const statics = this.constructor;
      const known = new Set();
      const groups = statics.GROUPS.map(g => {
        const keys = g.keys.filter(key => this.__labelOf.has(key) && !known.has(key));
        keys.forEach(key => known.add(key));
        return Object.assign({}, g, { keys });
      });
      groups.push(Object.assign({}, statics.OTHER_GROUP, { keys: this.__features.map(f => f.key).filter(key => !known.has(key)) }));
      const groupOf = new Map();
      groups.forEach(g => g.keys.forEach(key => groupOf.set(key, g.id)));
      const childCount = new Map();
      this.__parentOf.forEach(parent => parent && childCount.set(parent, (childCount.get(parent) || 0) + 1));

      this.__list = new qx.ui.container.Composite(new qx.ui.layout.VBox(6));
      groups.filter(g => g.keys.length).forEach(g => {
        const header = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
        const toggle = new qx.ui.form.Button("▾").set({ appearance: "button", padding: [0, 6], width: 26, focusable: false });
        toggle.setToolTip(ankamon.ui.ToolTipPolicy.wrapped("Grubu aç / kapat"));
        const all = new qx.ui.form.CheckBox(g.label).set({ triState: true, font: "bold" });
        all.setToolTip(ankamon.ui.ToolTipPolicy.wrapped("Bu gruptaki bütün yetkileri seç / kaldır"
          + " (başka gruptaki gerekli üst yetkiler de seçilir)."));
        const count = new qx.ui.basic.Label("").set({ textColor: "text-placeholder", minWidth: 36 });
        const hint = new qx.ui.basic.Label(qx.bom.String.escape(g.hint)).set({ textColor: "text-placeholder", rich: true, wrap: true });
        header.add(toggle);
        header.add(all);
        header.add(count);
        header.add(hint, { flex: 1 });
        const body = new qx.ui.container.Composite(new qx.ui.layout.VBox(2)).set({ marginLeft: 32, marginBottom: 4 });
        g.keys.forEach(key => {
          let depth = 0;
          for (let p = this.__parentOf.get(key); p && groupOf.get(p) === g.id; p = this.__parentOf.get(p)) {
            depth++;
          }
          const parent = this.__parentOf.get(key);
          let label = qx.bom.String.escape(this.__labelOf.get(key));
          let tip = null;
          if (parent && groupOf.get(parent) !== g.id) {
            // Üstü başka grupta: neden kendiliğinden işaretlendiği/kalktığı belli olsun. Çok yetkinin ortak üstü
            // ("Cihazları görüntüleme") her satırda tekrarlanınca liste kalabalıklaşıyordu: o yalnız ipucunda.
            const short = this.__labelOf.get(parent).split(/[:(—]/)[0].trim();
            tip = `Gerektirir: ${short} — bu yetki seçilince o da seçilir, o kaldırılınca bu da kalkar.`;
            if (childCount.get(parent) < 8) {
              label += ` <span style="opacity:.6">— gerektirir: ${qx.bom.String.escape(short)}</span>`;
            }
          }
          const box = new qx.ui.form.CheckBox(label).set({ rich: true, marginLeft: depth * 22 });
          if (tip) {
            box.setToolTip(ankamon.ui.ToolTipPolicy.wrapped(tip));
          }
          box.setUserData("key", key);
          this.__boxes.set(key, box);
          body.add(box);
        });
        const group = { id: g.id, keys: g.keys, header, toggle, all, count, body, open: true };
        toggle.addListener("execute", () => this.__setOpen(group, !group.open));
        all.addListener("changeValue", e => {
          if (this.__quiet) {
            return;
          }
          const on = e.getData() !== false; // üç durumlu kutu kullanıcı tıklamasında null olmaz; olursa seç sayılır
          const next = new Set(this.getSelected());
          if (on) {
            this.__closure(g.keys).forEach(key => next.add(key));
          } else {
            // Grubun yetkileri ve (başka gruptaki) altları kalkar.
            const drop = new Set(g.keys);
            this.__features.forEach(f => {
              for (let p = this.__parentOf.get(f.key); p; p = this.__parentOf.get(p)) {
                if (drop.has(p)) {
                  drop.add(f.key);
                  break;
                }
              }
            });
            drop.forEach(key => next.delete(key));
          }
          this.__applySet(next, `«${g.label}» grubu ${on ? "seçildi" : "kaldırıldı"}`);
        });
        this.__list.add(header);
        this.__list.add(body);
        this.__groups.push(group);
      });
    },

    __setOpen(group, open) {
      group.open = open;
      group.toggle.setLabel(open ? "▾" : "▸");
      group.body.setVisibility(open ? "visible" : "excluded");
    },

    /** Kullanıcı tek kutuyu değiştirdi: alt seçilince üst seçilir, üst kalkınca altlar kalkar. */
    __onBoxChange(key, on) {
      if (this.__quiet) {
        return;
      }
      this.__quiet = true;
      try {
        if (on) {
          for (let p = this.__parentOf.get(key); p; p = this.__parentOf.get(p)) {
            this.__boxes.get(p).setValue(true);
          }
        } else {
          this.__features.forEach(f => {
            for (let p = this.__parentOf.get(f.key); p; p = this.__parentOf.get(p)) {
              if (p === key) {
                this.__boxes.get(f.key).setValue(false);
                break;
              }
            }
          });
        }
      } finally {
        this.__quiet = false;
      }
      this.__update();
    },

    __applyRole(role, additive) {
      const next = additive ? new Set(this.getSelected()) : new Set();
      this.roleKeys(role).forEach(key => next.add(key));
      this.__applySet(next, `«${role.label}» ${additive ? "mevcut seçime eklendi" : "uygulandı"}`);
    },

    /** Seçimi topluca değiştirir; değişen grupları açar, farkı ve "Geri al"ı gösterir. */
    __applySet(next, what) {
      const before = new Set(this.getSelected());
      const added = [...next].filter(key => !before.has(key));
      const removed = [...before].filter(key => !next.has(key));
      if (added.length || removed.length) {
        this.__undo = before;
        this.__undoButton.show();
      }
      this.__setSelection(next);
      const changed = new Set(added.concat(removed));
      this.__groups.forEach(group => {
        if (group.keys.some(key => changed.has(key))) {
          this.__setOpen(group, true);
        }
      });
      const diff = added.length || removed.length
        ? `<b>+${added.length}</b> eklendi, <b>−${removed.length}</b> kaldırıldı` : "seçim zaten böyleydi";
      this.__update(`${qx.bom.String.escape(what)}: ${diff}.`);
    },

    __setSelection(keys) {
      this.__quiet = true;
      try {
        this.__boxes.forEach((box, key) => box.setValue(keys.has(key)));
      } finally {
        this.__quiet = false;
      }
    },

    /** Grup sayaçları, grup kutuları, rol düğmeleri ve durum satırı. */
    __update(message) {
      const selected = new Set(this.getSelected());
      this.__quiet = true;
      try {
        this.__groups.forEach(group => {
          const n = group.keys.filter(key => selected.has(key)).length;
          group.count.setValue(`${n}/${group.keys.length}`);
          group.all.setValue(n === 0 ? false : n === group.keys.length ? true : null);
        });
        const exact = [];
        this.__roleButtons.forEach(({ role, button }) => {
          const keys = this.roleKeys(role);
          const contained = [...keys].every(key => selected.has(key));
          button.setValue(contained && keys.size > 0);
          if (contained && keys.size === selected.size) {
            exact.push(role.label);
          }
        });
        const summary = exact.length ? `Seçim: <b>${qx.bom.String.escape(exact[0])}</b> rolüyle aynı`
          : `Seçim: özel (${selected.size} yetki)`;
        this.__status.setValue(message ? `${message} ${summary}.` : summary + ".");
      } finally {
        this.__quiet = false;
      }
    }
  }
});
