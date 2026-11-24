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
 * Varlıklar ve ondan beslenen grid'lerin (varlık grupları, Ağ ▸ Akıllı Tahtalar) hücre ipuçları — kullanıcı isteği
 * 2026-11-12: her hücrede, o hücrenin görevi ve verinin hangi yolla elde edildiği lise öğrencisinin anlayacağı sade
 * dille. Sütun kimliği → metin ya da (rowData, value) → metin. Sayfalar bunları sütun tanımlarının cellHint'ine
 * koyar (bkz. page.Base.setCellHints, apply). Yeni sütun eklenince buraya da açıklaması yazılır.
 */
qx.Class.define("ankamon.ui.network.AssetCellHints", {
  type: "static",

  statics: {
    /** Varlıklar (page.Network) — ağda görülen bütün cihazlar. */
    NETWORK: {
      manageable: "Ankamon bu cihazı uzaktan yönetebiliyor mu? Akıllı Tahtalar ve grup listelerindeki 'Yönetilebilir' ile " +
        "aynıdır. Evet: cihazın Ankamon'da cihaz kaydı var ve Ankamon cihaza SSH ile yönetici (root) olarak bağlanabildi — " +
        "cihaz kapanırken ya da kapalıyken de Evet kalır (o an SSH yanıt vermiyorsa yukarıda yazar). Hayır (parola): cihaz " +
        "yanıt veriyor ama parola kabul edilmiyor. Hayır: cihaz kaydı yok (yazıcı, kamera…) ya da hiç bağlanılamadı.",
      exp: "Bu cihazın açık portları ve paylaşılan klasörleri varsa ▸ işaretine tıklayınca altında listelenir.",
      status: "Cihaz şu an ağda mı? Ankamon ağı birkaç dakikada bir tarar (ARP/ping ile 'orada mısın?' diye sorar). " +
        "Yanıt veren cihaz 'Çevrim içi', son taramalarda görülmeyen 'Çevrim dışı' olur.",
      name: "Cihazı tanımamızı sağlayan ad. Sizin verdiğiniz takma ad varsa o, yoksa okul envanterindeki ad, o da " +
        "yoksa cihazın kendi bilgisayar adı ya da IP adresi yazılır.",
      ip_mask: "Cihazın ağdaki adresi (IP) ve bağlı olduğu ağın büyüklüğü (/24 gibi maske). Adres, ağ taraması " +
        "sırasında cihazın verdiği yanıttan ya da gönderdiği loglardan öğrenilir; DHCP verdiği için zamanla değişebilir.",
      mac: "Ağ kartının fabrikada verilen kimlik numarası (MAC). IP değişse de bu değişmez; Ankamon cihazları bununla " +
        "tanır. Ağ taramasında cihazın yanıtından okunur.",
      vendor: "Ağ kartını üreten firma. MAC adresinin ilk yarısı üreticiye ayrılmıştır; Ankamon bu kısmı üretici " +
        "listesinde (IEEE OUI) arar. '(rastgele MAC)': telefon gibi cihazlar gizlilik için uydurma adres kullanır, üretici bilinemez.",
      type: "Cihazın ne olduğu (akıllı tahta, yazıcı, kamera, telefon…). Elle seçtiyseniz o; yoksa Ankamon üreticiye, " +
        "açık portlara ve cihazın kendini tanıtma biçimine bakarak tahmin eder.",
      model: "Cihazın modeli. Elle yazıldıysa o; yoksa cihazın tarama sırasında kendini tanıttığı bilgiden " +
        "(web arayüzü, yazıcı ya da kamera protokolü) ya da cihazların donanım bilgisinden alınır.",
      hostname: "Cihazın kendine verdiği ad (ör. etap-8ab8fb). Ağ taramasında cihaza adı sorulur (DNS/NetBIOS/mDNS) " +
        "ya da cihazın gönderdiği loglardan okunur.",
      os: "Cihazda çalışan işletim sisteminin tahmini (Linux, Windows…). Ankamon cihazın ağ yanıtlarının " +
        "özelliklerine ve açık servislerine bakarak tahmin eder; kesin bilgi değildir.",
      ports: "Cihazda dışarıya açık kapı (port) sayısı — her port bir servis demektir (ör. 22 = SSH, 80 = web). " +
        "'Servisleri tara' ile cihaz tek tek yoklanarak bulunur; boşsa henüz taranmadı.",
      iface: "Ankamon sunucusunun bu cihazı hangi ağ kartıyla (ör. eth0, eth1) gördüğü. Sunucu birden çok ağa bağlıysa " +
        "cihazın hangi ağda olduğunu gösterir.",
      first: "Bu cihazın Ankamon'un listesine ilk girdiği an (ağ taramasında ilk görüldüğü ya da ilk log gönderdiği zaman).",
      seen: "Cihazın ağda en son görüldüğü an. Çevrim içiyse 'şimdi'; değilse son taramada yanıt verdiği zaman.",
      lastlog: "Cihazın Ankamon'a en son log (olay kaydı) gönderdiği an. Cihazlar sistem loglarını ağ üzerinden " +
        "Ankamon'a yollar (syslog); hiç göndermeyen cihazda boş kalır.",
      discovery: "Cihazın listeye hangi yollarla girdiği: Ağ taraması (sunucu ağda buldu), Log gönderimi (cihaz kendisi " +
        "log yolladı), Elle eklendi (siz eklediniz), Ankamon sunucusu (sunucunun kendisi). İlk yazılan, ilk giriş yoludur.",
      notes: "Bu cihaz için sizin yazdığınız serbest not (Düzenle penceresinden). Ankamon kendisi bir şey yazmaz.",
      activity: "Cihazın ağı ne kadar kullandığı, 0–100 arası göreli puan (şu an en yoğun cihaz = 100). Ankamon ağdaki " +
        "trafiği dışarıdan izleyerek ölçer; cihaza bir şey kurulmaz.",
      activity_detail: "Ağ etkinliğinin ayrıntısı: saniyedeki veri miktarı (kbit/sn) ve en çok kullanılan protokol. Trafik " +
        "görünmüyorsa Windows cihazların gönderdiği paket sayısından tahmin edilir; 'sakin' = belirgin trafik yok.",
      sensors: "Bu cihazdan sensör verisi (işlemci, bellek, disk, sıcaklık, fan…) geliyor mu? Cihaza 'Metrik izlemeyi kur' " +
        "ile küçük bir ölçüm programı (node_exporter) kurulur; Ankamon onu dakikada bir okur. Var: son 24 saatte veri geldi. " +
        "Yok: veri gelmedi (program kurulu değil, cihaz kapalı ya da yönetilen bir cihaz değil).",
      location: "Cihazın okulda durduğu yer. Tesis Envanteri kodu il.ilçe.tesis.bina.kat.salon ile yazılır (ör. 55.11.165.1.2.15 " +
        "= 55 il, 11 ilçe, 165 okul, 1. bina, 2. kat, 15. salon); kod bilinmiyorsa düz yazı da olur. Ankamon bunu kendisi " +
        "bulamaz: Cihaz ayrıntıları penceresinde elle girilir. Akıllı tahtada Varlıklar ve Akıllı Tahtalar aynı değeri gösterir."
    },

    /** Ağ ▸ Akıllı Tahtalar (page.Devices) — Varlıklar'ın akıllı tahta alt kümesi. */
    DEVICES: {
      status: "Cihaz şu an ağda mı? Varlıklar'daki durumla aynıdır: ağ taraması cihazı görüyorsa ya da SSH yanıt " +
        "veriyorsa 'Çevrimiçi', görülmüyorsa 'Kapalı'.",
      manageable: "Ankamon bu cihazı uzaktan yönetebiliyor mu? Ankamon 30 saniyede bir cihaza SSH ile yönetici (root) olarak " +
        "bağlanmayı dener. Evet: bağlanabildiği biliniyor — cihaz kapanırken ya da kapalıyken de Evet kalır (o an SSH yanıt " +
        "vermiyorsa yukarıda yazar). Hayır (parola): cihaz yanıt veriyor ama parola kabul edilmiyor. Hayır: hiç bağlanılamadı.",
      name: "Cihazın adı: verdiğiniz takma ad, yoksa cihazın bilgisayar adı ya da IP adresi.",
      hostname: "Cihazın kendine verdiği ad (ör. etap-8ab8fb). Cihazın gönderdiği loglardan ya da SSH ile sorularak öğrenilir.",
      ip: "Cihazın ağdaki şu anki adresi. Cihazın MAC'i ağ taramasında hangi adreste görülürse o yazılır (DHCP adresi değiştirebilir).",
      mac: "Kablolu ağ kartının fabrika kimliği. Cihaz bu adresle tanınır; kapalı cihazı uzaktan açmak (Wake-on-LAN) da bununla yapılır.",
      wifi_mac: "Kablosuz (Wi-Fi) kartın fabrika kimliği. Cihaza SSH ile bağlanılıp kartın kalıcı adresi okunur " +
        "(Wi-Fi taramalarında görünen rastgele adres değil).",
      faz: "Tahtanın sınıfı: MEB'in FATİH projesinde hangi alım aşamasında (faz) alındığı ve markası (Faz 2'de işlemci " +
        "üreticisi Intel/AMD — bakım ve sürücüleri ayrıdır). Ankamon bunu anakart modelinden, o okunamadıysa MAC adresinin " +
        "ilk kısmından, ülke çapındaki ETAP tahta envanterine bakarak bulur. '(tahmin)': eşleme kesin değil. " +
        "'ETAP cihazı': ETAP kurulu ama akıllı tahta olduğu bilinmeyen cihaz (ör. laboratuvar bilgisayarı).",
      session: "Cihazda şu an kim oturum açmış. Ankamon 30 saniyede bir SSH ile cihaza sorar. '(kilitli)': ekran kilitli; " +
        "'Oturum kapalı': giriş ekranında bekliyor.",
      wifi: "Cihazın Wi-Fi kartı açık mı, bir ağa bağlı mı. Donanım bilgisi toplanırken SSH ile cihaza sorulur.",
      cable: "Cihaz yerel ağa kabloyla bağlı mı. Cihazın ağ kartlarının durumu SSH ile okunur; okunamazsa logların " +
        "hangi karttan geldiğine bakılır.",
      sound: "Bilgisayarın sesi açık mı, düzeyi kaç. Ankamon 30 saniyede bir SSH ile oturum açık kullanıcının ses ayarına bakar. " +
        "'Kapalı': ses kapatılmış (sessizde). Oturum yoksa ya da ekran kapalıyken (ses çıkışı görünmez) boş kalır. " +
        "Komut çalıştır ▸ Ses ile kapatılıp kısılabilir.",
      disk_total: "Cihazın disk kapasitesi. Cihaz ilk tanındığında SSH ile donanım bilgisi toplanırken okunur.",
      ram_total: "Cihazın bellek (RAM) miktarı. Donanım bilgisi toplanırken SSH ile okunur.",
      bios: "Anakartın yazılımı olan BIOS'un sürümü. Donanım bilgisi toplanırken cihazın kendisinden okunur.",
      kernel: "Cihazdaki Linux çekirdeğinin (işletim sisteminin kalbi) sürümü. SSH ile cihaza sorulur.",
      board_model: "Cihazın içindeki anakartın modeli. Donanım bilgisi toplanırken cihazın kendisinden okunur.",
      cpu_model: "Cihazın işlemci modeli. Donanım bilgisi toplanırken cihazın kendisinden okunur.",
      cpu_phys_cores: "İşlemcinin gerçek (fiziksel) çekirdek sayısı. Donanım bilgisi toplanırken okunur.",
      cpu: "İşlemcinin şu an yüzde kaçının kullanıldığı. Cihazdaki ölçüm programından (node_exporter) son 5 dakikanın verisiyle hesaplanır.",
      mem: "Belleğin (RAM) yüzde kaçının dolu olduğu. Cihazdaki ölçüm programından (node_exporter) okunur.",
      disk: "Sistem diskinin yüzde kaçının dolu olduğu. Cihazdaki ölçüm programından (node_exporter) okunur.",
      net_rx: "Cihazın ağdan indirdiği veri hızı (Mbit/sn). Cihazdaki ölçüm programının ağ sayaçlarındaki artıştan hesaplanır.",
      net_tx: "Cihazın ağa gönderdiği veri hızı (Mbit/sn). Cihazdaki ölçüm programının ağ sayaçlarındaki artıştan hesaplanır.",
      temp: "İşlemcinin sıcaklığı. Cihazdaki ölçüm programı işlemcinin kendi sıcaklık sensörünü okur.",
      case_temp: "Kasanın (anakartın) sıcaklığı. Anakart sensörü varsa o, yoksa sistemin genel sıcaklık bölgesi okunur.",
      disk_temp: "Diskin sıcaklığı. Diskin kendi sağlık bilgisinden (SMART) okunur.",
      fan_rpm: "Fanın dakikadaki dönüş sayısı. Anakart sensör sürücüsü yüklüyse ('Metrik izlemeyi kur') okunur.",
      battery_v: "Anakarttaki saat pilinin (CMOS) voltajı. Düşükse (yaklaşık 2,8 V altı) tarih/BIOS ayarları kaybolabilir; anakart sensöründen okunur.",
      sensors: "Bu cihazdan sensör verisi (işlemci, bellek, disk, sıcaklık, fan…) geliyor mu? 'Metrik izlemeyi kur' ile cihaza " +
        "kurulan ölçüm programı (node_exporter) dakikada bir okunur. Var: son 24 saatte veri geldi. Yok: gelmedi (program " +
        "kurulu değil ya da cihaz kapalı).",
      seen: "Cihazın en son görüldüğü an (ağ taraması, SSH ya da log ile).",
      log: "Cihazın Ankamon'a en son log (olay kaydı) gönderdiği an. Cihaz sistem loglarını ağ üzerinden Ankamon'a yollar.",
      location: "Cihazın okulda durduğu yer. Tesis Envanteri kodu il.ilçe.tesis.bina.kat.salon ile yazılır (ör. 55.11.165.1.2.15 " +
        "= 55 il, 11 ilçe, 165 okul, 1. bina, 2. kat, 15. salon); kod bilinmiyorsa düz yazı da olur. Ankamon bunu kendisi " +
        "bulamaz: Cihaz ayrıntıları penceresinde elle girilir. Akıllı tahtada Varlıklar ve Akıllı Tahtalar aynı değeri gösterir."
    },

    /**
     * Sütun tanımlarına cellHint koyar (varsa dokunmaz). extra: sayfaya özel, satırdan üretilen ek satır
     * ((rowData, value) → metin|null) — açıklamanın ÜSTÜNE yazılır (ör. "Son sensör verisi: 3 dk önce").
     */
    apply(columns, hints, extra = {}) {
      columns.forEach(column => {
        const text = hints[column.id];
        const more = extra[column.id];
        if (column.cellHint || (!text && !more)) {
          return;
        }
        column.cellHint = more ? (row, value) => [more(row, value), text].filter(Boolean).join("\n\n") || null : text;
      });
      return columns;
    }
  }
});
