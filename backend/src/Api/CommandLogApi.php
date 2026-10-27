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
use Ankamon\Core\Db;
use Ankamon\Core\Request;

/**
 * Komut logları: tahtalarda çalıştırılan komutların kaydı; tahta/kullanıcı/zaman/metin ile süzülür.
 * Kaynak "local": tahtadaki kullanıcının kendi sudo/pkexec/su komutu — syslog gelirken tetikleyiciyle
 * kopyalanır (bkz. db/migrations/028_local_command_log.sql), syslog silinse de burada kalır.
 * Sayfalama `offset` + `limit` ile; `more` sonraki sayfayı, `count=1` toplamı bildirir (bkz. LogsApi).
 */
final class CommandLogApi
{
    public function index(Request $request): array
    {
        $where = ['time >= ?::timestamptz', 'time <= ?::timestamptz'];
        $params = [self::commandLogTimeBound($request->query('from'), '-7 days'), self::commandLogTimeBound($request->query('to'), 'now')];

        if ($boardId = $request->query('board_id')) {
            $where[] = 'board_id = ?';
            $params[] = (int) $boardId;
        }
        if ($username = $request->query('username')) {
            $where[] = 'username = ?';
            $params[] = $username;
        }
        if ($source = $request->query('source')) {
            $where[] = 'source = ?';
            $params[] = $source;
        }
        if ($q = $request->query('q')) {
            $where[] = "command ILIKE ? ESCAPE '\\'";
            $params[] = '%' . addcslashes($q, '\\%_') . '%';
        }

        $limit = $request->queryInt('limit', 300, 1, 2000);
        $offset = $request->queryInt('offset', 0, 0, 10000000);
        $rows = Db::all(
            'SELECT (extract(epoch FROM time) * 1000)::bigint AS ts, board_name, username, source, command, exit_code, status
             FROM command_log WHERE ' . implode(' AND ', $where) . '
             ORDER BY time DESC, id DESC LIMIT ' . ($limit + 1) . ' OFFSET ' . $offset,
            $params
        );
        $result = ['logs' => array_slice($rows, 0, $limit), 'more' => count($rows) > $limit];
        if ($request->query('count')) {
            $result['total'] = (int) Db::value(
                'SELECT count(*) FROM command_log WHERE ' . implode(' AND ', $where),
                $params
            );
            $result['total_capped'] = false;
        }
        return $result;
    }

    private static function commandLogTimeBound(?string $value, string $default): string
    {
        $time = strtotime($value ?? $default);
        if ($time === false) {
            throw ApiError::badRequest('Geçersiz tarih: ' . $value);
        }
        return date('c', $time);
    }
}
