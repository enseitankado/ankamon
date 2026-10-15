<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\Db;
use Tihamon\Core\Request;

/**
 * Tahtaların açık olduğu aralıklar (Oturumlar > Kullanıcılar zaman çizelgesi; aralıkların tümleyeni
 * "kapalı" gölgesi olarak çizilir). Veri worker'ın loglardan önceden hesapladığı board_uptime
 * tablosundan gelir (bkz. db/migrations/014_board_uptime.sql) — istek başına log taranmaz.
 *
 * Yanıt: {"boards":[{"board_id", "host", "since", "up":[[başlangıç, bitiş|null], …]}], "computed_until"}
 * (epoch saniye, artan sırada; bitiş null = tahta hâlâ açık). board_id silinmiş tahtada null olabilir.
 */
final class UptimeApi
{
    /** worker/tihamon/tasks/board_uptime.py GAP ile aynı: son log bundan yeniyse aralık "sürüyor". */
    private const GAP_SECONDS = 900;

    public function index(Request $request): array
    {
        $now = time();
        $to = $request->queryInt('to', $now, 0, $now + 86400);
        $from = $request->queryInt('from', $to - 7 * 86400, 0, $to);
        $computed = Db::value("SELECT extract(epoch FROM value)::bigint FROM task_cursors WHERE name = 'board_uptime.watermark'");

        $rows = Db::all(
            "SELECT u.host, b.id AS board_id,
                    extract(epoch FROM u.started_at)::bigint AS started_at,
                    extract(epoch FROM u.last_at)::bigint AS last_at
             FROM board_uptime u
             LEFT JOIN LATERAL (SELECT id FROM boards WHERE lower(hostname) = lower(u.host) LIMIT 1) b ON true
             WHERE u.last_at >= to_timestamp(?) AND u.started_at <= to_timestamp(?)
             ORDER BY u.host, u.started_at",
            [$from - self::GAP_SECONDS, $to]
        );

        // since: o host hakkında bilginin başladığı an (tablodaki en erken aralık) — öncesi "bilinmiyor",
        // istemci onu kapalı diye taramaz. Aralıkta hiç açık olmamış ama daha önceden bilinen tahtalar da
        // (up boş = tüm aralık boyunca kapalı) listelenir.
        $boards = [];
        foreach (Db::all(
            "SELECT u.host, b.id AS board_id, extract(epoch FROM min(u.started_at))::bigint AS since
             FROM board_uptime u
             LEFT JOIN LATERAL (SELECT id FROM boards WHERE lower(hostname) = lower(u.host) LIMIT 1) b ON true
             GROUP BY u.host, b.id HAVING min(u.started_at) <= to_timestamp(?)
             ORDER BY u.host",
            [$to]
        ) as $row) {
            $boards[$row['host']] = ['board_id' => $row['board_id'], 'host' => $row['host'], 'since' => (int) $row['since'], 'up' => []];
        }
        foreach ($rows as $row) {
            $boards[$row['host']]['up'][] = [(int) $row['started_at'], (int) $row['last_at']];
        }
        // Yalnız her host'un SON aralığı "sürüyor" (bitiş null) olabilir: son logu, işlenmiş en yeni
        // log zamanından GAP'ten yakınsa ve hesap güncelse (worker geride kalmamışsa).
        $fresh = $computed !== null && $now - (int) $computed <= self::GAP_SECONDS;
        foreach ($boards as &$board) {
            $last = count($board['up']) - 1;
            if ($last >= 0 && $fresh && (int) $computed - $board['up'][$last][1] <= self::GAP_SECONDS) {
                $board['up'][$last][1] = null;
            }
        }
        unset($board);
        return ['boards' => array_values($boards), 'computed_until' => $computed === null ? null : (int) $computed];
    }
}
