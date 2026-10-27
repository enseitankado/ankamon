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
 * ville.Fluent (sqville, MIT) üzerinden başka masaüstü görünümleri türetir (macOS, GNOME Adwaita, Ubuntu
 * Yaru — kullanıcı isteği; hazır bir qooxdoo macOS/Linux teması yok, 2026-10 araması). Fluent'in yüzlerce
 * renk anahtarı tek bir vurgu rampasından (ville.global.color.Brand[10…160], 80 = ana renk) üretildiği için
 * burada aynı yapıda yeni bir rampa hesaplanır ve Fluent paletindeki eski rampa değerleri birebir
 * değiştirilir; yazı tiplerinde yalnız aile değiştirilir. Görünüm (appearance) ve süsleme Fluent'inkidir.
 */
qx.Class.define("ankamon.theme.Derive", {
  type: "static",

  statics: {
    /** "#rrggbb" iki renk arasında t (0…1) oranında karışım. */
    __mix(a, b, t) {
      const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
      const [x, y] = [p(a), p(b)];
      return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
    },

    /** Vurgu renginden Fluent'in Brand rampasıyla aynı anahtarlara (10…160) sahip rampa. */
    ramp(accent) {
      const out = {};
      for (let i = 10; i <= 160; i += 10) {
        out[i] = i < 80 ? this.__mix(accent, "#000000", (80 - i) / 80 * 0.85)
          : i > 80 ? this.__mix(accent, "#ffffff", (i - 80) / 80 * 0.93) : accent;
      }
      return out;
    },

    /**
     * Fluent renk temasının (miras alınanlar dahil) bütün renkleri; Brand rampasının değerleri yeni
     * vurgu rampasıyla değiştirilmiş, `extra` (app-* takma adları vb.) üstüne yazılmış.
     * @param base {qx.Theme} ville.theme.fluent.Brand1 ya da Brand1Dark
     */
    colors(base, accent, extra) {
      const old = ville.global.color.Brand;
      const ramp = this.ramp(accent);
      const map = {};
      for (let i = 10; i <= 160; i += 10) {
        map[String(old[i]).toLowerCase()] = ramp[i];
      }
      const out = {};
      for (const key in base.colors) {
        const v = base.colors[key];
        out[key] = (typeof v === "string" && map[v.toLowerCase()]) || v;
      }
      return Object.assign(out, extra);
    },

    /**
     * Fluent yazı tipleri (+ Ankamon'un app-* yazı tipleri) — eş aralıklı olanlar hariç aile değiştirilmiş.
     * @param base {qx.Theme} ankamon.theme.FontFluent
     */
    fonts(base, family, mono) {
      const out = {};
      for (const key in base.fonts) {
        const f = base.fonts[key];
        const isMono = /mono|consol|courier/i.test(String(f.family));
        out[key] = Object.assign({}, f, { family: isMono ? mono : family });
      }
      return out;
    }
  }
});
