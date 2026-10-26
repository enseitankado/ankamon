/**
 * Ubuntu görünümü için yazı tipleri: Fluent'inkiler (+ Ankamon app-*) — aile Ubuntu sistem yazı tipi
 * yığınıyla değiştirilmiş (bkz. Derive.fonts). Yazı tipi istemcide yoksa sıradaki aileye düşer.
 *
 * Derive tanım anında çağrıldığından yükleme bağımlılığı açıkça bildirilir (derleyici bunu kendisi
 * görmüyor; olmadan paket bu sınıfı Derive'dan önce yükleyip arayüz hiç açılmıyordu).
 * @require(ankamon.theme.Derive)
 */
qx.Theme.define("ankamon.theme.FontUbuntu", {
  extend: ankamon.theme.FontFluent,

  fonts: ankamon.theme.Derive.fonts(ankamon.theme.FontFluent,
    ["Ubuntu", "Ubuntu Sans", "Noto Sans", "DejaVu Sans", "sans-serif"],
    ["Ubuntu Mono", "Ubuntu Sans Mono", "DejaVu Sans Mono", "monospace"])
});
