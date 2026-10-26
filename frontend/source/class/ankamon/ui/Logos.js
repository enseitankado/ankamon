/**
 * Ankamon logo adayları (yatay: simge + "ANKAMON" yazısı, satır içi SVG). Kullanıcı 1 ve 16'yı (anka +
 * bilgisayar/tahta) beğendi; liste o yönde: ilk ikisi onlar, ardından aynı temada varyasyonlar. Hepsinde anka kuşu var (yeniden
 * doğuş / süreklilik) ve yazılımın işini çağrıştıran bir öğe: akıllı tahta ekranı, izleme (nabız, radar,
 * gözcü), ağ, yönetim (kalkan, pano), yansıtma.
 * Yazı currentColor'dan rengini alır (açık/koyu temalarda okunur); simgeler kendi renklerini taşır, koyu
 * zeminde de seçilsin diye doygun tonlar ya da kendi zemini olan rozetler kullanılır.
 * Aynı sayfada birden çok logo çizildiğinde degrade kimlikleri çakışmasın diye her çizim ön ek alır (g()).
 */
qx.Class.define("ankamon.ui.Logos", {
  type: "static",

  statics: {
    FONT: "Inter, 'Segoe UI', Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif",

    /** Alev degradesi (sarı → turuncu → kırmızı), yukarıdan aşağı. */
    __flame(id, light) {
      return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${light || "#fde047"}"/><stop offset=".5" stop-color="#f97316"/>` +
        `<stop offset="1" stop-color="#dc2626"/></linearGradient>`;
    },

    /**
     * Önden, kanatları açık yükselen anka (64×64 alanda, ortası x=32). fill: dolgu (ör. "url(#..)");
     * opts.stroke verilirse yalnız çizgi (dolgusuz) çizilir. transform ile konum/ölçek verilebilir.
     */
    __bird(fill, opts = {}) {
      const mirror = d => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => `${64 - Number(x)} ${y}`);
      const wing = "M30 27 C24 22 14 14 5 8 C8 14 10 17 14 20 C10 20 7 19 4 18 C8 23 12 25 17 26 " +
        "C14 27 11 27 8 27 C13 31 21 33 29 32 Z";
      const body = "M32 15 C35 15 36 19 35 24 C34 31 34 36 32 41 C30 36 30 31 29 24 C28 19 29 15 32 15 Z";
      const crest = "M32 11 C31 7 33 4 36 3 C35 6 36 8 34 11 Z";
      const tail = "M32 39 C29 45 26 50 23 57 C27 54 29 52 30.5 50 C30.5 55 31.5 59 32 63 C32.5 59 33.5 55 33.5 50 " +
        "C35 52 37 54 41 57 C38 50 35 45 32 39 Z";
      const paint = opts.stroke
        ? `fill="none" stroke="${opts.stroke}" stroke-width="${opts.width || 2}" stroke-linejoin="round"`
        : `fill="${fill}"`;
      const head = opts.stroke
        ? `<circle cx="32" cy="13" r="3" ${paint}/>`
        : `<circle cx="32" cy="13" r="3.2" fill="${fill}"/>`;
      return `<g${opts.transform ? ` transform="${opts.transform}"` : ""}>` +
        [wing, mirror(wing), body, crest, tail].map(d => `<path d="${d}" ${paint}/>`).join("") + head +
        (opts.eye ? `<circle cx="33" cy="12.6" r="0.9" fill="${opts.eye}"/>` : "") + "</g>";
    },

    /** Adaylar: ad + simge (64×64 alanda) + yazı biçimi. g(ad) degrade kimliğini ön ekler. */
    LIST: [
      {
        name: "Anka ve akıllı tahta",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="3" y="20" width="58" height="34" rx="4" fill="none" stroke="#2563eb" stroke-width="3"/>` +
          `<path d="M26 60h12M32 54v6" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(13 0) scale(.6)" }),
        text: { weight: 800, spacing: 2, accent: "#ea580c", split: 4 }
      },
      {
        name: "Tahtadan doğan anka",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="2" y="30" width="60" height="30" rx="3" fill="#f8fafc" stroke="#64748b" stroke-width="2.5"/>` +
          `<path d="M9 40h18M9 47h26M9 54h14" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(30 2) scale(.5)" }),
        text: { weight: 700, spacing: 2, tagline: "akıllı tahta yönetimi" }
      },
      {
        name: "Ayaklı sınıf tahtası",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<path d="M14 44L8 62M50 44l6 18M32 44v8" stroke="#64748b" stroke-width="3" stroke-linecap="round"/>` +
          `<rect x="4" y="8" width="56" height="36" rx="3" fill="#f8fafc" stroke="#2563eb" stroke-width="3"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(17.5 9) scale(.46)" }),
        text: { weight: 800, spacing: 2, accent: "#2563eb", split: 4 }
      },
      {
        name: "Ekrandan yükselen anka",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="6" y="30" width="52" height="26" rx="3" fill="none" stroke="#2563eb" stroke-width="3"/>` +
          `<path d="M24 62h16M32 56v6" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(9.5 -1) scale(.7)" }),
        text: { weight: 800, spacing: 2, accent: "#ea580c", split: 4 }
      },
      {
        name: "Nabızlı ekran",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="3" y="4" width="58" height="42" rx="4" fill="#1e3a8a"/>` +
          `<path d="M8 36h11l3-6 4 10 4-8 3 4h23" fill="none" stroke="#22d3ee" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(20 4) scale(.38)" }) +
          `<path d="M24 60h16M32 46v14" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>`,
        text: { weight: 700, spacing: 3, tagline: "akıllı tahta izleme" }
      },
      {
        name: "Çift ekran",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => [2, 34].map(x => `<rect x="${x}" y="30" width="28" height="20" rx="2.5" fill="none" stroke="#2563eb" stroke-width="2.6"/>` +
          `<path d="M${x + 9} 58h10M${x + 14} 50v8" stroke="#2563eb" stroke-width="2.6" stroke-linecap="round"/>`).join("") +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(16 -1) scale(.5)" }),
        text: { weight: 800, spacing: 2 }
      },
      {
        name: "Dizüstü",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="10" y="12" width="44" height="32" rx="2.5" fill="none" stroke="#2563eb" stroke-width="3"/>` +
          `<path d="M3 50h58l-5 7H8z" fill="#2563eb"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(19 13) scale(.41)" }),
        text: { weight: 700, spacing: 2, accent: "#ea580c", split: 4 }
      },
      {
        name: "Etkileşimli tahta",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="2" y="10" width="60" height="38" rx="3" fill="#f8fafc" stroke="#64748b" stroke-width="3"/>` +
          `<rect x="6" y="14" width="52" height="30" rx="1.5" fill="#dbeafe"/>` +
          `<rect x="18" y="52" width="28" height="4" rx="2" fill="#64748b"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(18 14) scale(.44)" }) +
          `<circle cx="49" cy="37" r="3" fill="none" stroke="#2563eb" stroke-width="1.6"/><circle cx="49" cy="37" r="1" fill="#2563eb"/>`,
        text: { weight: 800, spacing: 2, tagline: "etkileşimli tahta yönetimi" }
      },
      {
        name: "Tahta filosu",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => [2, 24, 46].map(x => `<path d="M32 30L${x + 8} 46" stroke="#94a3b8" stroke-width="1.6" stroke-dasharray="3 2.5"/>` +
          `<rect x="${x}" y="46" width="16" height="12" rx="2" fill="#2563eb"/><rect x="${x + 2.5}" y="48.5" width="11" height="7" rx="1" fill="#bfdbfe"/>`).join("") +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(15 -2) scale(.53)" }),
        text: { weight: 700, spacing: 3, accent: "#2563eb", split: 4 }
      },
      {
        name: "Onaylı ekran",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="3" y="8" width="54" height="36" rx="4" fill="none" stroke="#2563eb" stroke-width="3"/>` +
          `<path d="M22 58h16M30 44v14" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(15 9) scale(.47)" }) +
          `<circle cx="52" cy="46" r="10" fill="#16a34a"/><path d="M47 46l3.5 3.5L57 43" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
        text: { weight: 800, spacing: 2, accent: "#16a34a", split: 4 }
      },
      {
        name: "Uygulama simgesi",
        defs: g => `<linearGradient id="${g("b")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#4f46e5"/></linearGradient>` + ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="2" y="2" width="60" height="60" rx="14" fill="url(#${g("b")})"/>` +
          `<rect x="11" y="17" width="42" height="28" rx="3" fill="#eff6ff"/><path d="M26 52h12M32 45v7" stroke="#eff6ff" stroke-width="3" stroke-linecap="round"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(19 17) scale(.41)" }),
        text: { weight: 800, spacing: 2 }
      },
      {
        name: "Çizgi ekran",
        defs: () => "",
        icon: () => `<rect x="3" y="16" width="58" height="36" rx="4" fill="none" stroke="#ea580c" stroke-width="2.4"/>` +
          `<path d="M24 60h16M32 52v8" stroke="#ea580c" stroke-width="2.4" stroke-linecap="round"/>` +
          ankamon.ui.Logos.__bird("none", { stroke: "#ea580c", width: 3.4, transform: "translate(13 2) scale(.6)" }),
        text: { weight: 300, spacing: 6 }
      },
      {
        name: "Kanatlı ekran",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(-0.8 -0.5) scale(1.025)" }) +
          `<rect x="15" y="20" width="34" height="24" rx="3" fill="#eff6ff" stroke="#2563eb" stroke-width="3"/>` +
          `<path d="M20 34h6l2-4 3 8 3-6 2 2h8" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
        text: { weight: 800, spacing: 2, accent: "#ea580c", split: 4 }
      },
      {
        name: "Tahtaya çizilen anka",
        defs: () => "",
        icon: () => `<rect x="2" y="8" width="56" height="40" rx="3" fill="#f8fafc" stroke="#64748b" stroke-width="3"/>` +
          ankamon.ui.Logos.__bird("none", { stroke: "#ea580c", width: 3.6, transform: "translate(12 9) scale(.5)" }) +
          `<g transform="rotate(-38 52 50)"><rect x="44" y="47" width="18" height="6" rx="1.5" fill="#2563eb"/><path d="M62 47l5 3-5 3z" fill="#1e3a8a"/></g>`,
        text: { weight: 700, spacing: 2, tagline: "akıllı tahta yönetimi" }
      },
      {
        name: "Masaüstü bilgisayar",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="2" y="10" width="44" height="32" rx="3" fill="none" stroke="#2563eb" stroke-width="3"/>` +
          `<path d="M16 56h16M24 42v14" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>` +
          `<rect x="50" y="18" width="12" height="38" rx="2" fill="#2563eb"/><circle cx="56" cy="24" r="1.8" fill="#bfdbfe"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(10 11) scale(.44)" }),
        text: { weight: 800, spacing: 2 }
      },
      {
        name: "Gece ekranı",
        defs: g => `<linearGradient id="${g("o")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>`,
        icon: g => `<rect x="3" y="6" width="58" height="40" rx="4" fill="#0f172a" stroke="#3b82f6" stroke-width="2.5"/>` +
          [[10, 13], [53, 15], [12, 38], [52, 39]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#fff" opacity=".8"/>`).join("") +
          ankamon.ui.Logos.__bird(`url(#${g("o")})`, { transform: "translate(17.5 8) scale(.45)" }) +
          `<path d="M24 60h16M32 46v14" stroke="#3b82f6" stroke-width="3" stroke-linecap="round"/>`,
        text: { weight: 600, spacing: 4 }
      }
    ],

    /** n. logonun (0 tabanlı) SVG'si; height piksel yüksekliği, en/boy oranı korunur. */
    svg(n, height) {
      const S = ankamon.ui.Logos;
      const L = S.LIST[n];
      const p = "lg" + n + "_" + (S.__seq++) + "_";
      const g = id => p + id;
      const t = L.text;
      const split = t.split || 4;
      const word = t.accent
        ? `<tspan fill="${t.accent}">${"ANKAMON".slice(0, split)}</tspan><tspan fill="currentColor">${"ANKAMON".slice(split)}</tspan>`
        : "ANKAMON";
      const y = t.tagline ? 36 : 43;
      const tag = t.tagline
        ? `<text x="78" y="54" font-family="${S.FONT}" font-size="11.5" letter-spacing="1" fill="currentColor" opacity=".6">${t.tagline}</text>`
        : "";
      const font = t.mono ? "ui-monospace, 'DejaVu Sans Mono', Consolas, monospace" : S.FONT;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 64" height="${height}" width="${Math.round(height * 250 / 64)}" role="img" aria-label="Ankamon">` +
        `<defs>${L.defs(g)}</defs>${L.icon(g)}` +
        `<text x="76" y="${y}" font-family="${font}" font-size="27" font-weight="${t.weight}" letter-spacing="${t.spacing}" fill="currentColor">${word}</text>` +
        tag + "</svg>";
    },

    __seq: 0
  }
});
