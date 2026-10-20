/**
 * Eklenti noktaları. Eklentiler public depoda DEĞİL, ext/<ad>/ altında ayrı (ör. private) depolarda durur
 * (bkz. ext/README.md); bu dosya yalnız genel kancaları tanımlar, hiçbir eklentiyi adıyla bilmez.
 *
 * Derleme (Dockerfile "frontend" aşaması, frontend/ext-libs.js) ext/<ad>/frontend'i qooxdoo kütüphanesi
 * olarak ekler ve "tihamonext.*" sınıflarını pakete katar. Oturum açılınca start() her
 * "tihamonext.<ad>.Extension" sınıfının statik init(context) metodunu bir kez çağırır. Eklenti yoksa
 * hiçbir şey olmaz.
 *
 * Kancalar: on(ad, işleyici) ile kaydolunur; çekirdek handle(ad, ...) ile sorar. İşleyicilerden biri true
 * döndürürse olay "işlendi" sayılır ve çekirdek kendi varsayılan davranışını atlar. Kancalar:
 *  - "boards.statusFilter" (metin, sayfa): Tahtalar grid'inin Durum süzgeç kutusuna yazılan metin.
 *    İşlendi ise kutu temizlenir, süzme yapılmaz.
 */
qx.Class.define("tihamon.ext.Extensions", {
  type: "static",

  statics: {
    __handlers: {},
    __started: false,

    /**
     * Oturum açıldığında bir kez (bkz. tihamon.Application). Bir eklentinin hatası ötekileri ve
     * uygulamayı durdurmaz.
     * @param context {Map} { user, app }
     */
    start(context) {
      if (this.__started) {
        return;
      }
      this.__started = true;
      Object.keys(qx.Class.$$registry)
        .filter(name => /^tihamonext\.[A-Za-z0-9_]+\.Extension$/.test(name))
        .forEach(name => {
          try {
            qx.Class.getByName(name).init(context);
          } catch (e) {
            qx.log.Logger.error(this, `Eklenti başlatılamadı: ${name}: ${e}`);
          }
        });
    },

    /** @param name {String} kanca adı  @param handler {Function} true dönerse olay işlendi sayılır */
    on(name, handler) {
      (this.__handlers[name] = this.__handlers[name] || []).push(handler);
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
