/**
 * ville.Fluent (sqville, MIT) — Microsoft Fluent UI / Windows 11 tasarım dili, açık. Anahtar: "fluent-light" (bkz. Registry).
 *
 * Fluent kaynakları "decoration" takma adıyla istenir (@asset(decoration/…)); derleyici takma adı
 * çözmediğinden gerçek yol burada açıkça istenir — yoksa ok/onay kutusu/kaydırıcı görselleri eksik kalır.
 * @asset(ville/theme/fluent/decoration/*)
 */
qx.Theme.define("ankamon.theme.ThemeFluentLight", {
  meta: {
    color: ankamon.theme.ColorFluentLight,
    decoration: ville.theme.fluent.Decoration,
    font: ankamon.theme.FontFluent,
    icon: qx.theme.icon.Tango,
    appearance: ville.theme.fluent.Appearance
  }
});
