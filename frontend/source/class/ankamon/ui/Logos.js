/**
 * Ankamon logo adayları (yatay: simge + "ANKAMON" yazısı, satır içi SVG).
 * Fikir: Anka (anka kuşu — yeniden doğuş/süreklilik) + mon (izleme); konu akıllı tahtalar.
 * Yazı currentColor'dan rengini alır (açık/koyu temalarda okunur); simgeler kendi renklerini taşır.
 * Aynı sayfada birden çok logo çizildiğinde degrade kimlikleri çakışmasın diye her çizim ön ek alır.
 */
qx.Class.define("ankamon.ui.Logos", {
  type: "static",

  statics: {
    FONT: "Inter, 'Segoe UI', Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif",

    /** Adaylar: ad + simge (64×64 alanda) + yazı biçimi. g(ad) degrade kimliğini ön ekler. */
    LIST: [
      {
        name: "Kanatlı ekran",
        defs: g => `<linearGradient id="${g("a")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a1f"/><stop offset="1" stop-color="#e5332a"/></linearGradient>`,
        icon: g => `<rect x="4" y="4" width="56" height="56" rx="15" fill="url(#${g("a")})"/>` +
          `<path d="M32 31C27 22 19 19 12 21c5-6 14-8 20-2 6-6 15-4 20 2-7-2-15 1-20 10z" fill="#fff"/>` +
          `<rect x="17" y="34" width="30" height="17" rx="3" fill="none" stroke="#fff" stroke-width="3"/>`,
        text: { weight: 800, spacing: 2, accent: "#e5332a", split: 4 }
      },
      {
        name: "Nabız monitörü",
        defs: g => `<linearGradient id="${g("a")}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#6366f1"/></linearGradient>`,
        icon: g => `<rect x="5" y="9" width="54" height="36" rx="6" fill="none" stroke="url(#${g("a")})" stroke-width="4"/>` +
          `<path d="M24 55h16M32 45v10" stroke="url(#${g("a")})" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M12 28h9l4-9 6 17 5-13 3 5h13" fill="none" stroke="#f97316" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`,
        text: { weight: 700, spacing: 3 }
      },
      {
        name: "Merkez ağ",
        defs: g => `<radialGradient id="${g("a")}"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#059669"/></radialGradient>`,
        icon: g => {
          const pts = [[54, 32], [43, 51], [21, 51], [10, 32], [21, 13], [43, 13]];
          return pts.map(([x, y]) => `<path d="M32 32L${x} ${y}" stroke="#10b981" stroke-width="2" opacity=".55"/>`).join("") +
            pts.map(([x, y]) => `<rect x="${x - 5}" y="${y - 4}" width="10" height="8" rx="2" fill="#0f766e"/>`).join("") +
            `<circle cx="32" cy="32" r="9" fill="url(#${g("a")})"/><circle cx="32" cy="32" r="3.5" fill="#fff"/>`;
        },
        text: { weight: 600, spacing: 4, accent: "#059669", split: 4 }
      },
      {
        name: "A monogramı",
        defs: g => `<linearGradient id="${g("a")}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#ec4899"/></linearGradient>`,
        icon: g => `<path d="M9 56L32 8l23 48" fill="none" stroke="url(#${g("a")})" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<path d="M17 40h8l3-6 4 11 3-5h12" fill="none" stroke="url(#${g("a")})" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
        text: { weight: 800, spacing: 1 }
      },
      {
        name: "Radar",
        defs: g => `<linearGradient id="${g("a")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14b8a6" stop-opacity=".75"/><stop offset="1" stop-color="#14b8a6" stop-opacity="0"/></linearGradient>`,
        icon: g => `<circle cx="32" cy="32" r="27" fill="none" stroke="#0d9488" stroke-width="3"/>` +
          `<circle cx="32" cy="32" r="18" fill="none" stroke="#0d9488" stroke-width="2" opacity=".6"/>` +
          `<circle cx="32" cy="32" r="9" fill="none" stroke="#0d9488" stroke-width="2" opacity=".4"/>` +
          `<path d="M32 32V5a27 27 0 0 1 23.4 13.5z" fill="url(#${g("a")})"/>` +
          `<circle cx="32" cy="32" r="3" fill="#0d9488"/><circle cx="45" cy="21" r="3.5" fill="#f59e0b"/>`,
        text: { weight: 700, spacing: 2, tagline: "akıllı tahta izleme" }
      },
      {
        name: "Gözcü",
        defs: g => `<linearGradient id="${g("a")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient>`,
        icon: g => `<path d="M3 32Q32 4 61 32Q32 60 3 32z" fill="none" stroke="url(#${g("a")})" stroke-width="4" stroke-linejoin="round"/>` +
          `<circle cx="32" cy="32" r="13" fill="url(#${g("a")})"/>` +
          `<path d="M26 27h5v4h-5zM33 27h5v4h-5zM26 33h5v4h-5zM33 33h5v4h-5z" fill="#fff"/>`,
        text: { weight: 300, spacing: 6 }
      },
      {
        name: "Anka tüyü",
        defs: g => `<linearGradient id="${g("a")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset=".55" stop-color="#f97316"/><stop offset="1" stop-color="#dc2626"/></linearGradient>`,
        icon: g => `<path d="M32 3c12 14 20 25 16 39-3 10-10 16-16 19-6-3-13-9-16-19C12 28 20 17 32 3z" fill="url(#${g("a")})"/>` +
          `<path d="M32 21c6 8 8 16 4 24-2 4-4 7-4 7s-2-3-4-7c-4-8-2-16 4-24z" fill="#fff" opacity=".88"/>` +
          `<path d="M32 30v28" stroke="url(#${g("a")})" stroke-width="2.5" stroke-linecap="round"/>`,
        text: { weight: 700, spacing: 2, accent: "#f97316", split: 4 }
      },
      {
        name: "Tahta ızgarası",
        defs: () => "",
        icon: () => `<rect x="5" y="11" width="24" height="18" rx="3" fill="#64748b"/>` +
          `<rect x="35" y="11" width="24" height="18" rx="3" fill="#64748b"/>` +
          `<rect x="5" y="35" width="24" height="18" rx="3" fill="#64748b"/>` +
          `<rect x="35" y="35" width="24" height="18" rx="3" fill="#16a34a"/>` +
          `<path d="M41 44l4 4 8-8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
        text: { weight: 800, spacing: 3, accent: "#16a34a", split: 4 }
      },
      {
        name: "Kalkan",
        defs: g => `<linearGradient id="${g("a")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient>`,
        icon: g => `<path d="M32 3l23 8v19c0 14-10 24-23 31C19 54 9 44 9 30V11z" fill="url(#${g("a")})"/>` +
          `<path d="M21 46l11-27 11 27" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<path d="M22 37h6l2-4 3 7 2-3h7" fill="none" stroke="#38bdf8" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`,
        text: { weight: 700, spacing: 2, tagline: "merkezi tahta yönetimi" }
      },
      {
        name: "Anka silueti",
        defs: g => `<linearGradient id="${g("a")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#b91c1c"/></linearGradient>`,
        icon: g => `<circle cx="32" cy="32" r="29" fill="none" stroke="url(#${g("a")})" stroke-width="2.5"/>` +
          `<path d="M8 29c8-9 17-9 22-2l2-11 2 11c5-7 14-7 22 2-8-2-15 1-20 7l-2 14-2-14c-5-6-12-9-24-7z" fill="url(#${g("a")})"/>` +
          `<path d="M29 50l-3 6M32 52v6M35 50l3 6" stroke="url(#${g("a")})" stroke-width="2.5" stroke-linecap="round"/>`,
        text: { weight: 500, spacing: 5 }
      }
    ],

    /** n. logonun (0 tabanlı) SVG'si; height piksel yüksekliği, en/boy oranı korunur. */
    svg(n, height) {
      const S = ankamon.ui.Logos;
      const L = S.LIST[n];
      const p = "lg" + n + "_" + (S.__seq++) + "_";
      const g = id => p + id;
      const t = L.text;
      const word = t.accent
        ? `<tspan fill="${t.accent}">ANKA</tspan><tspan fill="currentColor">MON</tspan>`
        : "ANKAMON";
      const y = t.tagline ? 36 : 43;
      const tag = t.tagline
        ? `<text x="78" y="54" font-family="${S.FONT}" font-size="11.5" letter-spacing="1" fill="currentColor" opacity=".6">${t.tagline}</text>`
        : "";
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 64" height="${height}" width="${Math.round(height * 250 / 64)}" role="img" aria-label="Ankamon">` +
        `<defs>${L.defs(g)}</defs>${L.icon(g)}` +
        `<text x="76" y="${y}" font-family="${S.FONT}" font-size="27" font-weight="${t.weight}" letter-spacing="${t.spacing}" fill="currentColor">${word}</text>` +
        tag + "</svg>";
    },

    __seq: 0
  }
});
