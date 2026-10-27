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

    /** Bir eklenti Bakım (Tahtalar ▸ Bakım) sayfasına sekme ekler: {key, label, feature, create(user)}.
     * init() içinde yalnız enabled(ad) ise çağrılmalı. Hem sayfadaki sekme çubuğu hem sol ağaç bunu okur. */
    addMaintenanceTab(spec) {
      this.__maintenanceTabs.push(spec);
    },

    /** @return {Array} kayıtlı Bakım sekmesi tanımları ({key,label,feature,create}). */
    maintenanceTabs() {
      return this.__maintenanceTabs;
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
