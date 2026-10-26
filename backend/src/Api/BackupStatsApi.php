<?php
declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Request;
use Ankamon\Core\Storage;

/**
 * Yedek dosyaları (Disk kullanımı penceresinin "Yedekler" sekmesi) ve kalıcı silme.
 *
 * Yedek dizini bilerek root'a özel (700 — dökümlerde parola özetleri var), PHP (nobody) onu ne
 * okuyabilir ne de silebilir. Liste, yedek servisinin her dakika (ve her silmeden sonra) yazdığı
 * özetten okunur (bkz. docker/backup/summary.sh); silme root çalışan storage-ops servisine yaptırılır
 * (bkz. Core\Storage::rootRequest). Boyutlar gerçektir, tahmin değildir.
 */
final class BackupStatsApi
{
    private const SUMMARY = '/run/ankamon/backups.json';
    private const NAME = '/^(config|full|grafana)-[0-9]{8}-[0-9]{6}\.dump$/';
    private const KINDS = ['full', 'config', 'grafana'];

    public function stats(Request $request): array
    {
        $raw = @file_get_contents(self::SUMMARY);
        $data = $raw === false ? null : json_decode($raw, true);
        if (!is_array($data) || !isset($data['files'])) {
            throw ApiError::notFound('Yedek özeti bulunamadı (yedekleme servisi çalışmıyor olabilir).');
        }
        $files = array_map(fn(array $f) => [
            'name' => (string) $f['name'],
            'kind' => strtok((string) $f['name'], '-'), // full | config | grafana
            'bytes' => (int) $f['bytes'],
            'mtime' => (int) $f['mtime'] * 1000,
        ], $data['files']);
        usort($files, fn($a, $b) => $b['mtime'] <=> $a['mtime']);
        return [
            'files' => $files,
            'total' => ['n' => count($files), 'bytes' => array_sum(array_column($files, 'bytes'))],
            'dir' => $data['dir'] ?? '/data/backups',
            'keep_full' => (int) ($data['keep_full'] ?? 0),
            'keep_config' => (int) ($data['keep_config'] ?? 0),
            'disk' => Storage::diskSpace(),
        ];
    }

    /**
     * Kalıcı silme: names (virgüllü dosya adları), kind (full|config|grafana — o türün TÜM dosyaları;
     * servis o anki dosyaları siler, arayüzdeki liste eskimiş olsa bile) ya da all=1 (TÜM yedekler). Geri alınamaz;
     * audit_log'a yazılır.
     */
    public function delete(Request $request, array $user): array
    {
        $kind = $request->query('kind');
        if ($request->query('all') === '1') {
            $names = ['*'];
        } elseif ($kind !== null) {
            if (!in_array($kind, self::KINDS, true)) {
                throw ApiError::badRequest('Geçersiz yedek türü: ' . $kind);
            }
            $names = ["$kind:*"];
        } else {
            $names = array_values(array_unique(array_filter(explode(',', (string) $request->query('names', '')))));
            foreach ($names as $name) {
                if (!preg_match(self::NAME, $name)) {
                    throw ApiError::badRequest('Geçersiz yedek dosyası adı: ' . $name);
                }
            }
            if (!$names) {
                throw ApiError::badRequest('Silinecek yedek seçilmedi.');
            }
        }

        $deleted = Storage::rootRequest('backups', $names);
        Audit::log($user, $request, 'backups.delete', '', ['names' => $names, 'deleted' => $deleted]);
        return ['ok' => true, 'deleted' => $deleted];
    }
}
