/**
 * Metin tabanlı onay kutusu hücre render'ı: işaretliyse ortalanmış kalın "✓", değilse boş.
 *
 * qx.ui.table.cellrenderer.Boolean'ın varsayılan simgeleri (decoration/table/boolean-*.png) yalnız
 * Simple/Classic/Modern dekorasyon temasında var; Tangible'da yok ve görünmez kalıyor. Metin render'ı
 * hiçbir resim kaynağına bağlı olmadığından her temada güvenilir çalışır.
 */
qx.Class.define("tihamon.ui.table.CheckRenderer", {
  extend: qx.ui.table.cellrenderer.Default,

  members: {
    // overridden
    _formatValue(cellInfo) {
      return cellInfo.value ? "✓" : "";
    },

    // overridden
    _getCellStyle(cellInfo) {
      // Beyaz, hafif kenarlıklı kare: bir onay kutusu olduğu ilk bakışta anlaşılsın (yalnız metin
      // yüzmesin). Kare ortalanacak şekilde üstten/soldan küçük bir boşluk bırakılır.
      return super._getCellStyle(cellInfo) +
        "text-align:center;line-height:18px;font-weight:bold;color:#0067c0;cursor:pointer;" +
        "background-color:#ffffff;border:1px solid #c0c0c0;border-radius:3px;" +
        "width:18px;height:18px;margin:4px auto;box-sizing:border-box;";
    }
  }
});
