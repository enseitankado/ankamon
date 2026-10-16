/**
 * Ubuntu görünümü için yazı tipleri: Fluent'inkiler (+ Tiha-Mon app-*) — aile Ubuntu sistem yazı tipi
 * yığınıyla değiştirilmiş (bkz. Derive.fonts). Yazı tipi istemcide yoksa sıradaki aileye düşer.
 *
 * Derive tanım anında çağrıldığından yükleme bağımlılığı açıkça bildirilir (derleyici bunu kendisi
 * görmüyor; olmadan paket bu sınıfı Derive'dan önce yükleyip arayüz hiç açılmıyordu).
 * @require(tihamon.theme.Derive)
 */
qx.Theme.define("tihamon.theme.FontUbuntu", {
  extend: tihamon.theme.FontFluent,

  fonts: tihamon.theme.Derive.fonts(tihamon.theme.FontFluent,
    ["Ubuntu", "Ubuntu Sans", "Noto Sans", "DejaVu Sans", "sans-serif"],
    ["Ubuntu Mono", "Ubuntu Sans Mono", "DejaVu Sans Mono", "monospace"])
});
