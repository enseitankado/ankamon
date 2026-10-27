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
 * Merkezi loglarda arama. Sayfalama: arayüz `offset` + `limit` ile sayfa sayfa ilerler (aynı
 * received_at'li satırlar sayfa sınırında kaybolmasın diye imleç yerine), `more` sonraki sayfanın
 * varlığını bildirir. `count=1` verilirse süzgece uyan kayıt sayısı da döner — büyük hypertable'da
 * tam sayım pahalı olduğundan COUNT_CAP'te kesilir (`total_capped`). Eski `before` imleci de geçerli.
 */
final class LogsApi
{
    public function index(Request $request): array
    {
        $where = ['received_at >= ?::timestamptz', 'received_at <= ?::timestamptz'];
        $params = [
            self::logQueryTimeBound($request->query('from'), '-24 hours'),
            self::logQueryTimeBound($request->query('to'), 'now'),
        ];

        if ($before = $request->query('before')) {
            $where[] = 'received_at < ?::timestamptz';
            $params[] = self::logQueryTimeBound($before, 'now');
        }
        if ($boardId = $request->query('board_id')) {
            $board = Db::one('SELECT hostname, host(ip) AS ip FROM boards WHERE id = ?', [(int) $boardId])
                ?? throw ApiError::notFound('Tahta bulunamadı.');
            $where[] = '(host = ? OR from_ip = ?)';
            array_push($params, (string) $board['hostname'], (string) $board['ip']);
        }
        if ($host = $request->query('host')) {
            $where[] = 'host = ?';
            $params[] = $host;
        }
        if (($severity = $request->query('severity')) !== null) {
            // syslog önem derecesi: 0 (acil) … 7 (hata ayıklama). Verilen değer ve daha önemlileri.
            $where[] = 'severity <= ?';
            $params[] = max(0, min(7, (int) $severity));
        }
        if ($program = $request->query('program')) {
            $where[] = 'program = ?';
            $params[] = $program;
        }
        // Dışlanan (önemsiz) mesajlar herkes için gizlenir — bkz. LogExclusionsApi.
        $excluded = (int) Db::value('SELECT count(*) FROM log_exclusions');
        if ($excluded && !$request->query('include_excluded')) {
            $where[] = LogExclusionsApi::condition();
        }
        if ($q = $request->query('q')) {
            $where[] = "message ILIKE ? ESCAPE '\\'";
            $params[] = '%' . addcslashes($q, '\\%_') . '%';
        }

        $limit = $request->queryInt('limit', 200, 1, 1000);
        $offset = $request->queryInt('offset', 0, 0, 10000000);
        $rows = Db::all(
            'SELECT received_at::text AS cursor,
                    (extract(epoch FROM received_at) * 1000)::bigint AS ts,
                    host, from_ip, facility, severity, program, ltrim(message) AS message
             FROM logs WHERE ' . implode(' AND ', $where) . '
             ORDER BY received_at DESC LIMIT ' . ($limit + 1) . ' OFFSET ' . $offset,
            $params
        );
        $more = count($rows) > $limit;
        $result = ['logs' => array_slice($rows, 0, $limit), 'more' => $more, 'exclusions' => $excluded];
        if ($request->query('count')) {
            $total = (int) Db::value(
                'SELECT count(*) FROM (SELECT 1 FROM logs WHERE ' . implode(' AND ', $where) . ' LIMIT ' . (self::COUNT_CAP + 1) . ') t',
                $params
            );
            $result['total'] = min($total, self::COUNT_CAP);
            $result['total_capped'] = $total > self::COUNT_CAP;
        }
        return $result;
    }

    /** Toplam sayımın üst sınırı — ötesi "100.000+" diye gösterilir (bkz. sınıf başı not). */
    private const COUNT_CAP = 100000;

    private static function logQueryTimeBound(?string $value, string $default): string
    {
        $time = strtotime($value ?? $default);
        if ($time === false) {
            throw ApiError::badRequest('Geçersiz tarih: ' . $value);
        }
        // İmleç mikro saniye taşır; strtotime onu atar. Geçerliyse metni olduğu gibi kullan.
        return $value !== null && preg_match('/^\d{4}-\d\d-\d\d[ T][\d:.]+([+-][\d:]+|Z)?$/', $value) ? $value : date('c', $time);
    }
}
