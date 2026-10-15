/**
 * Dosya gezgini servisinin (worker/tihamon/files — nginx /files-api/) istemcisi. Oturum çerezle
 * taşınır; POST'larda ana API ile aynı X-Requested-With başlığı (servis bunu arar).
 */
qx.Class.define("tihamon.ui.files.Api", {
  type: "static",

  statics: {
    async request(method, path, body) {
      const options = { method, credentials: "same-origin", headers: { "X-Requested-With": "tihamon" } };
      if (body !== undefined) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }
      let response;
      try {
        response = await fetch("/files-api" + path, options);
      } catch (e) {
        throw new Error("Sunucuya ulaşılamıyor.");
      }
      const data = await response.json().catch(() => null);
      if (response.ok) {
        return data;
      }
      if (response.status === 401) {
        qx.event.message.Bus.dispatchByName(tihamon.io.Api.UNAUTHORIZED);
      }
      throw new Error((data && data.error) ||
        (response.status === 403 ? "Bu işlem için dosya yöneticisi yetkiniz yok." : `Sunucu hatası (${response.status})`));
    },

    list(board, path) {
      return this.request("GET", "/list?" + new URLSearchParams({ board, path }).toString());
    },

    post(path, body) {
      return this.request("POST", path, body);
    }
  }
});
