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
 * Tahta sağlığı ▸ Yardım sekmesi (bkz. page.Anomalies): bulguların iki yolu (sürekli izleme / SSH denetimi) ve sekmeler;
 * SSH denetim raporunun ne olduğu, nasıl okunduğu, denetimlerin ne zaman/nasıl yapıldığı ve sık karşılaşılan durumlar (kullanıcı isteği: "buranın ne işe yaradığı, nasıl çalıştığı
 * anlaşılmıyor"). Takvim değerleri sabit yazılmaz — /api/diagnose'un schedule alanından (sunucunun .env'i:
 * DIAGNOSE_INTERVAL_DAYS, DIAGNOSE_RETRY_HOURS) ve şu an denetlenemeyen tahtalardan okunur. Kodda karşılığı
 * olmayan iddia yazılmaz: kurallar worker/ankamon/tasks/diagnose_schedule.py ve executor/diagnose.py'dendir.
 */
qx.Class.define("ankamon.page.MaintenanceHelp", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, null);
    this._actions.exclude();
    this.__html = new qx.ui.embed.Html("").set({
      overflowX: "hidden", overflowY: "auto", backgroundColor: "surface", textColor: "text-primary-on-surface",
      decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 4 })
    });
    this.add(this.__html, { flex: 1 });
    this.__html.setHtml(this.__render(null));
  },

  members: {
    __html: null,

    async _refresh() {
      let sc = null;
      if (this._can("diagnose")) {
        try {
          sc = (await ankamon.io.Api.get("/diagnose")).schedule;
        } catch (e) {
          sc = null; // yardım takvim bilgisi olmadan da okunur
        }
      }
      if (!this.isDisposed()) {
        this.__html.setHtml(this.__render(sc));
      }
    },

    __render(sc) {
      const esc = s => qx.bom.String.escape(String(s ?? ""));
      const days = sc ? sc.interval_days : 7;
      const retry = sc && sc.retry_hours ? sc.retry_hours : 6;
      const early = Math.round(days * 0.85 * 10) / 10;
      const badge = (color, text) => `<span class="b" style="background:${color}">${text}</span>`;
      const L = ankamon.page.Diagnose.LEVEL;
      const lv = k => badge(L[k].color, L[k].text);
      const P = ankamon.ui.health.Status.PATH;
      const path = k => badge(P[k].color, P[k].text);
      let now = "";
      if (sc) {
        now = `<div class="v note"><span class="t">Şu an</span>${sc.boards} kayıtlı tahta; ` +
          (sc.never_scanned ? `${sc.never_scanned} tahta henüz hiç başarıyla denetlenmedi (açık olduklarında sırayla taranır). ` : "") +
          (sc.failing && sc.failing.length
            ? `son denemesi başarısız olan: <b>${esc(sc.failing.join(", "))}</b> — ${retry} saatte bir yeniden denenir.`
            : "son denemesi başarısız olan tahta yok.") + "</div>";
      }
      return `<div class="mh">
<style>
.mh{font:13px/1.6 sans-serif;padding:6px 18px 24px;max-width:1000px}
.mh h3{font-size:15px;margin:20px 0 6px;padding-bottom:3px;border-bottom:1px solid rgba(128,128,128,.35)}
.mh table{border-collapse:collapse;width:100%;margin:4px 0}
.mh th,.mh td{border:1px solid rgba(128,128,128,.3);padding:5px 8px;text-align:left;vertical-align:top}
.mh th{background:rgba(128,128,128,.12);font-weight:600;white-space:nowrap}
.mh ul,.mh ol{margin:4px 0;padding-left:22px}
.mh li{margin:2px 0}
.mh .b{display:inline-block;min-width:62px;padding:0 8px;border-radius:10px;color:#fff;font-weight:600;text-align:center;font-size:12px}
.mh .v{border-left:5px solid rgba(128,128,128,.55);background:rgba(128,128,128,.08);padding:8px 12px;margin:10px 0;border-radius:3px}
.mh .v .t{display:block;font-weight:700;margin-bottom:2px}
.mh .q{font-weight:700;margin-top:10px}
</style>

<h3>Tahta sağlığı ne işe yarar?</h3>
<p>Tahtalarda arızaya dönüşmeden önce fark edilmesi gereken donanım, yazılım ve ağ sorunlarını bulur. Bulgular
<b>iki yoldan</b> gelir; her bulgunun yanında hangisinden geldiği, kaynağı ve nasıl bakıldığı yazar.</p>
<table>
  <tr><th></th><th>${path("watch")}</th><th>${path("ssh")}</th></tr>
  <tr><th>Nasıl bakılır</th><td>Ankamon tahtaya <b>bağlanmaz</b>: tahtanın gönderdiği loglardan, tahtanın 9100 portundan
    okuduğu ölçümlerden ya da daha önce toplanmış bilgiden çıkarır.</td>
    <td>Ankamon tahtaya root olarak <b>SSH ile girer</b>, yalnız okuma yapan komutlarla ölçer (tahtada hiçbir şey değişmez).</td></tr>
  <tr><th>Ne zaman</th><td>Sürekli: kurala göre dakikada bir ya da 5 dakikada bir.</td>
    <td>Her tahta haftada bir kendiliğinden (sunucu boştayken); istenince <b>Tara</b> sekmesinden ya da
    <b>Denetim raporları ▸ Şimdi tara</b> ile.</td></tr>
  <tr><th>Ne üretir</th><td>Zaman aralığı olan olay: ne zaman başladı, sürüyor mu, ne zaman bitti.</td>
    <td>Denetim anının fotoğrafı: o an diskin, servislerin, güncellemelerin durumu.</td></tr>
  <tr><th>Neyi iyi görür</th><td>Gelip geçen olaylar: ağ kopması, kaba kuvvet girişimi, sıcaklık yükselmesi, saat sapması,
    oturumsuz açık kalma.</td><td>Ancak tahtaya girince görülenler: disk sağlığı (SMART), bekleyen güncellemeler, başarısız
    servisler, boş alan.</td></tr>
  <tr><th>Tahta kapalıyken</th><td>Kayıtlar kalır; bazı olaylar (ör. ağ kopması) bağlantı gelince geriye dönük yazılır.</td>
    <td>Denetlenemez; ilk açıldığı uygun anda denetlenir.</td></tr>
</table>
<p>Aynı soruya iki ayrı cevap verilmesin diye sürekli ölçülebilenler (BIOS pili, saat eşitlemesi) yalnız sürekli izlemede
bakılır. Her denetimin listesi: <b>Denetimler</b> sekmesi.</p>
<h3>Sekmeler</h3>
<ul>
  <li><b>Durum</b> — her tahtanın şu anki sağlığı: en kötü bulgusu, sürekli izlemede şu an sürenler, son SSH denetiminin
      sonucu. Bir tahta seçince altta bulguları; her bulguda <i>Yol, Kaynak, Nasıl bakıldı, Sıklık, Zaman</i>.
      "Aksiyon gereken ne?" sorusunun cevabı burası. Bulguya çift tık: kaydına (Geçmiş ya da Denetim raporları) gider.</li>
  <li><b>Geçmiş / Özet</b> — sürekli izleme kayıtları, sayfanın üstündeki rapor döneminde.</li>
  <li><b>Denetim raporları</b> — SSH denetimlerinin raporları (aşağıda anlatılıyor).</li>
  <li><b>Tara</b> — seçilen tahtalara o an bakmak: tam SSH denetimi ve/veya sürekli izleme denetimlerinin anlık yoklaması.</li>
  <li><b>Denetimler</b> — bütün denetimler: yolu, kaynağı, nasıl ve ne sıklıkla bakıldığı, bulgu düzeyi.</li>
  <li><b>Bildirimler</b> — sürekli izleme bulgularının telefona ntfy bildirimi.</li>
</ul>
<p>Zaman içindeki değişimin grafikleri (sıcaklık, işlemci, bellek, disk, ağ) <b>Bakım ▸ Sensörler</b>'de.</p>
${now}

<h3>Denetim raporları nasıl okunur?</h3>
<ol>
  <li>Sayfa açılınca <b>"Son durum — tüm tahtalar"</b> görünür: denetlenmiş <b>her tahtanın en son denetimi</b>, hangi
      taramada yapılmış olursa olsun, tek tabloda. Her satırın sağında denetim zamanı ve kimin başlattığı
      (<i>otomatik</i> ya da <i>elle: kullanıcı</i>) yazar.</li>
  <li>Satıra tıklayınca o tahtanın tüm bulguları, önerileriyle birlikte altında açılır. Başlıktaki <b>Tahta</b> okuna
      tıklamak hepsini açar/kapatır.</li>
  <li><b>Göster</b> kutularıyla düzey, <b>Tahta</b> seçicisiyle tek tahta süzülür (sunucuya gidilmez).</li>
  <li><b>Rapor</b> seçicisinde, "Son durum"un altında tek tek taramalar listelenir (en yeni 30). Bir taramayı seçince
      yalnız o taramada denetlenen tahtalar görünür.</li>
</ol>
<table>
  <tr><th>Düzey</th><th>Anlamı</th></tr>
  <tr><td>${lv("bad")}</td><td>Hemen ilgilenilmeli: arıza yakın ya da tahta denetlenemedi (<i>bağlanılamadı</i>).</td></tr>
  <tr><td>${lv("warn")}</td><td>Henüz arıza yok ama kötüye gidiyor ya da performansı düşürüyor.</td></tr>
  <tr><td>${lv("info")}</td><td>Bilinmesi yararlı; işlem gerekmeyebilir (ör. yeniden başlatma bekliyor, sensör okunamadı).</td></tr>
  <tr><td>${lv("ok")}</td><td>Denetlenen hiçbir başlıkta sorun bulunmadı.</td></tr>
</table>
<p>Tahtanın genel durumu en kötü bulgusudur. <b>Acil / Dikkat / Bilgi</b> sütunları o düzeydeki bulgu sayısıdır.
<i>Yarıda kaldı</i>: tarama o tahtada bitmeden kesildi (ör. Ankamon yeniden başlatıldı) — yeniden taranır.</p>

<h3>SSH denetimi ne zaman yapılır?</h3>
<table>
  <tr><th>Elle</th><td><b>Tara</b> sekmesinde <i>Tam SSH denetimi</i> seçili tahtaları, Denetim raporları'ndaki
    <b>Şimdi tara</b> düğmesi o an <b>açık olan tüm tahtaları</b> denetler (aynı anda kaç tahta: sunucunun
    boş işlemci/belleğine göre). İlerleme düğmelerin yanında görünür.</td></tr>
  <tr><th>Otomatik</th><td>Her tahta <b>en az ${esc(days)} günde bir</b> kendiliğinden denetlenir. Saat <b>tahta başına</b>
    işler: bir tahtanın son başarılı denetiminden ~${esc(early)} gün geçince, sunucu boştayken (düşük işlemci yükü, yeterli
    boş bellek, az ağ trafiği) taranır; ${esc(days)} gün dolunca eşikler gevşer, bir gün daha geçerse sunucu meşgul olsa da
    taranır. Sunucuda başka bir görev sürerken otomatik tarama başlamaz.</td></tr>
  <tr><th>Neden çoğu otomatik<br>tarama 1-2 tahtalık?</th><td>Çünkü otomatik tarama yalnız <b>zamanı gelen</b> tahtaları
    kapsar ve tahtalar farklı günlerde açılıp denetlendiğinden zamanları farklıdır. Bu, tüm tahtaların taranmadığı
    anlamına gelmez — "Son durum" görünümü hepsini birlikte gösterir.</td></tr>
  <tr><th>Kapalı tahta</th><td>Taranamaz; ilk açıldığı uygun anda taranır.</td></tr>
  <tr><th>Denetlenemeyen tahta</th><td>Bağlanılamayan tahta (ör. "SSH parolası reddedildi") <b>${esc(retry)} saatte bir</b>
    yeniden denenir; neden düzelene kadar raporda ${lv("bad")} <i>bağlanılamadı</i> olarak kalır.</td></tr>
</table>

<h3>Nasıl çalışır?</h3>
<ul>
  <li>Sunucu her tahtaya <b>root</b> olarak <b>tek bir SSH bağlantısı</b> açar (tahta başına ~1-2 sn) ve yalnız okuma
      yapan komutlar çalıştırır: donanım bilgisi, disk SMART değerleri, son 7 günün çekirdek günlüğü, donanım
      sensörleri, disk doluluğu, paket durumu. <b>Tahtada hiçbir şey değiştirilmez</b>; güncelleme listesi bile
      yenilenmez (<code>apt update</code> çalıştırılmaz), tahtadaki mevcut liste okunur.</li>
  <li>Toplanan donanım bilgisi tahtanın Bilgi kartını da tazeler.</li>
  <li>Bazı denetimler tahtayı diğerleriyle kıyaslar (ör. RAM'i ve diski tahtaların ortalamasının belirgin altında mı)
      ve son 24 saatin işlemci sıcaklığı için toplanan sensör ölçümlerini kullanır.</li>
  <li>Raporlar sunucuda veritabanında saklanır ve kendiliğinden silinmez; eskileri
      <b>Sistem ▸ Disk kullanımı ▸ Bakım raporları</b> sekmesinden silinebilir.</li>
</ul>

<h3>SSH denetiminde neler denetlenir?</h3>
<table>
  <tr><th>Başlık</th><th>Denetimler</th></tr>
  <tr><td>Donanım kapasitesi</td><td>RAM ve disk boyutu (tahtaların ortalamasıyla kıyas)</td></tr>
  <tr><td>Disk sağlığı (SMART)</td><td>diskin kendi sağlık testi, okunamayan sektörler, yıpranma işaretleri, eşiği aşan öznitelikler (bu SMART hataları <b>Acil</b> sayılır), SSD kalan ömrü,
      disk sıcaklığı, son 7 günde çekirdeğin bildirdiği disk (G/Ç) hataları</td></tr>
  <tr><td>İşlemci sıcaklığı</td><td>son 24 saatin sıcaklık ölçümleri, ısı yüzünden işlemcinin yavaşlatılması</td></tr>
  <tr><td>Soğutma ve kasa</td><td>işlemci fanı dönüyor mu, kasa içi sıcaklık</td></tr>
  <tr><td>Boş disk alanı</td><td>kök dosya sistemi doluluğu, dosya sayısı sınırı (inode)</td></tr>
  <tr><td>Yazılım güncellemeleri</td><td>bekleyen (güvenlik dahil) güncellemeler, paket listesinin yaşı</td></tr>
  <tr><td>Sistem çalışma koşulları</td><td>düşük RAM, takas alanı yok, mekanik disk (HDD), salt-okunur dosya sistemi,
      bellek yetersizliği nedeniyle kapatılan uygulamalar, başarısız servisler, yarım kalmış paket kurulumu,
      sürekli yüksek yük / işlemci kullanımı, yeniden başlatma bekliyor, uzun süredir açık</td></tr>
</table>

<p>BIOS (CMOS) pili ve saat eşitlemesi sürekli izlemede bakılır: <i>BIOS pili zayıf</i>, <i>NTP eşitlenmemiş</i>,
<i>Tahta saati yanlış</i> (Denetimler sekmesi).</p>

<h3>Sık karşılaşılan durumlar</h3>
<div class="q">Bir tahta hep ${lv("bad")} "bağlanılamadı — SSH parolası reddedildi" görünüyor.</div>
<p>Sunucu tahtaya genel root parolasıyla (Ayarlar ▸ SSH erişimi) giremiyor: o tahtada root parolası değiştirilmiş.
Tahtanın şu anki root parolasını biliyorsanız <b>Tahtalar ▸ sağ menü ▸ Kullanıcılar ▸ Parola ayarla… ▸ Yönetici hesapları</b>
ile kaydedin; sunucu o tahtaya bundan sonra bu parolayla girer ve bir sonraki denemede (en geç ${esc(retry)} saat içinde ya da
hemen <b>Şimdi tara</b> ile) rapor düzelir.</p>
<div class="q">"bağlanılamadı — SSH ile ulaşılamadı / zaman aşımı".</div>
<p>Tahta tarama anında ağdan düşmüş ya da kapanıyor olabilir; bir sonraki denemede genellikle düzelir. Sürüyorsa tahtanın
ağ bağlantısını ve SSH servisini denetleyin.</p>
<div class="q">Bir tahta raporda hiç yok.</div>
<p>O tahta henüz hiç denetlenmedi (ör. hep kapalıydı ya da yeni eklendi). Açıkken <b>Şimdi tara</b> ile hemen denetlenebilir.</p>
<div class="q">Bulguyu giderdim, rapor hâlâ eski.</div>
<p>Rapor, denetim anının durumudur. <b>Şimdi tara</b> ile yeniden denetleyin; yeni sonuç "Son durum"a hemen yansır.</p>
</div>`;
    }
  }
});
