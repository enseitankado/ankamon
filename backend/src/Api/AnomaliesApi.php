<?php
declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\Db;
use Ankamon\Core\Request;

/**
 * Anomaliler (Tahtalar ▸ Anomaliler): worker'ın kurallarla ön hesapladığı sıra dışı durum aralıkları
 * (bkz. db/migrations/033_anomalies.sql, worker/ankamon/anomaly). İstek başına hesap yapılmaz.
 *
 * Yanıt: {"kinds": {tür: {label, description}}, "anomalies": [{id, kind, board_id, board, host,
 * started_at, ended_at|null, detail}], "computed_at"} — sürenlerin TÜMÜ + [from, to] aralığıyla
 * örtüşen bitmişler (epoch saniye). board: tahtanın güncel adı; tahta silindiyse kayıttaki ad.
 */
final class AnomaliesApi
{
    /** Tür adları ve açıklamaları — arayüz metni tek yerde (worker yalnız kind yazar). */
    private const KINDS = [
        'no_login' => [
            'label' => 'Oturumsuz açık',
            'description' => 'Tahta en az 15 dakikadır açık ve kimse oturum açmamış (açılıştan beri ya da son oturum kapandıktan sonra).',
        ],
    ];

    public function index(Request $request): array
    {
        $now = time();
        $to = $request->queryInt('to', $now, 0, $now + 86400);
        $from = $request->queryInt('from', $to - 30 * 86400, 0, $to);
        $limit = $request->queryInt('limit', 20000, 1, 100000);

        $rows = Db::all(
            "SELECT a.id, a.kind, a.board_id, COALESCE(NULLIF(b.label, ''), NULLIF(a.board_name, ''), a.host) AS board, a.host,
                    extract(epoch FROM a.started_at)::bigint AS started_at,
                    extract(epoch FROM a.ended_at)::bigint AS ended_at,
                    a.detail
             FROM anomalies a LEFT JOIN boards b ON b.id = a.board_id
             WHERE a.ended_at IS NULL OR (a.ended_at >= to_timestamp(?) AND a.started_at <= to_timestamp(?))
             ORDER BY a.started_at DESC LIMIT ?",
            [$from, $to, $limit]
        );
        foreach ($rows as &$row) {
            $row['detail'] = json_decode((string) $row['detail'], true) ?: [];
        }
        unset($row);
        $computed = Db::value(
            "SELECT extract(epoch FROM max(value))::bigint FROM task_cursors WHERE name LIKE 'anomaly.%'"
        );
        return [
            'kinds' => self::KINDS,
            'anomalies' => $rows,
            'computed_at' => $computed === null ? null : (int) $computed,
        ];
    }
}
