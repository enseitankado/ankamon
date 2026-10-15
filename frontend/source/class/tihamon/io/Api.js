/**
 * REST API istemcisi. Oturum çerezle taşınır; her istek X-Requested-With başlığı gönderir
 * (sunucu, çerezli isteklerde siteler arası sahteciliğe karşı bunu arar).
 */
qx.Class.define("tihamon.io.Api", {
  type: "static",

  statics: {
    /** Oturum düştüğünde bu ad ile mesaj yayınlanır; Application giriş ekranına döner. */
    UNAUTHORIZED: "tihamon.unauthorized",

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

      let response;
      try {
        response = await fetch("/api" + path, options);
      } catch (e) {
        throw new Error("Sunucuya ulaşılamıyor.");
      }
      const data = await response.json().catch(() => null);
      if (response.ok) {
        return data;
      }

      const error = new Error((data && data.error) || `Sunucu hatası (${response.status})`);
      error.status = response.status;
      if (response.status === 401 && !path.startsWith("/auth/")) {
        qx.event.message.Bus.dispatchByName(this.UNAUTHORIZED);
      }
      throw error;
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
