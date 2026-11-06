<?php
/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

// etapadmin'in kullanıcılara tek tek açıp kapatabildiği arayüz özellikleri.
// Kullanıcı ve ayar yönetimi listede yoktur: yalnız yöneticiye açıktır.
return [
    'dashboard' => 'Genel bakış',
    'boards' => 'Tahtaları görüntüleme',
    'boards.manage' => 'Tahta kayıtlarını ekleme, düzenleme ve silme',
    'logs' => 'Logları görüntüleme',
    'logs.exclude' => 'Loglar grid\'inde önemsiz mesajları dışlama ve dışlamaları kaldırma (tüm kullanıcılar için gizler, kayıt silinmez)',
    'logs.manage' => 'Disk kullanımı: logları, sensör verilerini, görev kayıtlarını ve yedekleri kalıcı olarak silme (Loglar sayfasında)',
    'metrics' => 'Sensörler (Grafana grafikleri)',
    'actions' => 'Uzaktan hazır işlemleri çalıştırma',
    'power' => 'Tahtaları açma, kapatma, yeniden başlatma',
    'shell' => 'Tahtalarda serbest komut çalıştırma',
    'screen' => 'Tahta ekranlarını canlı izleme',
    'screen.control' => 'Tahta ekranını uzaktan yönetme (fare/klavye ile müdahale)',
    'screen.lock' => 'Tahta ekranını kilitleme / kilidini açma (kilitliyken tahtada büyük "Kilitli" yazısı; klavye, fare ve dokunmatik çalışmaz)',
    'cast' => 'Kendi ekranını seçili tahtalara yansıtma (tahtada tam ekran gösterilir)',
    'taskmgr' => 'Görev yöneticisi: tahtadaki işlemleri, performansı, hizmetleri, başlangıç uygulamalarını ve oturumları canlı görme; işlem sonlandırma, öncelik, hizmet başlatma/durdurma, yeni görev çalıştırma (tahtada root yetkisiyle)',
    'filemanager' => 'Tahtanın tüm dosya sistemine (root) web üzerinden erişim — gezinme, indirme, yükleme',
    'screen.screenshot' => 'Tahtanın ekran görüntüsünü alma (sağ menü Ekran ▸ Ekran görüntüsü al); görüntüler Oturumlar ▸ Zaman çizelgesi\'nde görünür',
    'screen.input' => 'Tahtanın klavye, fare ve dokunmatiğini kilitleme / açma (sağ menü Ekran); klavye kilidi ekran klavyesini, fare kilidi dokunmayı da kapatır',
    'screen.relay' => 'Bir tahtanın ekranını başka tahtaların ekranına aktarma ve durdurma (sağ menü Ekran ▸ Ekranı başka bilgisayara aktar)',
    'boards.chat' => 'Tahtadaki kullanıcıyla sohbet (sağ menü Sohbet); geçmiş Oturumlar ▸ Sohbet geçmişi\'nde görünür',
    'boards.backup' => 'Tahtadaki hesapların ev dizinini (kişisel dosyalar dahil), parola özeti ve PIN anahtarıyla yedekleyip indirme (sağ menü "Yedekle/Geri al")',
    'boards.restore' => 'Yedek dosyasından tahtada kullanıcı hesabını, ev dizinini ve PIN anahtarını yeniden oluşturma (sağ menü "Yedekle/Geri al" ▸ Geri al) — yüklenen dosya tahtaya root olarak yazılır',
    'anomalies' => 'Anomaliler: tahtalardaki sıra dışı durumları (ör. açık ama oturum açılmamış tahta) anlık izleme ve geçmişe dönük raporlama',
    'anomalies.notify' => 'Anomaliler ▸ Bildirimler: ntfy konusunu ve bildirim kurallarını düzenleme, bildirim geçmişini silme — bildirim metni dış sunucuya gider',
    'screen.web' => 'Oturumu açık tahtada varsayılan tarayıcıyla web sitesi açma (sağ menü "Web sitesi aç")',
    'boards.webfilter' => 'ETAP Pardus tahtalarda eta-kisit ile kara/beyaz liste web filtresi tanımlama, kapatma, adres başına ziyaret ve engel sayılarını görme (sağ menü "Web Filtre")',
    'diagnose' => 'Bakım (sorun tespiti): seçili tahtalarda donanım, disk sağlığı (SMART), sıcaklık ve sistem denetimi çalıştırma',
    'boards.users' => 'Tahtaya kullanıcı hesabı ekleme (hazır işlem "Kullanıcı ekle") ve hesapları silme, isteğe bağlı tüm dosyalarıyla (sağ menü "Kullanıcılar ▸ Kullanıcı sil…" ve hazır işlem "Kullanıcı sil") — silme geri alınamaz',
    'boards.passwords' => 'Tahtadaki kullanıcı hesaplarının parolasını ayarlama, tek tek ya da topluca (sağ menü "Kullanıcılar ▸ Parola ayarla…" ve hazır işlem "Kullanıcı parolası ayarla") — etapadmin ve root hariç',
    'boards.passwords.etapadmin' => 'Tahtanın yönetici hesabı etapadmin\'in parolasını ayarlama',
    'boards.passwords.root' => 'Tahtanın root parolasını ayarlama — Ankamon tahtalara root ile bağlanır; yeni parola tahtaya özel kaydedilir, bağlantı onunla sürer',
    'boards.login' =>'Tahtada seçilen hesapla parolasız oturum açma (sağ menü "Oturum aç" — açık oturum kapanır)',
    'network' => 'Ağ envanteri: bağlı ağlardaki çevrim içi/dışı cihazları ve açık servislerini görüntüleme',
    'network.manage' => 'Ağ envanterinde cihaz ekleme, düzenleme, silme; ağ adı/tarama ayarı; taramayı hemen başlatma',
    'logins' => 'Ankamon oturumlarını görme (Kullanıcılar ▸ Oturumlar): kim, ne zaman, hangi IP\'den giriş/çıkış yaptı, hangi işlemleri yaptı; alt çubukta oturum açmış kullanıcıların ayrıntısı',
    'sessions.manage' => 'Kullanıcı oturum kayıtlarını silme (Kullanıcı oturumları sayfasında, süzgece göre)',
    'leagues.exclude' => 'Ligler ▸ Kullanım sıralaması / Ders arası sıralaması: görev gereği sürekli açık kalan tahtaları ve kullanıcıları sıralama dışı bırakma, listeyi düzenleme (herkesin sıralama görünümünü değiştirir, veri silinmez)',
    'sessions.hosts' => 'Oturumlar ▸ Kullanıcılar zaman çizelgesinde Tahtalar\'a kayıtlı olmayan bilgisayarın kayıtlarını silme (satırın sağ menüsü: oturumlar, açık/kapalı aralıkları, isteğe bağlı ham logları)',
];
