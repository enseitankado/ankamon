/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
 * Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
 * https://github.com/enseitankado/ankamon
 *
 * Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
 * GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
 * daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
 * değiştirebilirsiniz.
 *
 * Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
 * YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
 * verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
 *
 * Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
 * dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
 * adresine bakınız.
 *
 * Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
 * parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
 * lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
 * korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
 * kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).
 */

/**
 * Toplu işlemlerde "bu bilgisayarda iş sürüyor" simgesi: metnin rengini alan, dönen ince halka.
 * Durağan ▶/⏳ işareti işin ilerlediği hissini vermiyordu (kullanıcı bildirdi); Toplu komut penceresi,
 * Sorun tespiti, Anomali taraması, Toplu dosya, bilgi toplama ve eklenti okuma pencereleri bunu kullanır.
 *
 * Simge HTML'dir (rich etiket, Html hücre çizici ya da qx.ui.embed.Html içinde). Tablolar/listeler her
 * yoklamada yeniden çizildiğinden animasyon gecikmesi saate bağlanır: yeniden çizilen halka kaldığı
 * açıdan döner, başa sarıp sekmez. Hareket azaltma tercihinde yavaş döner (durmaz — anlamı "sürüyor").
 */
qx.Class.define("ankamon.ui.JobSpinner", {
  type: "static",

  statics: {
    PERIOD_MS: 900,
    __styled: false,

    CSS: `
      .ankamon-job-spinner { display: inline-block; box-sizing: border-box; width: .9em; height: .9em;
        vertical-align: -.12em; border: 2px solid currentColor; border-right-color: transparent;
        border-radius: 50%; animation: ankamon-job-spin .9s linear infinite; }
      @keyframes ankamon-job-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .ankamon-job-spinner { animation-duration: 2.4s; } }
    `,

    /**
     * @param color {String?} halka rengi (verilmezse çevredeki metnin rengi)
     * @return {String} simgenin HTML'i
     */
    html(color) {
      const S = ankamon.ui.JobSpinner;
      if (!S.__styled) {
        S.__styled = true;
        qx.bom.Stylesheet.createElement(S.CSS);
      }
      const phase = Date.now() % S.PERIOD_MS;
      return `<span class="ankamon-job-spinner" role="img" aria-label="sürüyor" ` +
        `style="animation-delay:-${phase}ms${color ? ";color:" + color : ""}"></span>`;
    },

    /** Simge + metin (ör. "Sürüyor"); metin kaçışlanmaz, çağıran hazırlar. */
    label(text, color) {
      return `${ankamon.ui.JobSpinner.html(color)}&nbsp;${text}`;
    }
  }
});
