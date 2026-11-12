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
        "(web arayüzü, yazıcı ya da kamera protokolü) ya da tahtaların donanım bilgisinden alınır.",
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
      lastlog: "Cihazın Ankamon'a en son log (olay kaydı) gönderdiği an. Tahtalar sistem loglarını ağ üzerinden " +
        "Ankamon'a yollar (syslog); hiç göndermeyen cihazda boş kalır.",
      discovery: "Cihazın listeye hangi yollarla girdiği: Ağ taraması (sunucu ağda buldu), Log gönderimi (cihaz kendisi " +
        "log yolladı), Elle eklendi (siz eklediniz), Ankamon sunucusu (sunucunun kendisi). İlk yazılan, ilk giriş yoludur.",
      notes: "Bu cihaz için sizin yazdığınız serbest not (Düzenle penceresinden). Ankamon kendisi bir şey yazmaz.",
      faz: "Akıllı tahtanın hangi FATİH projesi aşamasında (faz) alındığı ve markası. Anakart modelinden, o yoksa MAC " +
        "adresinin ilk kısmından, ülke çapındaki tahta envanterine bakılarak bulunur.",
      activity: "Cihazın ağı ne kadar kullandığı, 0–100 arası göreli puan (şu an en yoğun cihaz = 100). Ankamon ağdaki " +
        "trafiği dışarıdan izleyerek ölçer; cihaza bir şey kurulmaz.",
      activity_detail: "Ağ etkinliğinin ayrıntısı: saniyedeki veri miktarı (kbit/sn) ve en çok kullanılan protokol. Trafik " +
        "görünmüyorsa Windows cihazların gönderdiği paket sayısından tahmin edilir; 'sakin' = belirgin trafik yok.",
      sensors: "Bu cihazdan sensör verisi (işlemci, bellek, disk, sıcaklık, fan…) geliyor mu? Cihaza 'Metrik izlemeyi kur' " +
        "ile küçük bir ölçüm programı (node_exporter) kurulur; Ankamon onu dakikada bir okur. Var: son 24 saatte veri geldi. " +
        "Yok: veri gelmedi (program kurulu değil, cihaz kapalı ya da yönetilen bir cihaz değil)."
    },

    /** Ağ ▸ Akıllı Tahtalar (page.Boards) — Varlıklar'ın akıllı tahta alt kümesi. */
    BOARDS: {
      status: "Tahta şu an ağda mı? Varlıklar'daki durumla aynıdır: ağ taraması tahtayı görüyorsa ya da SSH yanıt " +
        "veriyorsa 'Çevrimiçi', görülmüyorsa 'Kapalı'.",
      manageable: "Ankamon bu tahtayı uzaktan yönetebiliyor mu? Ankamon tahtaya SSH ile yönetici (root) olarak bağlanmayı " +
        "dener. Evet: son 3 dakikada bağlandı. Hayır (parola): tahta yanıt veriyor ama parola kabul edilmiyor. Hayır: yanıt yok.",
      name: "Tahtanın adı: verdiğiniz takma ad, yoksa tahtanın bilgisayar adı ya da IP adresi.",
      hostname: "Tahtanın kendine verdiği ad (ör. etap-8ab8fb). Tahtanın gönderdiği loglardan ya da SSH ile sorularak öğrenilir.",
      ip: "Tahtanın ağdaki şu anki adresi. Tahtanın MAC'i ağ taramasında hangi adreste görülürse o yazılır (DHCP adresi değiştirebilir).",
      mac: "Kablolu ağ kartının fabrika kimliği. Tahta bu adresle tanınır; kapalı tahtayı uzaktan açmak (Wake-on-LAN) da bununla yapılır.",
      wifi_mac: "Kablosuz (Wi-Fi) kartın fabrika kimliği. Tahtaya SSH ile bağlanılıp kartın kalıcı adresi okunur " +
        "(Wi-Fi taramalarında görünen rastgele adres değil).",
      faz: "Tahtanın hangi FATİH aşamasında (faz) alındığı ve markası — anakart modelinden ya da MAC adresinin ilk " +
        "kısmından, ülke çapındaki tahta envanterine bakılarak bulunur.",
      session: "Tahtada şu an kim oturum açmış. Ankamon 30 saniyede bir SSH ile tahtaya sorar. '(kilitli)': ekran kilitli; " +
        "'Oturum kapalı': giriş ekranında bekliyor.",
      wifi: "Tahtanın Wi-Fi kartı açık mı, bir ağa bağlı mı. Donanım bilgisi toplanırken SSH ile tahtaya sorulur.",
      cable: "Tahta yerel ağa kabloyla bağlı mı. Tahtanın ağ kartlarının durumu SSH ile okunur; okunamazsa logların " +
        "hangi karttan geldiğine bakılır.",
      disk_total: "Tahtanın disk kapasitesi. Tahta ilk tanındığında SSH ile donanım bilgisi toplanırken okunur.",
      ram_total: "Tahtanın bellek (RAM) miktarı. Donanım bilgisi toplanırken SSH ile okunur.",
      bios: "Anakartın yazılımı olan BIOS'un sürümü. Donanım bilgisi toplanırken tahtanın kendisinden okunur.",
      kernel: "Tahtadaki Linux çekirdeğinin (işletim sisteminin kalbi) sürümü. SSH ile tahtaya sorulur.",
      board_model: "Tahtanın içindeki anakartın modeli. Donanım bilgisi toplanırken tahtanın kendisinden okunur.",
      cpu_model: "Tahtanın işlemci modeli. Donanım bilgisi toplanırken tahtanın kendisinden okunur.",
      cpu_phys_cores: "İşlemcinin gerçek (fiziksel) çekirdek sayısı. Donanım bilgisi toplanırken okunur.",
      cpu: "İşlemcinin şu an yüzde kaçının kullanıldığı. Tahtadaki ölçüm programından (node_exporter) son 5 dakikanın verisiyle hesaplanır.",
      mem: "Belleğin (RAM) yüzde kaçının dolu olduğu. Tahtadaki ölçüm programından (node_exporter) okunur.",
      disk: "Sistem diskinin yüzde kaçının dolu olduğu. Tahtadaki ölçüm programından (node_exporter) okunur.",
      net_rx: "Tahtanın ağdan indirdiği veri hızı (Mbit/sn). Tahtadaki ölçüm programının ağ sayaçlarındaki artıştan hesaplanır.",
      net_tx: "Tahtanın ağa gönderdiği veri hızı (Mbit/sn). Tahtadaki ölçüm programının ağ sayaçlarındaki artıştan hesaplanır.",
      temp: "İşlemcinin sıcaklığı. Tahtadaki ölçüm programı işlemcinin kendi sıcaklık sensörünü okur.",
      case_temp: "Kasanın (anakartın) sıcaklığı. Anakart sensörü varsa o, yoksa sistemin genel sıcaklık bölgesi okunur.",
      disk_temp: "Diskin sıcaklığı. Diskin kendi sağlık bilgisinden (SMART) okunur.",
      fan_rpm: "Fanın dakikadaki dönüş sayısı. Anakart sensör sürücüsü yüklüyse ('Metrik izlemeyi kur') okunur.",
      battery_v: "Anakarttaki saat pilinin (CMOS) voltajı. Düşükse (yaklaşık 2,8 V altı) tarih/BIOS ayarları kaybolabilir; anakart sensöründen okunur.",
      sensors: "Bu tahtadan sensör verisi (işlemci, bellek, disk, sıcaklık, fan…) geliyor mu? 'Metrik izlemeyi kur' ile tahtaya " +
        "kurulan ölçüm programı (node_exporter) dakikada bir okunur. Var: son 24 saatte veri geldi. Yok: gelmedi (program " +
        "kurulu değil ya da tahta kapalı).",
      seen: "Tahtanın en son görüldüğü an (ağ taraması, SSH ya da log ile).",
      log: "Tahtanın Ankamon'a en son log (olay kaydı) gönderdiği an. Tahta sistem loglarını ağ üzerinden Ankamon'a yollar."
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
