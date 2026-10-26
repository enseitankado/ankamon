<?php
declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Request;
use Ankamon\Core\Supervisor;

/**
 * Sistem sayfası → "Servisler": konteynerdeki arka plan bileşenleri (supervisord programları; bkz.
 * docker/rootfs/supervisord.conf). Yalnız yönetici. Başlat/durdur/yeniden başlat yalnız SERVICES
 * izin listesindeki ve "control" işaretli programlara uygulanır.
 */
final class ServicesApi
{
    // ad → [açıklama, yönetilebilir mi, yönetilemiyorsa nedeni]. Liste dışı programlar gösterilir ama yönetilemez.
    private const SERVICES = [
        'nginx' => ['Web sunucusu: arayüz, API ve Grafana/terminal/ekran vekili (80/443)', false,
            'arayüzün kendisini taşır — buradan durdurulursa sayfa kapanır'],
        'php-fpm' => ['API (PHP) — bu sayfa dahil tüm arayüz istekleri', false,
            'arayüzün kendisini taşır — buradan durdurulursa sayfa kapanır'],
        'postgres' => ['Veritabanı (PostgreSQL + TimescaleDB): loglar, sensör verisi, ayarlar', false,
            'tüm bileşenler ona bağlı — durdurmak tüm sistemi durdurur'],
        'dbinit' => ['Açılışta veritabanı göçleri ve saklama politikaları (tek seferlik)', false,
            'yalnız konteyner açılışında çalışır'],
        'rsyslog' => ['Merkezi log alıcısı: tahtaların sistem logları (514/tcp+udp → veritabanı)', true, null],
        'telegraf' => ['Sensör verisi toplayıcı: tahtaların node_exporter ölçümleri', true, null],
        'grafana' => ['Sensör grafikleri (Grafana)', true, null],
        'worker' => ['Arka plan görevleri: tahta keşfi, durum, oturumlar, kimlik (dakikalık tur)', true, null],
        'runner' => ['Görev yürütücüsü: komut çalıştır, hazır işlemler, kapat/aç, yedekle', true, null],
        'netscan' => ['Ağ envanteri tarayıcısı: bağlı ağlardaki cihazlar (ARP) ve servisleri (nmap), yüke göre zamanlanır', true, null],
        'backup' => ['Rutin veritabanı yedekleri (pg_dump → /data/backups)', true, null],
        'storage-ops' => ['Disk kullanımı penceresinin root gerektiren silmeleri', true, null],
        'webssh' => ['Web terminal (tahtalara SSH)', true, null],
        'screen' => ['Tahta ekranı izleme köprüsü (VNC)', true, null],
        'filemanager' => ['Tahta dosya yöneticisi (web)', true, null],
        'filemanager-bridge' => ['Dosya yöneticisi oturum köprüsü', true, null],
        'mediamtx' => ['Ekran yansıtma aktarıcısı (WHIP → RTSP)', true, null],
    ];

    public function index(Request $request): array
    {
        $now = time();
        $rows = array_map(function (array $p) use ($now) {
            $def = self::SERVICES[$p['name']] ?? null;
            $running = $p['statename'] === 'RUNNING';
            return [
                'name' => $p['name'],
                'description' => $def[0] ?? '',
                'state' => $p['statename'],
                'pid' => $p['pid'] ?: null,
                'uptime' => $running && $p['start'] ? $now - (int) $p['start'] : null,
                'started_at' => $p['start'] ? (int) $p['start'] * 1000 : null,
                'stopped_at' => $p['stop'] ? (int) $p['stop'] * 1000 : null,
                'exit_status' => $running ? null : $p['exitstatus'],
                'spawn_error' => $p['spawnerr'] ?: null,
                'controllable' => (bool) ($def[1] ?? false),
                'locked_reason' => $def === null ? 'izin listesinde değil' : $def[2],
            ];
        }, Supervisor::processes());
        usort($rows, fn($a, $b) => strcmp($a['name'], $b['name']));
        $state = Supervisor::state();
        return ['services' => $rows, 'supervisor' => ['state' => $state['statename'] ?? '', 'version' => Supervisor::version()]];
    }

    /** POST /api/system/services {name, action} — action: start | stop | restart. */
    public function control(Request $request, array $user): array
    {
        $name = (string) $request->input('name', '');
        $action = (string) $request->input('action', '');
        $def = self::SERVICES[$name] ?? throw ApiError::notFound('Bilinmeyen servis.');
        if (!$def[1]) {
            throw ApiError::forbidden("$name buradan yönetilemez: {$def[2]}.");
        }
        if (!in_array($action, ['start', 'stop', 'restart'], true)) {
            throw ApiError::badRequest('Geçersiz işlem.');
        }
        set_time_limit(60);
        $states = array_column(Supervisor::processes(), 'statename', 'name');
        $running = ($states[$name] ?? '') === 'RUNNING';
        if ($action !== 'start' && $running) {
            Supervisor::stop($name);
        }
        if ($action === 'restart' || ($action === 'start' && !$running)) {
            Supervisor::start($name);
        }
        Audit::log($user, $request, 'service.' . $action, $name);
        return ['ok' => true];
    }
}
