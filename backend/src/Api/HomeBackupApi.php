<?php
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

declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Db;
use Ankamon\Core\Request;

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
