/**
 * Ankamon logosu ("Ekrandan yükselen anka": ekrandan kanatlarını açıp yükselen alev renkli anka kuşu),
 * satır içi SVG — resim dosyası yok (derlenmiş build'deki resim URL sorunu).
 * svg(): yatay logo (simge + "ANKAMON" yazısı; giriş ekranı), icon(): yalnız simge (panel başlığı).
 * "MON" ve isteğe bağlı ekran çerçevesi currentColor'dan rengini alır (açık/koyu zeminde okunur).
 * Aynı sayfada birden çok çizimde degrade kimlikleri çakışmasın diye her çizim ön ek alır.
 */
qx.Class.define("ankamon.ui.Logo", {
  type: "static",

  statics: {
    FONT: "Inter, 'Segoe UI', Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif",
    /** Ekran çerçevesinin özgün rengi. */
    FRAME: "#2563eb",

    /** Alev degradesi (sarı → turuncu → kırmızı), yukarıdan aşağı. */
    __flame(id) {
      return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#fde047"/><stop offset=".5" stop-color="#f97316"/>` +
        `<stop offset="1" stop-color="#dc2626"/></linearGradient>`;
    },

    /** Önden, kanatları açık yükselen anka (64×64 alanda, ortası x=32). */
    __bird(fill, transform) {
      const mirror = d => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => `${64 - Number(x)} ${y}`);
      const wing = "M30 27 C24 22 14 14 5 8 C8 14 10 17 14 20 C10 20 7 19 4 18 C8 23 12 25 17 26 " +
        "C14 27 11 27 8 27 C13 31 21 33 29 32 Z";
      const body = "M32 15 C35 15 36 19 35 24 C34 31 34 36 32 41 C30 36 30 31 29 24 C28 19 29 15 32 15 Z";
      const crest = "M32 11 C31 7 33 4 36 3 C35 6 36 8 34 11 Z";
      const tail = "M32 39 C29 45 26 50 23 57 C27 54 29 52 30.5 50 C30.5 55 31.5 59 32 63 C32.5 59 33.5 55 33.5 50 " +
        "C35 52 37 54 41 57 C38 50 35 45 32 39 Z";
      return `<g transform="${transform}">` +
        [wing, mirror(wing), body, crest, tail].map(d => `<path d="${d}" fill="${fill}"/>`).join("") +
        `<circle cx="32" cy="13" r="3.2" fill="${fill}"/></g>`;
    },

    /** Simgenin <defs> ve çizimi (64×64 alanda); frame: ekran çerçevesi rengi. */
    __parts(frame) {
      const S = ankamon.ui.Logo;
      const f = "lgf" + (S.__seq++);
      return {
        defs: S.__flame(f),
        body: `<rect x="6" y="30" width="52" height="26" rx="3" fill="none" stroke="${frame}" stroke-width="3"/>` +
          `<path d="M24 62h16M32 56v6" stroke="${frame}" stroke-width="3" stroke-linecap="round"/>` +
          S.__bird(`url(#${f})`, "translate(9.5 -1) scale(.7)")
      };
    },

    /** Yatay logo; height piksel yüksekliği, en/boy oranı korunur. */
    svg(height) {
      const S = ankamon.ui.Logo;
      const p = S.__parts(S.FRAME);
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 64" height="${height}" width="${Math.round(height * 250 / 64)}" role="img" aria-label="Ankamon">` +
        `<defs>${p.defs}</defs>${p.body}` +
        `<text x="76" y="43" font-family="${S.FONT}" font-size="27" font-weight="800" letter-spacing="2" fill="currentColor">` +
        `<tspan fill="#ea580c">ANKA</tspan><tspan fill="currentColor">MON</tspan></text></svg>`;
    },

    /** Yalnız simge (kare); frame verilmezse özgün mavi, "currentColor" ile zeminin yazı rengini alır. */
    icon(size, frame) {
      const S = ankamon.ui.Logo;
      const p = S.__parts(frame || S.FRAME);
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="Ankamon" style="display:block">` +
        `<defs>${p.defs}</defs>${p.body}</svg>`;
    },

    __seq: 0
  }
});
