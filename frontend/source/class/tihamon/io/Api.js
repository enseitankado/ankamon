/**
 * REST API istemcisi. Oturum çerezle taşınır; her istek X-Requested-With başlığı gönderir
 * (sunucu, çerezli isteklerde siteler arası sahteciliğe karşı bunu arar).
 */
qx.Class.define("tihamon.io.Api", {
  type: "static",

  statics: {
    /** Oturum düştüğünde bu ad ile mesaj yayınlanır; Application giriş ekranına döner. */
    UNAUTHORIZED: "tihamon.unauthorized",

    /** Durum koduna göre, sunucu gövde göndermediğinde kullanılan açıklama. */
    STATUS_TEXT: {
      0: "Sunucuya ulaşılamıyor (ağ bağlantısı yok ya da sunucu kapalı/yeniden başlıyor).",
      500: "Sunucuda beklenmeyen bir hata oluştu (500).",
      502: "API hizmetine bağlanılamadı (502) — sunucu yeni başlıyor ya da yeniden başlıyor olabilir.",
      503: "Hizmet geçici olarak kullanılamıyor (503).",
      504: "Sunucu zamanında yanıt vermedi (504)."
    },

    // Geçici (sunucu başlatılırken tipik) hatalar: okuma (GET) istekleri bu aralıklarla (ms) yeniden denenir.
    RETRY_STATUS: [0, 502, 503, 504],
    RETRY_DELAYS: [1000, 2000, 3000],

    /**
     * Fırlatılan hata (Error): message (kısa açıklama) + status, method, path, time ve details
     * (sunucunun "detail"i, istek, arka uç ve zaman — bkz. ui.Dialog.error).
     */
    async request(method, path, body) {
      const options = {
        method,
        credentials: "same-origin",
        headers: { "X-Requested-With": "tihamon" }
      };
      if (body !== undefined) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }

      // Yalnız GET yeniden denenir: değiştiren istekler (POST/PUT/DELETE) iki kez uygulanmasın.
      const delays = method === "GET" ? this.RETRY_DELAYS : [];
      for (let attempt = 0; ; attempt++) {
        let response = null;
        let data = null;
        let text = "";
        try {
          response = await fetch("/api" + path, options);
          text = await response.text();
          try {
            data = text ? JSON.parse(text) : null;
          } catch (e) {
            data = null;
          }
        } catch (e) {
          response = null;
        }
        if (response && response.ok) {
          return data;
        }
        const status = response ? response.status : 0;
        if (attempt < delays.length && this.RETRY_STATUS.includes(status)) {
          await new Promise(resolve => setTimeout(resolve, delays[attempt]));
          continue;
        }
        const error = this.__error(method, path, status, data, text, attempt);
        if (status === 401 && !path.startsWith("/auth/")) {
          qx.event.message.Bus.dispatchByName(this.UNAUTHORIZED);
        }
        throw error;
      }
    },

    __error(method, path, status, data, text, retries) {
      const message = (data && data.error) || this.STATUS_TEXT[status] || `Sunucu hatası (${status}).`;
      const error = new Error(message);
      error.status = status;
      error.method = method;
      error.path = path;
      error.time = new Date();
      // 4xx: kullanıcıya yönelik, sunucunun kendi açıklaması yeterli. Diğerlerinde tanı ayrıntısı eklenir.
      if (status === 0 || status >= 500) {
        const lines = [];
        if (data && data.detail) {
          lines.push(data.detail);
        } else if (text && !data) {
          // JSON olmayan gövde (ör. vekilin HTML sayfası): etiketsiz ilk anlamlı metin.
          const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
          if (plain) {
            lines.push("Sunucu yanıtı: " + plain);
          }
        }
        lines.push(`İstek: ${method} /api${path}`);
        lines.push(`Durum: ${status || "bağlantı yok"}` + (retries ? ` (${retries} kez yeniden denendi)` : ""));
        if (data && data.upstream) {
          lines.push(`Arka uç: ${data.upstream}` + (data.upstream_status ? ` (${data.upstream_status})` : ""));
        }
        lines.push(`Zaman: ${tihamon.util.Format.dateTime(error.time.getTime())}`);
        error.details = lines;
      }
      return error;
    },

    get(path, query) {
      const pairs = Object.entries(query || {}).filter(pair => pair[1] !== null && pair[1] !== undefined && pair[1] !== "");
      const search = pairs.length ? "?" + new URLSearchParams(pairs).toString() : "";
      return this.request("GET", path + search);
    },

    post(path, body) {
      return this.request("POST", path, body || {});
    },

    patch(path, body) {
      return this.request("PATCH", path, body);
    },

    put(path, body) {
      return this.request("PUT", path, body);
    },

    /** @param body {Object?} toplu silme gibi durumlarda (ör. /board-sessions) gövdeyle kimlik listesi gönderilir. */
    del(path, body) {
      return this.request("DELETE", path, body);
    }
  }
});
