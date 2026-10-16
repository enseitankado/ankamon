/**
 * GNOME görünümü için yazı tipleri: Fluent'inkiler (+ Tiha-Mon app-*) — aile GNOME sistem yazı tipi
 * yığınıyla değiştirilmiş (bkz. Derive.fonts). Yazı tipi istemcide yoksa sıradaki aileye düşer.
 *
 * Derive tanım anında çağrıldığından yükleme bağımlılığı açıkça bildirilir (derleyici bunu kendisi
 * görmüyor; olmadan paket bu sınıfı Derive'dan önce yükleyip arayüz hiç açılmıyordu).
 * @require(tihamon.theme.Derive)
 */
qx.Theme.define("tihamon.theme.FontGnome", {
  extend: tihamon.theme.FontFluent,

  fonts: tihamon.theme.Derive.fonts(tihamon.theme.FontFluent,
    ["Cantarell", "Adwaita Sans", "Inter", "Noto Sans", "DejaVu Sans", "sans-serif"],
    ["Adwaita Mono", "Source Code Pro", "DejaVu Sans Mono", "monospace"])
});
