<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\ApiError;
use Tihamon\Core\Audit;
use Tihamon\Core\Request;
use Tihamon\Core\Storage;

/**
 * rsyslog'un disk kuyruğu (Disk kullanımı penceresinin "Log kuyruğu" sekmesi) ve kalıcı silme.
 *
 * Tahtalardan gelen loglar veritabanı yazılamadığında /data/rsyslog'daki disk kuyruğunda bekler
 * (tihamon_pg.<parça> + konum dosyası tihamon_pg.qi; bkz. docker/rsyslog/rsyslog.conf). Kuyruk
 * normalde boşa yakındır; büyüyorsa loglar Postgres'e ulaşmıyor demektir. Ayrıca rsyslog.sh açılışta
 * okunamayan (ör. elektrik kesintisinde yarım kalmış) kuyruğu bozuk-<zaman>/ klasörüne kenara alır.
 *
 * Canlı kuyruk parça parça SİLİNEMEZ — konum dosyası eksik parçayı gösterir ve rsyslog kuyruğu
 * başlatamaz; yalnız bütün olarak silinir (rsyslog durdurulup yeniden başlatılır). Silinen kuyruktaki,
 * henüz veritabanına yazılmamış loglar kaybolur. Dizin root'a ait; listeleme PHP'nin okuyabildiği
 * dosya bilgileriyle (stat), silme storage-ops servisiyle yapılır (bkz. Core\Storage::rootRequest).
 */
final class LogQueueStatsApi
{
    private const SPOOL = '/data/rsyslog';
    private const QUARANTINE = '/^bozuk-[0-9]{8}-[0-9]{6}$/';

    public function stats(Request $request): array
    {
        $live = [];
        $quarantine = [];
        foreach (@scandir(self::SPOOL) ?: [] as $name) {
            $path = self::SPOOL . '/' . $name;
            if (str_starts_with($name, 'tihamon_pg.') && is_file($path)) {
                $live[] = self::file($name, $path);
            } elseif (preg_match(self::QUARANTINE, $name) && is_dir($path)) {
                $files = array_map(
                    fn(string $n) => self::file($n, "$path/$n"),
                    array_values(array_filter(@scandir($path) ?: [], fn($n) => is_file("$path/$n")))
                );
                $quarantine[] = [
                    'name' => $name,
                    'files' => count($files),
                    'bytes' => array_sum(array_column($files, 'bytes')),
                    'mtime' => $files ? max(array_column($files, 'mtime')) : (int) filemtime($path) * 1000,
                ];
            }
        }
        usort($live, fn($a, $b) => strcmp($a['name'], $b['name']));
        usort($quarantine, fn($a, $b) => strcmp($b['name'], $a['name']));
        $liveBytes = array_sum(array_column($live, 'bytes'));
        return [
            'live' => [
                'files' => $live,
                'bytes' => $liveBytes,
                'oldest' => $live ? min(array_column($live, 'mtime')) : null,
                'newest' => $live ? max(array_column($live, 'mtime')) : null,
            ],
            'quarantine' => $quarantine,
            'total' => ['bytes' => $liveBytes + array_sum(array_column($quarantine, 'bytes'))],
            'dir' => self::SPOOL,
            'disk' => Storage::diskSpace(),
        ];
    }

    /**
     * Kalıcı silme: names — "live" (bekleyen canlı kuyruğun tamamı) ve/veya bozuk-<zaman> klasörleri
     * (virgüllü), ya da all=1 (canlı kuyruk + bütün bozuk klasörler). Geri alınamaz; audit_log'a yazılır.
     */
    public function delete(Request $request, array $user): array
    {
        if ($request->query('all') === '1') {
            $names = array_merge(['live'], array_column($this->stats($request)['quarantine'], 'name'));
        } else {
            $names = array_values(array_unique(array_filter(explode(',', (string) $request->query('names', '')))));
            foreach ($names as $name) {
                if ($name !== 'live' && !preg_match(self::QUARANTINE, $name)) {
                    throw ApiError::badRequest('Geçersiz kuyruk adı: ' . $name);
                }
            }
            if (!$names) {
                throw ApiError::badRequest('Silinecek kuyruk seçilmedi.');
            }
        }
        $deleted = Storage::rootRequest('logqueue', $names);
        Audit::log($user, $request, 'logqueue.delete', '', ['names' => $names, 'deleted' => $deleted]);
        return ['ok' => true, 'deleted' => $deleted];
    }

    private static function file(string $name, string $path): array
    {
        return ['name' => $name, 'bytes' => (int) @filesize($path), 'mtime' => (int) @filemtime($path) * 1000];
    }
}
