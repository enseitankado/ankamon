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
 *  - "boards.statusFilter" (metin, sayfa): Tahtalar grid'inin Durum süzgeç kutusuna yazılan metin.
 *    İşlendi ise kutu temizlenir, süzme yapılmaz.
 *  - "settings.extensionHidden" (eklenti adı): Ayarlar ▸ Eklentiler listesi. İşlendi ise (true) o eklentinin
 *    bölümü gösterilmez (yalnız arayüz; API yönetici yetkisiyle yine erişilebilir).
 *  - "statusBar.usersVisible" (): alt çubuktaki oturum açmış kullanıcılar göstergesi (👤 + ipucu).
 *    Varsayılan gizli; işlendi ise (true) görünür.
 * Kanca dışındaki eklenti noktaları: addMaintenanceTab (Bakım sekmesi), addBoardMenu (Tahtalar sağ menüsü
 * maddesi ve isteğe bağlı araç çubuğu düğmesi), addPage (sol menüde eklentinin kendi sayfası).
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
    __boardMenus: [],       // eklentilerin Tahtalar sağ menüsü maddeleri (bkz. addBoardMenu)

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
     * Bir eklenti Tahtalar sağ menüsüne (grid satırı ve ekran kutucuğu — ikisi de page.Boards.__rowMenu) madde
     * ekler; araç çubuğu menüden türediği için madde çubukta da görünür (bkz. ui.boards.ActionBar). init() içinde
     * yalnız eklenti etkinse çağrılmalı.
     * @param spec {Map} {
     *   build: (board, boards, user) → qx.ui.menu.Button|null — maddeyi kurar (BoardOps.menuButton ile; null: yok).
     *     ActionBar yetkiyi sınamak için sentetik tahtayla da çağırır ({id: 0, online, label: ""}).
     *   bar: {id, label, iconSvg|icon, mirror?, primary?, sep?, single?, hint?} — isteğe bağlı araç çubuğu düğmesi;
     *     mirror maddenin etiketiyse düğmenin menüsü maddenin alt menüsünün aynısıdır.
     * }
     */
    addBoardMenu(spec) {
      this.__boardMenus.push(spec);
    },

    /** @return {Array} eklentilerin bu tahta(lar) için kurduğu sağ menü maddeleri (hata veren eklenti atlanır). */
    boardMenuItems(board, boards, user) {
      return this.__boardMenus.map(spec => {
        try {
          return spec.build(board, boards, user) || null;
        } catch (e) {
          qx.log.Logger.error(this, `Eklenti sağ menü maddesi kurulamadı: ${e}`);
          return null;
        }
      }).filter(Boolean);
    },

    /** @return {Array} eklentilerin Tahtalar araç çubuğu grupları (bkz. addBoardMenu bar). */
    boardBarGroups() {
      return this.__boardMenus.filter(spec => spec.bar).map(spec => spec.bar);
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

    /** @return {Array} eklentilerin kayıtlı sayfa tanımları (bkz. addPage). */
    pages() {
      return this.__pages;
    },

    /** @param name {String} kanca adı  @param handler {Function} true dönerse olay işlendi sayılır */
    on(name, handler) {
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
