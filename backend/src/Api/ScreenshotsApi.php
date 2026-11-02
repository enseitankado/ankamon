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
use Ankamon\Core\Storage;

/**
 * Ekran görüntüleri (bkz. worker executor/screenshot.py): zaman çizelgesi listesi, görüntüyü verme (nginx
 * X-Accel-Redirect) ve Disk kullanımı sekmesi. Dosyalar /data/screenshots altında, sahibi PHP'nin kullanıcısı.
 */
final class ScreenshotsApi
{
    private const BASE_DIR = '/data/screenshots';

    public function index(Request $request): array
    {
        return ['screenshots' => Db::all(
            "SELECT id, board_id, board_name, session_username, taken_by, bytes,
                    extract(epoch FROM taken_at)::bigint AS taken_at
             FROM screenshots ORDER BY taken_at DESC LIMIT 5000"
        )];
    }

    public function image(Request $request): array
    {
        $row = Db::one('SELECT file FROM screenshots WHERE id = ?', [$request->arg('id')]) ?? throw ApiError::notFound();
        if (!is_file(self::BASE_DIR . '/' . $row['file'])) {
            throw ApiError::notFound('Görüntü dosyası bulunamadı.');
        }
        header('Content-Type: image/jpeg');
        header('Cache-Control: private, max-age=86400');
        header('X-Accel-Redirect: /_screenshots/' . $row['file']);
        exit;
    }

    public function deleteOne(Request $request, array $user): array
    {
        $id = $request->arg('id');
        $row = Db::one('SELECT board_name, file FROM screenshots WHERE id = ?', [$id]) ?? throw ApiError::notFound();
        @unlink(self::BASE_DIR . '/' . $row['file']);
        Db::exec('DELETE FROM screenshots WHERE id = ?', [$id]);
        Audit::log($user, $request, 'screenshots.delete', $row['board_name'], ['id' => $id]);
        return ['ok' => true, 'deleted' => 1];
    }

    /** Disk kullanımı: tahta (ad) başına adet, ilk/son ve gerçek dosya boyutu. */
    public function stats(Request $request): array
    {
        $boards = Db::all(
            "SELECT board_id, board_name AS name, count(*) AS n, coalesce(sum(bytes), 0) AS bytes,
                    (extract(epoch FROM min(taken_at)) * 1000)::bigint AS first,
                    (extract(epoch FROM max(taken_at)) * 1000)::bigint AS last
             FROM screenshots GROUP BY board_id, board_name ORDER BY bytes DESC"
        );
        return [
            'boards' => $boards,
            'total' => [
                'n' => array_sum(array_column($boards, 'n')),
                'bytes' => array_sum(array_column($boards, 'bytes')),
                'first' => $boards ? min(array_column($boards, 'first')) : null,
                'last' => $boards ? max(array_column($boards, 'last')) : null,
            ],
            'dir' => self::BASE_DIR,
            'disk' => Storage::diskSpace(),
        ];
    }

    /** Kalıcı silme: name=<kayıttaki tahta adı> ya da all=1. Geri alınamaz; audit_log'a yazılır. */
    public function delete(Request $request, array $user): array
    {
        if ($request->query('all') === '1') {
            $rows = Db::all('SELECT id, file FROM screenshots');
            $scope = 'tümü';
        } else {
            $scope = (string) $request->query('name', '');
            if ($scope === '') {
                throw ApiError::badRequest('Silinecek kapsam seçilmedi.');
            }
            $rows = Db::all('SELECT id, file FROM screenshots WHERE board_name = ?', [$scope]);
        }
        foreach ($rows as $row) {
            @unlink(self::BASE_DIR . '/' . $row['file']);
        }
        if ($rows) {
            Db::exec('DELETE FROM screenshots WHERE id = ANY(?::bigint[])', ['{' . implode(',', array_column($rows, 'id')) . '}']);
        }
        Audit::log($user, $request, 'screenshots.delete', $scope, ['deleted' => count($rows)]);
        return ['ok' => true, 'deleted' => count($rows)];
    }
}
