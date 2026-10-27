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
 * Dosya gezgini servisinin (worker/ankamon/files — nginx /files-api/) istemcisi. Oturum çerezle
 * taşınır; POST'larda ana API ile aynı X-Requested-With başlığı (servis bunu arar).
 */
qx.Class.define("ankamon.ui.files.Api", {
  type: "static",

  statics: {
    async request(method, path, body) {
      const options = { method, credentials: "same-origin", headers: { "X-Requested-With": "ankamon" } };
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
        qx.event.message.Bus.dispatchByName(ankamon.io.Api.UNAUTHORIZED);
      }
      throw new Error((data && data.error) ||
        (response.status === 403 ? "Bu işlem için dosya yöneticisi yetkiniz yok." : this.describe(response.status)));
    },

    /**
     * HTTP durum kodunun anlaşılır açıklaması (kod parantez içinde kalır) — sunucu kendi Türkçe iletisini
     * göndermediğinde (nginx'in ürettiği 413/500/502/504 gibi) kullanıcı ne olduğunu anlasın.
     */
    describe(status) {
      const text = {
        0: "Sunucuya ulaşılamadı (ağ bağlantısı koptu ya da sunucu kapalı)",
        400: "İstek geçersiz",
        401: "Oturumun süresi doldu; yeniden giriş yapın",
        403: "Bu işlem için yetkiniz yok",
        404: "Bulunamadı (işin ya da yüklemenin süresi dolmuş olabilir)",
        408: "Sunucu isteğin tamamını zamanında alamadı (zaman aşımı)",
        413: "Dosya sunucunun kabul ettiği boyuttan büyük",
        500: "Sunucuda beklenmeyen bir hata oluştu (ayrıntı sunucu günlüğünde)",
        502: "Dosya servisi yanıt vermiyor (yeniden başlıyor olabilir; biraz sonra tekrar deneyin)",
        503: "Servis geçici olarak kullanılamıyor",
        504: "Sunucu zamanında yanıt vermedi (zaman aşımı)",
        507: "Sunucuda yeterli disk alanı yok"
      }[status] || "Sunucu hatası";
      return `${text} (HTTP ${status})`;
    },

    list(board, path) {
      return this.request("GET", "/list?" + new URLSearchParams({ board, path }).toString());
    },

    post(path, body) {
      return this.request("POST", path, body);
    }
  }
});
