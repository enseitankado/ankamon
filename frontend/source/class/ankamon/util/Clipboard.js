/**
 * Panoya metin kopyalama. Arayüz okul ağında düz HTTP ile açıldığından (güvenli bağlam değil)
 * navigator.clipboard çoğu zaman YOKTUR; o durumda gizli bir textarea + execCommand("copy")
 * yedeğine düşülür — bu da yalnız bir kullanıcı hareketi (tıklama/tuş) içinde çağrılınca çalışır.
 */
qx.Class.define("ankamon.util.Clipboard", {
  type: "static",

  statics: {
    /** @return {Promise<Boolean>} kopyalandıysa true */
    async copy(text) {
      if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch (e) {
          // izin verilmedi: aşağıdaki yedeğe düş
        }
      }
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(area);
      const active = document.activeElement;
      area.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      area.remove();
      if (active && active.focus) {
        active.focus();
      }
      return ok;
    }
  }
});
