/**
 * Görev yöneticisinin canlı bağlantısı: /screen/ws/taskmgr/<tahta> WebSocket'i (nginx "taskmgr" yetkisi →
 * ekran köprüsü → tahtaya TEK SSH + ajan; bkz. worker/tihamon/screen/taskmgr.py). Ajanın çerçeveleri olay
 * olarak yayılır; komutlar send() ile gider, yanıt (aynı id'li "res") Promise ile döner. close() / sayfanın
 * kapanması WebSocket'i kapatır → sunucu SSH'yi sonlandırır.
 */
qx.Class.define("tihamon.ui.taskmgr.Connection", {
  extend: qx.core.Object,

  events: {
    /** ajan çerçevesi: {t: "static"|"snap"|"services"|"startup"|"error", ...} */
    frame: "qx.event.type.Data",
    /** bağlantı kapandı: {code, text} */
    closed: "qx.event.type.Data",
    opened: "qx.event.type.Event"
  },

  statics: {
    CLOSE_TEXT: {
      4001: "Tahta bulunamadı ya da IP adresi yok.",
      4002: "Tahtaya SSH ile ulaşılamadı.",
      4003: "Tahta SSH girişini reddetti (Ayarlar → SSH erişimi).",
      4004: "Tahtada python3 yok — görev yöneticisi çalışamıyor.",
      4005: "Tahtadaki görev yöneticisi ajanı beklenmedik biçimde kapandı.",
      4029: "Aynı anda açık görev yöneticisi sınırına ulaşıldı.",
      1006: "Bağlantı koptu."
    }
  },

  construct(boardId) {
    super();
    this.__boardId = boardId;
    this.__pending = new Map();
  },

  members: {
    __boardId: null,
    __ws: null,
    __seq: 0,
    __pending: null,
    __closing: false,

    open() {
      this.__closing = false;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/screen/ws/taskmgr/${this.__boardId}`);
      this.__ws = ws;
      ws.onopen = () => this.fireEvent("opened");
      ws.onmessage = e => {
        let f;
        try {
          f = JSON.parse(e.data);
        } catch (err) {
          return;
        }
        if (f.t === "res") {
          const p = this.__pending.get(f.id);
          if (p) {
            this.__pending.delete(f.id);
            clearTimeout(p.timer);
            (f.ok ? p.resolve : p.reject)(f.ok ? f : new Error(f.msg || "İşlem başarısız."));
          }
          return;
        }
        this.fireDataEvent("frame", f);
      };
      ws.onclose = e => {
        if (this.__ws !== ws) {
          return;
        }
        this.__ws = null;
        this.__pending.forEach(p => {
          clearTimeout(p.timer);
          p.reject(new Error("Bağlantı kapandı."));
        });
        this.__pending.clear();
        if (!this.__closing) {
          const text = tihamon.ui.taskmgr.Connection.CLOSE_TEXT[e.code] ||
            (e.code === 1008 || e.code === 403 ? "Görev yöneticisi yetkiniz yok." : `Bağlantı kapandı (${e.code}).`);
          this.fireDataEvent("closed", { code: e.code, text });
        }
      };
    },

    isOpen() {
      return !!this.__ws && this.__ws.readyState === WebSocket.OPEN;
    },

    /** Komut gönderir; ajanın yanıtıyla çözülür (ok:false → hata). */
    send(op, args = {}) {
      if (!this.isOpen()) {
        return Promise.reject(new Error("Tahtaya bağlı değil."));
      }
      const id = ++this.__seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.__pending.delete(id);
          reject(new Error("Tahta yanıt vermedi (zaman aşımı)."));
        }, 90000);
        this.__pending.set(id, { resolve, reject, timer });
        this.__ws.send(JSON.stringify(Object.assign({ id, op }, args)));
      });
    },

    close() {
      this.__closing = true;
      if (this.__ws) {
        const ws = this.__ws;
        this.__ws = null;
        ws.close();
      }
    }
  },

  destruct() {
    this.close();
  }
});
