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
 * Tahtalar ▸ Ekranlar "?" yardım penceresi: ekran önizlemesi ve tahtalardan veri toplama hangi bağlantılarla yapılır —
 * kullanıcı sayısı tahtalara ne yük getirir (kullanıcı isteği, 2026-11-05). Metin koddaki davranışı anlatır; davranış
 * değişince burası da güncellenir: worker/ankamon/screen/shared_feed.py (paylaşılan yayın), screen/__main__.py
 * (müdahale, sınır), docker/rootfs/screen/index.html (görünmeyen kutucuk/gizli sekme), page.Boards SCREENS_STOP_MS,
 * worker tasks (session_probe 30 sn, board_status), telegraf SCRAPE_INTERVAL.
 */
qx.Class.define("ankamon.ui.boards.ScreenFeedHelp", {
  type: "static",

  statics: {
    open() {
      const win = ankamon.ui.Dialog.window("Ekranlar — bağlantılar nasıl kurulur?", 760, { maximizable: true });
      const root = qx.core.Init.getApplication().getRoot().getBounds();
      win.setHeight(Math.max(420, Math.round((root ? root.height : 800) * 0.8)));
      const html = new qx.ui.embed.Html(this.__html()).set({
        overflowX: "hidden", overflowY: "auto", backgroundColor: "surface", textColor: "text-primary-on-surface",
        decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 6 })
      });
      win.add(html, { flex: 1 });
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [close]);
      win.open();
    },

    __html() {
      const stopSec = Math.round(ankamon.page.Boards.SCREENS_STOP_MS / 1000);
      return `<style>
        .sfh{font:13px/1.55 sans-serif;padding:4px 14px 14px}
        .sfh h3{font-size:14px;margin:16px 0 6px;padding-bottom:3px;border-bottom:1px solid rgba(128,128,128,.35)}
        .sfh table{border-collapse:collapse;width:100%}
        .sfh th,.sfh td{border:1px solid rgba(128,128,128,.3);padding:5px 8px;text-align:left;vertical-align:top}
        .sfh th{background:rgba(128,128,128,.12);font-weight:600}
        .sfh ul{margin:4px 0;padding-left:20px}
        .sfh .note{border-left:5px solid #3b82f6;padding:6px 10px;margin:10px 0;background:rgba(59,130,246,.08);border-radius:3px}
      </style><div class="sfh">
      <h3>Ekran önizlemesi paylaşılır</h3>
      <p>Önizleme kutucukları, ekranı izleme ve sohbet sırasındaki görüntü <b>salt izlemedir</b> ve <b>paylaşılır</b>: bir tahtaya
      kaç kullanıcı bakarsa baksın, tahtaya <b>tek</b> bağlantı açılır (tahtada tek ekran paylaşım süreci, tek SSH tüneli).
      Ankamon gelen görüntüyü kendi içinde çoğaltıp her izleyiciye ayrı sunar. Böylece tahtanın işlemcisi ve ağ trafiği
      izleyici sayısından etkilenmez.</p>
      <p><b>Bilgisayarı yönet</b> (fare/klavye ile müdahale) paylaşılmaz: o kullanıcıya özel, tahtada girdi kabul eden ayrı bir
      bağlantı açılır ve pencere kapanınca biter.</p>
      <div class="note">Tahtadaki ekran yeniden başlarsa (oturum değişti, ekran kilitlendi) yayın yenilenir; kutucuklar
      kendiliğinden yeniden bağlanır.</div>

      <h3>Görüntü ne zaman alınmaz?</h3>
      <ul>
        <li>Tarayıcı simge durumundaysa ya da başka bir sekme öndeyse akışlar <b>hemen</b> durur.</li>
        <li>Liste görünümüne ya da başka bir sayfaya geçilince <b>${stopSec} sn</b> sonra durur (hızlı gidip gelmede yeniden bağlanmasın diye).</li>
        <li>Kaydırınca görünür alanın dışında kalan kutucuk bağlantısını kapatır; kapalı tahtaya bağlanılmaz.</li>
        <li>Bir tahtayı son izleyen de ayrılınca paylaşılan yayın kısa bir bekleme sonrası kapanır.</li>
      </ul>
      Durunca kutucukta son görüntü kalır; geri dönülünce akış kaldığı yerden sürer.

      <h3>Tahtalardan veri toplama (kullanıcı sayısından bağımsız)</h3>
      <table>
        <tr><th>Veri</th><th>Nasıl toplanır</th></tr>
        <tr><td>Metrikler ve sensörler (işlemci, bellek, disk, ağ, sıcaklık, fan, pil)</td><td>Sunucu tahtanın sensör portunu dakikada bir okur, veritabanına yazar.</td></tr>
        <tr><td>Oturum açmış kullanıcı, kilit, ekran uykusu</td><td>30 sn'de bir tahta başına tek SSH yoklaması.</td></tr>
        <tr><td>Açık/kapalı durumu</td><td>Birkaç saniyede bir kısa bağlantı denemesi.</td></tr>
        <tr><td>Loglar</td><td>Tahtalar kendileri gönderir.</td></tr>
      </table>
      <p>Kullanıcıların ekranları bu bilgileri tahtalardan değil Ankamon'un veritabanından okur: kullanıcı sayısı artınca
      tahtalara giden yük artmaz.</p>

      <h3>Kullanıcı başına ayrı bağlantı açanlar</h3>
      <ul>
        <li><b>Bilgisayarı yönet</b> (müdahale).</li>
        <li><b>Başarım</b> görünümü (saniyelik işlemci/bellek): açan her kullanıcı için kutucuk başına ayrı bağlantı.</li>
        <li>Görev yöneticisi, Wi-Fi Monitör, Web terminal, ses ve sohbet pencereleri: pencere açıkken.</li>
      </ul>
      <p>Bunlar yalnız açıkken çalışır, kapanınca biter. Aynı anda en çok 64 ekran akışı (paylaşılan yayınlar + müdahale
      bağlantıları) açılabilir; sınır dolarsa kutucuk “eşzamanlı izleme sınırı aşıldı” der.</p>
      </div>`;
    }
  }
});
