<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\Db;
use Tihamon\Core\Request;
use Tihamon\Core\Supervisor;

/**
 * Sistem ▸ Yazılımlar (yalnız yönetici): konteynerdeki kritik yazılımlar, sürümleri, durumları ve
 * Tiha-Mon'da hangi işlevi sağladıkları. Sürümler imaj üretilirken toplanır
 * (docker/rootfs/software-versions.py → /opt/tiha-mon/software-versions.json); veritabanı sunucusu ve
 * TimescaleDB eklentisinin sürümü canlı okunur (imaj güncellenip eklenti henüz yükseltilmediyse farkı
 * göstersin diye). Durum: bileşen bir supervisord servisiyse onun anlık durumu, değilse kurulu olup olmadığı.
 */
final class SoftwareApi
{
    private const VERSIONS_FILE = '/opt/tiha-mon/software-versions.json';

    // [kategori, ad, Tiha-Mon'daki işlevi, sürüm anahtarı, servis (supervisord programı) ya da null, adres]
    private const COMPONENTS = [
        ['Temel', 'Alpine Linux', 'Konteynerin işletim sistemi; paketler (PHP, nginx, Grafana…) onun deposundan gelir.',
            'alpine', null, 'https://alpinelinux.org'],
        ['Temel', 'supervisord', 'Konteyner içindeki tüm servisleri başlatır, çökeni yeniden başlatır (Sistem ▸ Servisler).',
            'supervisor', null, 'http://supervisord.org'],
        ['Veri', 'PostgreSQL', 'Ana veritabanı: tahtalar, loglar, sensör verisi, oturumlar, görevler, kullanıcılar ve ayarlar.',
            'db:server', 'postgres', 'https://www.postgresql.org'],
        ['Veri', 'TimescaleDB', 'Loglar ve sensör verisi için zaman serisi tabloları: sıkıştırma, saklama süresi ve özetleme (disk tasarrufu).',
            'db:timescaledb', 'postgres', 'https://www.timescale.com'],
        ['Web', 'nginx', 'Web sunucusu: arayüz ve API (HTTPS), Grafana, web terminal, ekran izleme, dosya yöneticisi ve yansıtma vekili; erişim denetimi.',
            'nginx', 'nginx', 'https://nginx.org'],
        ['Web', 'PHP (FPM)', 'REST API: arayüzün tüm istekleri, oturum açma, yetkiler, ayarlar, görev kuyruğu.',
            'php84', 'php-fpm', 'https://www.php.net'],
        ['Web', 'qooxdoo', 'Web arayüzünün çatısı (pencereler, tablolar, menüler, temalar); imaj üretilirken derlenir.',
            'qooxdoo', null, 'https://qooxdoo.org'],
        ['Web', 'vis-timeline', 'Oturumlar ▸ Kullanıcılar zaman çizelgesi.', 'vis-timeline', null, 'https://visjs.org'],
        ['Log ve sensör', 'rsyslog', 'Merkezi log sunucusu: tahtaların sistem loglarını 514/tcp+udp\'den alıp veritabanına yazar.',
            'rsyslog', 'rsyslog', 'https://www.rsyslog.com'],
        ['Log ve sensör', 'Telegraf', 'Tahtalardaki node_exporter\'dan sensör verisini (işlemci, bellek, sıcaklık, disk, ağ) toplar.',
            'telegraf', 'telegraf', 'https://www.influxdata.com/time-series-platform/telegraf/'],
        ['Log ve sensör', 'Grafana', 'Bakım ▸ Sensörler grafikleri (çevrim içi tahtalar ve tahta ayrıntısı panoları).',
            'grafana', 'grafana', 'https://grafana.com'],
        ['Görevler', 'Python', 'Arka plan görevleri: tahta keşfi ve durumu, oturumlar, görev yürütücü, ağ taraması, köprüler.',
            'python3', 'worker', 'https://www.python.org'],
        ['Görevler', 'psycopg', 'Python servislerinin veritabanı bağlantısı.', 'py3-psycopg', null, 'https://www.psycopg.org'],
        ['Görevler', 'Tornado', 'Ekran izleme, görev yöneticisi, dosya yöneticisi köprüleri ve dosya gezgini servisi (HTTP/WebSocket).',
            'py3-tornado', 'screen', 'https://www.tornadoweb.org'],
        ['Görevler', 'Ansible (ansible-core)', 'Seçili tahtalarda komut ve betikleri paralel çalıştırma (Komut çalıştır).',
            'ansible-core', 'runner', 'https://www.ansible.com'],
        ['Uzaktan erişim', 'OpenSSH istemcisi', 'Tahtalara tüm SSH bağlantıları: komutlar, hazır işlemler, oturum yoklaması, ekran ve dosya erişimi.',
            'openssh-client-default', null, 'https://www.openssh.com'],
        ['Uzaktan erişim', 'sshpass', 'SSH parolasını etkileşimsiz verme (görev yürütücü, yedekleme, araç kopyalama).',
            'sshpass', null, 'https://sourceforge.net/projects/sshpass/'],
        ['Uzaktan erişim', 'WebSSH', 'Tahtaya tarayıcıdan web terminal (tek ve çoklu terminal).',
            'webssh', 'webssh', 'https://github.com/huashengdun/webssh'],
        ['Uzaktan erişim', 'noVNC', 'Tarayıcıda canlı tahta ekranı (Ekranlar, Ekranı göster/yönet).',
            'novnc', 'screen', 'https://novnc.com'],
        ['Uzaktan erişim', 'MediaMTX', 'Ekran yansıtma: tarayıcıdan gelen görüntüyü (WebRTC) tahtalara RTSP olarak dağıtır.',
            'mediamtx', 'mediamtx', 'https://github.com/bluenviron/mediamtx'],
        ['Uzaktan erişim', 'FileBrowser Quantum', 'Dosya yöneticisi: tahtanın dosya sisteminde gezinme, indirme, yükleme, kopyalama.',
            'filebrowser', 'filemanager', 'https://github.com/gtsteffaniak/filebrowser'],
        ['Uzaktan erişim', 'sshfs', 'Dosya yöneticisi için tahtanın dosya sistemini sunucuya bağlar.',
            'sshfs', 'filemanager-bridge', 'https://github.com/libfuse/sshfs'],
        ['Ağ', 'arp-scan', 'Ağ envanteri: bağlı ağlardaki cihazları (çevrim içi/dışı) bulur; ağ etkinliği örneklemesi.',
            'arp-scan', 'netscan', 'https://github.com/royhills/arp-scan'],
        ['Ağ', 'Nmap', 'Ağ envanteri: cihazlardaki açık portlar, servisler ve sürümleri, işletim sistemi tahmini.',
            'nmap', 'netscan', 'https://nmap.org'],
        ['Ağ', 'Samba istemcisi (smbclient)', 'Ağ envanteri: cihazların paylaşılan klasör ve yazıcılarını listeler.',
            'samba-client', 'netscan', 'https://www.samba.org'],
        ['Ağ', 'Wireshark üretici tablosu (manuf)', 'MAC adresinden cihaz üreticisini bulur (ağ envanteri, tahta listesi); sürüm = indirildiği gün.',
            'manuf', null, 'https://www.wireshark.org'],
        ['Güvenlik', 'OpenSSL', 'HTTPS sertifikası ve yerel sertifika yetkilisinin üretimi.', 'openssl', null, 'https://www.openssl.org'],
    ];

    public function index(Request $request): array
    {
        $file = @file_get_contents(self::VERSIONS_FILE);
        $build = $file !== false ? (json_decode($file, true) ?: []) : [];
        $versions = $build['versions'] ?? [];
        $versions['db:server'] = (string) Db::value('SHOW server_version');
        $versions['db:timescaledb'] = (string) Db::value("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'");

        $states = [];
        try {
            foreach (Supervisor::processes() as $p) {
                $states[$p['name']] = $p['statename'];
            }
        } catch (\Throwable $e) {
            // supervisord okunamadı: durum sütunu "bilinmiyor" kalır, sürümler yine gösterilir.
        }

        $rows = [];
        foreach (self::COMPONENTS as [$category, $name, $role, $key, $service, $url]) {
            $version = (string) ($versions[$key] ?? '');
            $rows[] = [
                'category' => $category,
                'name' => $name,
                'role' => $role,
                'version' => $version,
                'service' => $service,
                'state' => $service !== null ? ($states[$service] ?? 'UNKNOWN') : ($version !== '' ? 'INSTALLED' : 'MISSING'),
                'url' => $url,
            ];
        }
        return ['components' => $rows, 'built_at' => $build['built_at'] ?? null];
    }
}
