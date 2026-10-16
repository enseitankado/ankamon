/**
 * macOS görünümü için yazı tipleri: Fluent'inkiler (+ Tiha-Mon app-*) — aile macOS sistem yazı tipi
 * yığınıyla değiştirilmiş (bkz. Derive.fonts). Yazı tipi istemcide yoksa sıradaki aileye düşer.
 *
 * Derive tanım anında çağrıldığından yükleme bağımlılığı açıkça bildirilir (derleyici bunu kendisi
 * görmüyor; olmadan paket bu sınıfı Derive'dan önce yükleyip arayüz hiç açılmıyordu).
 * @require(tihamon.theme.Derive)
 */
qx.Theme.define("tihamon.theme.FontMac", {
  extend: tihamon.theme.FontFluent,

  fonts: tihamon.theme.Derive.fonts(tihamon.theme.FontFluent,
    ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
    ["SF Mono", "Menlo", "Monaco", "DejaVu Sans Mono", "monospace"])
});
