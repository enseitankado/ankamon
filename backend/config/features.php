<?php
/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

// etapadmin'in kullanıcılara tek tek açıp kapatabildiği arayüz özellikleri.
// Kullanıcı ve ayar yönetimi listede yoktur: yalnız yöneticiye açıktır.
$ozellikKatalogu = [
    'dashboard' => 'Genel bakış',
    'boards' => 'Cihazları görüntüleme',
    'boards.manage' => 'Cihaz kayıtlarını ekleme, düzenleme ve silme',
    'logs' => 'Logları görüntüleme',
    'logs.exclude' => 'Loglar grid\'inde önemsiz mesajları dışlama ve dışlamaları kaldırma (tüm kullanıcılar için gizler, kayıt silinmez)',
    'logs.manage' => 'Disk kullanımı: logları, sensör verilerini, görev kayıtlarını ve yedekleri kalıcı olarak silme (Loglar sayfasında)',
    'metrics' => 'Sensörler (Grafana grafikleri)',
    'actions' => 'Uzaktan hazır işlemleri çalıştırma',
    'power' => 'Cihazları açma, kapatma, yeniden başlatma',
    'shell' => 'Cihazlarda serbest komut çalıştırma',
    'screen' => 'Cihaz ekranlarını canlı izleme',
    'screen.control' => 'Cihaz ekranını uzaktan yönetme (fare/klavye ile müdahale)',
    'screen.lock' => 'Cihaz ekranını kilitleme / kilidini açma (kilitliyken cihazda büyük "Kilitli" yazısı; klavye, fare ve dokunmatik çalışmaz)',
    'cast' => 'Kendi ekranını seçili cihazlara yansıtma (cihazda tam ekran gösterilir)',
    'taskmgr' => 'Görev yöneticisi: cihazdaki işlemleri, performansı, hizmetleri, başlangıç uygulamalarını ve oturumları canlı görme; işlem sonlandırma, öncelik, hizmet başlatma/durdurma, yeni görev çalıştırma (cihazda root yetkisiyle)',
    'filemanager' => 'Cihazın tüm dosya sistemine (root) web üzerinden erişim — gezinme, indirme, yükleme',
    'screen.screenshot' => 'Cihazın ekran görüntüsünü alma (sağ menü Ekran ▸ Ekran görüntüsü al); görüntüler Oturumlar ▸ Zaman çizelgesi\'nde görünür',
    'screen.input' => 'Cihazın klavye, fare ve dokunmatiğini kilitleme / açma (sağ menü Ekran); klavye kilidi ekran klavyesini, fare kilidi dokunmayı da kapatır',
    'screen.relay' => 'Bir cihazın ekranını başka cihazların ekranına aktarma ve durdurma (sağ menü Ekran ▸ Ekranı başka bilgisayara aktar)',
    'boards.chat' => 'Cihazdaki kullanıcıyla sohbet (sağ menü Sohbet); geçmiş Oturumlar ▸ Sohbet geçmişi\'nde görünür',
    'boards.backup' => 'Cihazdaki hesapların ev dizinini (kişisel dosyalar dahil), parola özeti ve PIN anahtarıyla yedekleyip indirme (sağ menü "Yedekle/Geri al")',
    'boards.restore' => 'Yedek dosyasından cihazda kullanıcı hesabını, ev dizinini ve PIN anahtarını yeniden oluşturma (sağ menü "Yedekle/Geri al" ▸ Geri al) — yüklenen dosya cihaza root olarak yazılır',
    'anomalies' => 'Anomaliler: cihazlardaki sıra dışı durumları (ör. açık ama oturum açılmamış cihaz) anlık izleme ve geçmişe dönük raporlama',
    'anomalies.notify' => 'Anomaliler ▸ Bildirimler: ntfy konusunu ve bildirim kurallarını düzenleme, bildirim geçmişini silme — bildirim metni dış sunucuya gider',
    'screen.web' => 'Oturumu açık cihazda varsayılan tarayıcıyla web sitesi açma (sağ menü "Web sitesi aç")',
    'boards.webfilter' => 'ETAP Pardus cihazlarda eta-kisit ile kara/beyaz liste web filtresi tanımlama, kapatma, adres başına ziyaret ve engel sayılarını görme (sağ menü "Web Filtre")',
    'diagnose' => 'Bakım (sorun tespiti): seçili cihazlarda donanım, disk sağlığı (SMART), sıcaklık ve sistem denetimi çalıştırma',
    'boards.users' => 'Cihaza kullanıcı hesabı ekleme (hazır işlem "Kullanıcı ekle") ve hesapları silme, isteğe bağlı tüm dosyalarıyla (sağ menü "Kullanıcılar ▸ Kullanıcı sil…" ve hazır işlem "Kullanıcı sil") — silme geri alınamaz',
    'boards.passwords' => 'Cihazdaki kullanıcı hesaplarının parolasını ayarlama, tek tek ya da topluca (sağ menü "Kullanıcılar ▸ Parola ayarla…" ve hazır işlem "Kullanıcı parolası ayarla") — etapadmin ve root hariç',
    'boards.passwords.etapadmin' => 'Cihazın yönetici hesabı etapadmin\'in parolasını ayarlama',
    'boards.passwords.root' => 'Cihazın root parolasını ayarlama — Ankamon cihazlara root ile bağlanır; yeni parola cihaza özel kaydedilir, bağlantı onunla sürer',
    'boards.login' =>'Cihazda seçilen hesapla parolasız oturum açma (sağ menü "Oturum aç" — açık oturum kapanır)',
    'network' => 'Ağ envanteri: bağlı ağlardaki çevrim içi/dışı cihazları ve açık servislerini görüntüleme',
    'network.manage' => 'Ağ envanterinde cihaz ekleme, düzenleme, silme; ağ adı/tarama ayarı; taramayı hemen başlatma',
    'logins' => 'Ankamon oturumlarını görme (Kullanıcılar ▸ Oturumlar): kim, ne zaman, hangi IP\'den giriş/çıkış yaptı, hangi işlemleri yaptı; alt çubukta oturum açmış kullanıcıların ayrıntısı',
    'sessions.manage' => 'Kullanıcı oturum kayıtlarını silme (Kullanıcı oturumları sayfasında, süzgece göre)',
    'leagues.exclude' => 'Ligler ▸ Kullanım sıralaması / Ders arası sıralaması: görev gereği sürekli açık kalan cihazları ve kullanıcıları sıralama dışı bırakma, listeyi düzenleme (herkesin sıralama görünümünü değiştirir, veri silinmez)',
    'sessions.hosts' => 'Oturumlar ▸ Kullanıcılar zaman çizelgesinde Cihazlar\'a kayıtlı olmayan bilgisayarın kayıtlarını silme (satırın sağ menüsü: oturumlar, açık/kapalı aralıkları, isteğe bağlı ham logları)',
];

// Eklentilerin kendi yetkileri: ext/<ad>/features.php aynı biçimde dizi döndürür (çekirdek hiçbir eklentiyi adıyla
// bilmez). Çekirdek anahtarı ezilemez; etkin olmayan eklentinin yetkisi de listelenir (yönetici önceden verebilsin).
foreach (glob(\Ankamon\Core\Extensions::dir() . '/*/features.php') ?: [] as $eklentiDosyasi) {
    $ozellikKatalogu += (array) require $eklentiDosyasi;
}
return $ozellikKatalogu;
