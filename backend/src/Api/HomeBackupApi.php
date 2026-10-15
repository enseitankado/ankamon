<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\ApiError;
use Tihamon\Core\Audit;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

/**
 * "Yedekle" görevinin ürettiği ev dizini arşivlerinin indirilmesi (bkz. worker executor/backup.py:
 * /data/home-backups/job-<görev>/<dosya>.tar.gz). Yalnız "boards.backup" yetkisiyle ve yalnız görevi
 * başlatan kullanıcı (ya da yönetici) indirebilir. Dosyayı PHP okumaz: denetimden sonra nginx'e
 * X-Accel-Redirect ile devredilir (bkz. nginx-default.conf /_home-backups/) — çok büyük arşivler
 * php-fpm süresine/belleğine takılmaz, kaldığı yerden indirme (Range) de nginx'te çalışır.
 */
final class HomeBackupApi
{
    private const BASE_DIR = '/data/home-backups';

    public function download(Request $request, array $user): array
    {
        $jobId = $request->arg('id');
        $job = Db::one("SELECT id, type, created_by FROM jobs WHERE id = ? AND type = 'backup_home'", [$jobId])
            ?? throw ApiError::notFound();
        if (!$user['is_admin'] && $job['created_by'] !== $user['id']) {
            throw ApiError::forbidden();
        }
        $file = (string) $request->query('file', '');
        if (!preg_match('/^[A-Za-z0-9._-]{1,160}\.tar\.gz$/', $file)) {
            throw ApiError::badRequest('Geçersiz dosya adı.');
        }
        $path = self::BASE_DIR . "/job-$jobId/$file";
        if (!is_file($path)) {
            throw ApiError::notFound('Yedek dosyası bulunamadı (süresi dolup silinmiş olabilir).');
        }
        Audit::log($user, $request, 'backup.download', $file, ['job_id' => $jobId]);

        header('Content-Type: application/gzip');
        header('Content-Disposition: attachment; filename="' . $file . '"');
        header('X-Accel-Redirect: /_home-backups/job-' . $jobId . '/' . rawurlencode($file));
        exit;
    }
}
