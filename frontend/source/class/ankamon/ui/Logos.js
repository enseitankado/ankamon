/**
 * Ankamon logo adayları (yatay: simge + "ANKAMON" yazısı, satır içi SVG). Hepsinde anka kuşu var (yeniden
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
        name: "Anka nabzı",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(8 0) scale(.75)" }) +
          `<path d="M2 54h14l4-8 5 14 5-11 3 5h29" fill="none" stroke="#0ea5e9" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
        text: { weight: 700, spacing: 3, tagline: "akıllı tahta izleme" }
      },
      {
        name: "Anka radarı",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<circle cx="32" cy="33" r="29" fill="none" stroke="#0d9488" stroke-width="2.5"/>` +
          `<circle cx="32" cy="33" r="19" fill="none" stroke="#0d9488" stroke-width="1.8" opacity=".55"/>` +
          `<path d="M32 33L54 14" stroke="#14b8a6" stroke-width="2" opacity=".8"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(12 9) scale(.62)" }),
        text: { weight: 700, spacing: 2, accent: "#0d9488", split: 4 }
      },
      {
        name: "Anka kalkanı",
        defs: g => `<linearGradient id="${g("s")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient>` +
          ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<path d="M32 2L58 11v20c0 16-11 26-26 31C17 57 6 47 6 31V11z" fill="url(#${g("s")})"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(12 9) scale(.62)" }),
        text: { weight: 800, spacing: 1 }
      },
      {
        name: "Ağdaki anka",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => {
          const pts = [[4, 8], [60, 8], [4, 30], [60, 30], [20, 60], [44, 60]];
          return pts.map(([x, y]) => `<path d="M32 30L${x} ${y}" stroke="#6366f1" stroke-width="1.6" opacity=".55"/>`).join("") +
            pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.4" fill="#6366f1"/>`).join("") +
            ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(11 6) scale(.66)" });
        },
        text: { weight: 600, spacing: 4, accent: "#6366f1", split: 4 }
      },
      {
        name: "Alev çemberi",
        defs: g => `<linearGradient id="${g("r")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#facc15"/><stop offset="1" stop-color="#dc2626"/></linearGradient>` +
          ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<circle cx="32" cy="32" r="28.5" fill="none" stroke="url(#${g("r")})" stroke-width="5"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(11 7) scale(.66)" }),
        text: { weight: 500, spacing: 5 }
      },
      {
        name: "Gözcü anka",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<path d="M2 44C14 30 50 30 62 44C50 58 14 58 2 44Z" fill="none" stroke="#0f766e" stroke-width="3"/>` +
          `<circle cx="32" cy="44" r="7" fill="#0f766e"/><circle cx="32" cy="44" r="2.6" fill="#fff"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(14 -2) scale(.56)" }),
        text: { weight: 700, spacing: 2, tagline: "gözü her tahtada" }
      },
      {
        name: "Anka paneli",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="2" y="6" width="60" height="52" rx="6" fill="none" stroke="#334155" stroke-width="3"/>` +
          `<path d="M2 17h60" stroke="#334155" stroke-width="3"/>` +
          [9, 15, 21].map((x, i) => `<circle cx="${x}" cy="11.5" r="2" fill="${["#ef4444", "#f59e0b", "#22c55e"][i]}"/>`).join("") +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(15 19) scale(.53)" }),
        text: { weight: 800, spacing: 2 }
      },
      {
        name: "Piksel anka",
        defs: () => "",
        icon: () => {
          const rows = ["......##......", "#.....##.....#", "##....##....##", ".###.####.###.", "..##########..",
            "...########...", ".....####.....", ".....####.....", "......##......", ".....####.....",
            "....##..##....", "...#..##..#...", "......##......"];
          const colors = ["#fde047", "#fde047", "#facc15", "#fbbf24", "#f59e0b", "#f97316", "#f97316", "#ea580c",
            "#ea580c", "#dc2626", "#dc2626", "#b91c1c", "#b91c1c"];
          let out = "";
          rows.forEach((row, y) => [...row].forEach((c, x) => {
            if (c === "#") {
              out += `<rect x="${4 + x * 4}" y="${5 + y * 4.4}" width="3.4" height="3.8" rx=".6" fill="${colors[y]}"/>`;
            }
          }));
          return out;
        },
        text: { weight: 700, spacing: 3, mono: true }
      },
      {
        name: "Sinyal veren anka",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => ["M18 12a20 20 0 0 1 28 0", "M23 17a13 13 0 0 1 18 0"]
          .map(d => `<path d="${d}" fill="none" stroke="#0ea5e9" stroke-width="3" stroke-linecap="round"/>`).join("") +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(10 14) scale(.68)" }),
        text: { weight: 700, spacing: 2, accent: "#0284c7", split: 4 }
      },
      {
        name: "Yükselen grafik",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => [[4, 46, 14], [14, 40, 20], [24, 33, 27]].map(([x, y, h]) =>
          `<rect x="${x}" y="${y}" width="7" height="${h}" rx="1.5" fill="#10b981"/>`).join("") +
          `<path d="M2 60h60" stroke="#10b981" stroke-width="2.5" stroke-linecap="round"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(25 1) scale(.58)" }),
        text: { weight: 800, spacing: 2, tagline: "tahta yönetim merkezi" }
      },
      {
        name: "Devre anka",
        defs: g => `<linearGradient id="${g("c")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#2563eb"/></linearGradient>`,
        icon: g => ankamon.ui.Logos.__bird("none", { stroke: `url(#${g("c")})`, width: 2.4 }) +
          ["M10 40H2", "M54 40h8", "M24 58v5", "M40 58v5"]
            .map(d => `<path d="${d}" stroke="url(#${g("c")})" stroke-width="2.4" stroke-linecap="round"/>`).join("") +
          [[2, 40], [62, 40], [24, 63], [40, 63]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="#2563eb"/>`).join(""),
        text: { weight: 600, spacing: 4, accent: "#2563eb", split: 4 }
      },
      {
        name: "Altıgen rozet",
        defs: g => `<linearGradient id="${g("h")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c2d12"/><stop offset="1" stop-color="#b91c1c"/></linearGradient>`,
        icon: g => `<path d="M32 1L59 16.5v31L32 63 5 47.5v-31z" fill="url(#${g("h")})"/>` +
          ankamon.ui.Logos.__bird("#fde68a", { transform: "translate(11.5 9) scale(.64)" }),
        text: { weight: 800, spacing: 3 }
      },
      {
        name: "Çizgi anka",
        defs: () => "",
        icon: () => ankamon.ui.Logos.__bird("none", { stroke: "#ea580c", width: 2.2 }),
        text: { weight: 300, spacing: 6 }
      },
      {
        name: "Küllerinden doğuş",
        defs: g => ankamon.ui.Logos.__flame(g("f")) +
          `<linearGradient id="${g("b")}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#dc2626"/><stop offset="1" stop-color="#facc15" stop-opacity="0"/></linearGradient>`,
        icon: g => `<path d="M8 62C10 50 18 46 22 40c0 7 4 9 6 12 1-6 3-10 4-14 1 4 3 8 4 14 2-3 6-5 6-12 4 6 12 10 14 22z" fill="url(#${g("b")})"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(12 -1) scale(.62)" }),
        text: { weight: 700, spacing: 2, accent: "#dc2626", split: 4 }
      },
      {
        name: "Tahtadan doğan anka",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="2" y="30" width="60" height="30" rx="3" fill="#f8fafc" stroke="#334155" stroke-width="2.5"/>` +
          `<path d="M9 40h18M9 47h26M9 54h14" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(30 2) scale(.5)" }),
        text: { weight: 700, spacing: 2, tagline: "akıllı tahta yönetimi" }
      },
      {
        name: "Gece rozeti",
        defs: g => `<radialGradient id="${g("n")}" cx=".5" cy=".35"><stop offset="0" stop-color="#312e81"/><stop offset="1" stop-color="#0f172a"/></radialGradient>` +
          `<linearGradient id="${g("o")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>`,
        icon: g => `<circle cx="32" cy="32" r="31" fill="url(#${g("n")})"/>` +
          [[12, 14], [52, 18], [10, 44], [55, 46]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="#fff" opacity=".8"/>`).join("") +
          ankamon.ui.Logos.__bird(`url(#${g("o")})`, { transform: "translate(11 8) scale(.66)" }),
        text: { weight: 600, spacing: 4 }
      },
      {
        name: "A kanatlı anka",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<path d="M6 62L32 4l26 58" fill="none" stroke="#1e40af" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<path d="M18 44h28" stroke="#1e40af" stroke-width="4" stroke-linecap="round"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(18 10) scale(.44)" }),
        text: { weight: 800, spacing: 1, accent: "#1e40af", split: 1 }
      },
      {
        name: "Kontrol panosu",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => `<rect x="2" y="4" width="28" height="27" rx="5" fill="#ffedd5"/>` +
          ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(2.5 4) scale(.42)" }) +
          `<rect x="34" y="4" width="28" height="27" rx="5" fill="#dbeafe"/><path d="M39 22l5-6 5 4 7-9" fill="none" stroke="#2563eb" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<rect x="2" y="35" width="28" height="27" rx="5" fill="#dcfce7"/><circle cx="16" cy="48.5" r="7" fill="none" stroke="#16a34a" stroke-width="3" stroke-dasharray="30 44" transform="rotate(-90 16 48.5)"/>` +
          `<rect x="34" y="35" width="28" height="27" rx="5" fill="#fee2e2"/><path d="M41 49h14M41 43h9M41 55h11" stroke="#dc2626" stroke-width="2.6" stroke-linecap="round"/>`,
        text: { weight: 700, spacing: 2, accent: "#ea580c", split: 4 }
      },
      {
        name: "Yansıtan anka",
        defs: g => ankamon.ui.Logos.__flame(g("f")),
        icon: g => ankamon.ui.Logos.__bird(`url(#${g("f")})`, { transform: "translate(-2 6) scale(.62)" }) +
          ["M42 22a12 12 0 0 1 0 22", "M48 15a22 22 0 0 1 0 36", "M54 8a32 32 0 0 1 0 50"]
            .map((d, i) => `<path d="${d}" fill="none" stroke="#8b5cf6" stroke-width="3" stroke-linecap="round" opacity="${1 - i * .25}"/>`).join(""),
        text: { weight: 700, spacing: 3, tagline: "izle · yönet · yansıt" }
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
