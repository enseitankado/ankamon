"""Docker imajı derlenirken çalışır: webssh'in main.js'ine canlı yazı boyutu değiştirme ekler.

webssh yazı boyutunu yalnız açılışta URL'den (?fontsize=) alır; sonradan değiştirmek sayfayı yeniden
yüklemeyi (= SSH oturumunu koparmayı) gerektirirdi. Bu yama `wssh.set_fontsize(px)` ekler: xterm'in
fontSize seçeneğini değiştirir, önbellekteki hücre ölçüsünü sıfırlar ve pencereye sığan yeni satır/
sütun sayısını sunucuya bildirir (oturum sürer). Tiha-Mon'un web terminal penceresindeki A−/A+
düğmeleri bunu çağırır (bkz. frontend ui/BoardOps.js __terminalWindow).
"""

import pathlib

path = pathlib.Path("/usr/lib/python3.12/site-packages/webssh/static/js/main.js")
src = path.read_text()

anchor = "    wssh.default_font = function() {\n      reset_font_family(term);\n    };\n"
assert anchor in src, "webssh main.js beklenen satırları içermiyor (sürüm değişmiş olabilir)"
addition = """
    // tiha-mon: canlı yazı boyutu (bkz. docker/rootfs/webssh-fontsize-patch.py)
    wssh.set_fontsize = function(px) {
      px = window.parseInt(px, 10);
      if (!px || px < 6 || px > 48 || term === undefined) {
        return;
      }
      term.setOption('fontSize', px);
      // Hücre ölçüsü yeniden çizimden sonra güncellenir; önbellek sıfırlanıp yeni geometri bildirilir.
      window.setTimeout(function() {
        style.width = null;
        style.height = null;
        resize_terminal(term);
      }, 60);
    };
"""
src = src.replace(anchor, anchor + addition, 1)
path.write_text(src)
print("tiha-mon: webssh main.js canlı yazı boyutu yaması uygulandı")
