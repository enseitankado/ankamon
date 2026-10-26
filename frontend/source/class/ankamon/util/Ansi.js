/**
 * Terminal (ANSI SGR) renkli metni HTML'e çevirir — ör. ahenk-debug'ın renkli raporu (Bakım ▸ Ahenk).
 * Yalnız renk/kalın/soluk/altı çizili kodları (ESC[...m) yorumlanır; diğer kaçış dizileri atılır. Renkler
 * koyu zemin (#1e1e1e) için seçildi. Çıktı kaçırılmış (escape) metindir, doğrudan rich Label'a verilebilir.
 */
qx.Class.define("ankamon.util.Ansi", {
  type: "static",

  statics: {
    BACKGROUND: "#1e1e1e",
    FOREGROUND: "#d4d4d4",
    // 30-37 / 90-97 (parlak)
    COLORS: ["#3b3b3b", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5"],
    BRIGHT: ["#666666", "#ff6b6b", "#5af78e", "#ffff7a", "#6cb6ff", "#ff92df", "#8be9fd", "#ffffff"],

    toHtml(text) {
      const esc = qx.bom.String.escape;
      const S = ankamon.util.Ansi;
      let state = { fg: null, bold: false, dim: false, under: false };
      let out = "";
      let open = false;
      const style = () => {
        const css = [];
        if (state.fg) {
          css.push("color:" + state.fg);
        }
        if (state.bold) {
          css.push("font-weight:bold");
        }
        if (state.dim) {
          css.push("opacity:.65");
        }
        if (state.under) {
          css.push("text-decoration:underline");
        }
        return css.join(";");
      };
      // ESC[ ... m (SGR) ve diğer CSI dizileri; geri kalan metin parçaları arada.
      const parts = String(text || "").replace(/\r/g, "").split(/(\x1b\[[0-9;?]*[A-Za-z])/);
      parts.forEach(part => {
        const m = /^\x1b\[([0-9;]*)m$/.exec(part);
        if (m) {
          (m[1] === "" ? ["0"] : m[1].split(";")).forEach(code => {
            const n = parseInt(code, 10);
            if (n === 0) {
              state = { fg: null, bold: false, dim: false, under: false };
            } else if (n === 1) {
              state.bold = true;
            } else if (n === 2) {
              state.dim = true;
            } else if (n === 4) {
              state.under = true;
            } else if (n === 22) {
              state.bold = state.dim = false;
            } else if (n === 24) {
              state.under = false;
            } else if (n === 39) {
              state.fg = null;
            } else if (n >= 30 && n <= 37) {
              state.fg = S.COLORS[n - 30];
            } else if (n >= 90 && n <= 97) {
              state.fg = S.BRIGHT[n - 90];
            }
          });
          if (open) {
            out += "</span>";
          }
          const css = style();
          open = !!css;
          if (open) {
            out += `<span style="${css}">`;
          }
        } else if (part && !part.startsWith("\x1b[")) {
          out += esc(part.replace(/\x1b/g, ""));
        }
      });
      return out + (open ? "</span>" : "");
    },

    /**
     * Durum etiketlerini ([ OK ] / [WARN] / [FAIL] / [INFO]) renk kodu taşımıyorlarsa aracın kendi
     * renkleriyle (yeşil / sarı / kırmızı / camgöbeği, kalın) boyar. ahenk-debug bu etiketleri modül
     * yüklenirken üretiyor, --renk=her-zaman ise sonra işleniyor; sonuçta etiketler renksiz geliyor.
     * Zaten renkli olanlara dokunulmaz (aracın ileride düzeltilmesi hâlinde çift boyama olmaz).
     */
    colorBadges(text) {
      const code = { "[ OK ]": "1;32", "[WARN]": "1;33", "[FAIL]": "1;31", "[INFO]": "1;36" };
      return String(text || "").replace(/(^|[^m])(\[ OK \]|\[WARN\]|\[FAIL\]|\[INFO\])/g,
        (m, pre, badge) => `${pre}\x1b[${code[badge]}m${badge}\x1b[0m`);
    },

    /** Renk kodları atılmış düz metin (panoya kopyalamak için). */
    strip(text) {
      return String(text || "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
    }
  }
});
