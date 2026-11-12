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
 * Eklenti noktaları. Eklentiler public depoda DEĞİL, ext/<ad>/ altında ayrı (ör. private) depolarda durur
 * (bkz. ext/README.md); bu dosya yalnız genel kancaları tanımlar, hiçbir eklentiyi adıyla bilmez.
 *
 * Derleme (Dockerfile "frontend" aşaması, frontend/ext-libs.js) ext/<ad>/frontend'i qooxdoo kütüphanesi
 * olarak ekler ve "ankamonext.*" sınıflarını pakete katar. Oturum açılınca start() her
 * "ankamonext.<ad>.Extension" sınıfının statik init(context) metodunu bir kez çağırır. Eklenti yoksa
 * hiçbir şey olmaz.
 *
 * Kancalar: on(ad, işleyici) ile kaydolunur; çekirdek handle(ad, ...) ile sorar. İşleyicilerden biri true
 * döndürürse olay "işlendi" sayılır ve çekirdek kendi varsayılan davranışını atlar. Kancalar:
 *  - "devices.statusFilter" (metin, sayfa): Cihazlar grid'inin Durum süzgeç kutusuna yazılan metin.
 *    İşlendi ise kutu temizlenir, süzme yapılmaz.
 *  - "settings.extensionHidden" (eklenti adı): Ayarlar ▸ Eklentiler listesi. İşlendi ise (true) o eklentinin
 *    bölümü gösterilmez (yalnız arayüz; API yönetici yetkisiyle yine erişilebilir).
 *  - "statusBar.usersVisible" (): alt çubuktaki oturum açmış kullanıcılar göstergesi (👤 + ipucu).
 *    Varsayılan gizli; işlendi ise (true) görünür.
 * Kanca dışındaki eklenti noktaları: addMaintenanceTab (Bakım sekmesi), addDeviceMenu (Cihazlar sağ menüsü
 * maddesi ve isteğe bağlı araç çubuğu düğmesi), addPage (sol menüde eklentinin kendi sayfası), addWifiTrustedAction
 * (Wi-Fi Monitör güvenilir listesinde işaretli kayıtlara düğme), addDiskUsageTab (Sistem ▸ Disk kullanımı'nda eklentinin
 * verisi için sekme), addSettingsTab (Ayarlar ▸ Eklentiler'de eklentinin bölümüne ayar formunun yanında ek sekme).
 *
 * Bir eklentinin durumu değişip kanca yanıtları farklılaşınca changed() çağrılır (CHANGED mesajı): kancayı
 * sürekli gösterilen bir öğe için soran çekirdek bileşenleri (ör. alt çubuk) yanıtı yeniden değerlendirir.
 */
qx.Class.define("ankamon.ext.Extensions", {
  type: "static",

  statics: {
    /** Mesaj veriyolu adı: eklenti durumu değişti, kancalar yeniden sorulmalı (bkz. changed). */
    CHANGED: "ankamon.ext.changed",

    __handlers: {},
    __started: false,
    __enabled: {},          // {eklenti-adı: etkin mi} — start()'ta GET /extensions/active'ten
    __maintenanceTabs: [],  // eklentilerin Bakım sekmeleri (bkz. addMaintenanceTab)
    __pages: [],            // eklentilerin sol menü sayfaları (bkz. addPage)
    __wifiTrustedActions: [], // eklentilerin Wi-Fi Monitör güvenilir listesi düğmeleri (bkz. addWifiTrustedAction)
    __deviceMenus: [],       // eklentilerin Cihazlar sağ menüsü maddeleri (bkz. addDeviceMenu)
    __diskUsageTabs: [],    // eklentilerin Disk kullanımı sekme tanımı üreticileri (bkz. addDiskUsageTab)
    __settingsTabs: {},     // {eklenti-adı: [{key, label, create}]} Ayarlar ▸ Eklentiler ek sekmeleri (bkz. addSettingsTab)

    /**
     * Oturum açıldığında BİR KEZ, Shell oluşturulmadan ÖNCE (bkz. ankamon.Application): önce eklentilerin
     * etkin/pasif durumu alınır, sonra her "ankamonext.<ad>.Extension" sınıfının init(context)'i çağrılır
     * (sekme/kanca kaydı için; eklenti yalnız etkinse sekme kaydetmeli). Bir eklentinin hatası ötekileri
     * ve uygulamayı durdurmaz.
     * @param context {Map} { user, app }
     */
    async start(context) {
      if (this.__started) {
        return;
      }
      this.__started = true;
      try {
        this.__enabled = (await ankamon.io.Api.get("/extensions/active")).active || {};
      } catch (e) {
        this.__enabled = {}; // ulaşılamazsa hepsi etkin sayılır (enabled varsayılanı: evet)
      }
      Object.keys(qx.Class.$$registry)
        .filter(name => /^ankamonext\.[A-Za-z0-9_]+\.Extension$/.test(name))
        .forEach(name => {
          try {
            qx.Class.getByName(name).init(context);
          } catch (e) {
            qx.log.Logger.error(this, `Eklenti başlatılamadı: ${name}: ${e}`);
          }
        });
    },

    /** @return {Boolean} eklenti etkin mi (varsayılan evet; yalnız açıkça false ise pasif). */
    enabled(name) {
      return this.__enabled[name] !== false;
    },

    /** Bir eklenti Bakım sayfasına sekme ekler: {key, label, feature, create(user)}.
     * init() içinde yalnız enabled(ad) ise çağrılmalı. Hem sayfadaki sekme çubuğu hem sol ağaç bunu okur. */
    addMaintenanceTab(spec) {
      this.__maintenanceTabs.push(spec);
    },

    /** @return {Array} kayıtlı Bakım sekmesi tanımları ({key,label,feature,create}). */
    maintenanceTabs() {
      return this.__maintenanceTabs;
    },

    /**
     * Bir eklenti Cihazlar sağ menüsüne (grid satırı ve ekran kutucuğu — ikisi de page.Devices.__rowMenu) madde
     * ekler; araç çubuğu menüden türediği için madde çubukta da görünür (bkz. ui.devices.ActionBar). init() içinde
     * yalnız eklenti etkinse çağrılmalı.
     * @param spec {Map} {
     *   build: (device, devices, user) → qx.ui.menu.Button|null — maddeyi kurar (DeviceOps.menuButton ile; null: yok).
     *     ActionBar yetkiyi sınamak için sentetik cihazla da çağırır ({id: 0, online, label: ""}).
     *   parent: isteğe bağlı çekirdek grubunun etiketi (ör. "Komut çalıştır"): madde o grubun alt menüsüne girer;
     *     araç çubuğunda da o grubun düğmesinde görünür (grup yoksa — yetki/çevrimdışı — eklentinin kendi bölümüne).
     *   bar: {id, label, iconSvg|icon, mirror?, primary?, sep?, single?, hint?} — isteğe bağlı ayrı araç çubuğu düğmesi;
     *     mirror maddenin etiketiyse düğmenin menüsü maddenin alt menüsünün aynısıdır.
     *   platforms: isteğe bağlı — maddenin (ve alt maddelerinin) çalıştığı işletim sistemi aileleri: ["linux", "windows",
     *     "macos", "other"] ya da "*" (hepsi; ör. yalnız Ankamon kaydı tutan işlevler). Verilmezse katalogdaki menü anahtarına,
     *     o da yoksa yalnız Linux'a göre (bkz. ui.devices.Platforms, platforms/README.md).
     * }
     */
    addDeviceMenu(spec) {
      this.__deviceMenus.push(spec);
    },

    /** UYUMLULUK (terim geçişi 2026-11-12): eski adı — addDeviceMenu ile aynı. */
    addBoardMenu(spec) {
      this.addDeviceMenu(spec);
    },

    /** @return {Array} eklentilerin bu cihaz(lar) için kurduğu sağ menü maddeleri (hata veren eklenti atlanır); parent
     * verilen maddede userData "ankamon.menuParent" (bkz. page.Devices.__rowMenu). */
    deviceMenuItems(device, devices, user) {
      return this.__deviceMenus.map(spec => {
        try {
          const item = spec.build(device, devices, user) || null;
          if (item && spec.parent) {
            item.setUserData("ankamon.menuParent", spec.parent);
          }
          if (item && spec.platforms) {
            item.setUserData("ankamon.platforms", spec.platforms);
          }
          return item;
        } catch (e) {
          qx.log.Logger.error(this, `Eklenti sağ menü maddesi kurulamadı: ${e}`);
          return null;
        }
      }).filter(Boolean);
    },

    /** @return {Array} eklentilerin Cihazlar araç çubuğu grupları (bkz. addDeviceMenu bar). */
    deviceBarGroups() {
      return this.__deviceMenus.filter(spec => spec.bar).map(spec => spec.bar);
    },

    /**
     * Bir eklenti sol menüye kendi sayfasını ekler — ui.Shell PAGES biçiminde: {id, label, icon?, feature? | features? |
     * admin?, parent?, tabs?, retap?, create(user)}. create bir ankamon.page.Base döndürmelidir (Shell activate/selectTab/
     * currentTab çağırır). parent verilmezse sayfa kökte "Sistem"den önce durur; yol gösterimi ve ağaç sekmeleri
     * kendiliğinden gelir. icon: ağaçtaki metin simgesi (ui.Shell ICON gibi tek karakter). id çekirdek sayfalarla
     * çakışmamalı (çakışan yok sayılır). init() içinde yalnız enabled(ad) ise çağrılmalı.
     */
    addPage(spec) {
      this.__pages.push(spec);
    },

    /**
     * Wi-Fi Monitör ▸ Güvenilir listesi penceresine düğme ekler (ui.devices.WifimonFixedDialog): {label, hint?, run(rows)}.
     * run, işaretli kayıtlarla çağrılır — [{id, kind, value, label, device_id, device_name}] (kind: bssid erişim noktası,
     * probe Wi-Fi cihazı) — ve Promise döndürebilir. İşaret yoksa düğme uyarır, run çağrılmaz.
     */
    addWifiTrustedAction(spec) {
      this.__wifiTrustedActions.push(spec);
    },

    /** @return {Array} eklentilerin güvenilir listesi düğmeleri (bkz. addWifiTrustedAction). */
    wifiTrustedActions() {
      return this.__wifiTrustedActions;
    },

    /**
     * Bir eklenti Sistem ▸ Disk kullanımı sayfasına kendi verisi için sekme ekler (Özet dilimi ve sol ağaç alt seçeneği
     * de kendiliğinden gelir). make() her çağrıda YENİ bir sekme tanımı döndürür — ui.DiskUsage.specs() biçiminde:
     * {mode, label, noun, columns, size(), load(), remove(row), lastDisk(), help?(ctx), unit?} (ayrıntı: ui.DiskUsageTab,
     * ui.DiskUsageHelp). mode çekirdek sekmelerle çakışmamalı (ör. "ext-<ad>"). init() içinde yalnız eklenti etkin ve
     * kullanıcı yetkiliyse çağrılmalı.
     */
    addDiskUsageTab(make) {
      this.__diskUsageTabs.push(make);
    },

    /** @return {Array} eklentilerin Disk kullanımı sekme tanımları (hata veren eklenti atlanır). */
    diskUsageSpecs() {
      return this.__diskUsageTabs.map(make => {
        try {
          return make() || null;
        } catch (e) {
          qx.log.Logger.error(this, `Eklenti disk kullanımı sekmesi kurulamadı: ${e}`);
          return null;
        }
      }).filter(Boolean);
    },

    /**
     * Ayarlar ▸ Eklentiler'de eklentinin bölümüne ek sekme: {key, label, create()} — create bir qx widget'ı döndürür
     * (bölüm her açılışta yeniden kurulur). Ek sekmesi olan eklentinin bölümünde ilk sekme "Ayarlar" (şema formu) olur.
     * Eklenti devre dışıyken de görünmesi istenen sekme (ör. veri yönetimi) etkinlik denetimi olmadan kaydedilebilir.
     * @param name {String} eklentinin adı (ext/<ad>)
     */
    addSettingsTab(name, spec) {
      (this.__settingsTabs[name] = this.__settingsTabs[name] || []).push(spec);
    },

    /** @return {Array} eklentinin Ayarlar ▸ Eklentiler ek sekmeleri. */
    settingsTabs(name) {
      return this.__settingsTabs[name] || [];
    },

    /** @return {Array} eklentilerin kayıtlı sayfa tanımları (bkz. addPage). */
    pages() {
      return this.__pages;
    },

    /** @param name {String} kanca adı  @param handler {Function} true dönerse olay işlendi sayılır */
    on(name, handler) {
      // Eski kanca adları (terim geçişi 2026-11-12): "boards.…" → "devices.…".
      name = String(name).replace(/^boards\./, "devices.");
      (this.__handlers[name] = this.__handlers[name] || []).push(handler);
    },

    /** Eklentinin kanca yanıtları değişti: CHANGED mesajını dinleyenler ilgili kancaları yeniden sorar. */
    changed() {
      qx.event.message.Bus.dispatchByName(this.CHANGED);
    },

    /** @return {Boolean} bir işleyici olayı üstlendi mi */
    handle(name, ...args) {
      return (this.__handlers[name] || []).some(handler => {
        try {
          return handler(...args) === true;
        } catch (e) {
          qx.log.Logger.error(this, `Eklenti kancası hata verdi: ${name}: ${e}`);
          return false;
        }
      });
    }
  }
});
