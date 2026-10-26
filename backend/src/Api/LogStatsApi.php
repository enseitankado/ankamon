<?php
declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Db;
use Ankamon\Core\Request;
use Ankamon\Core\Storage;

/**
 * Tahta/tür bazında log alanı: kayıt sayısı, tarih aralığı, diskteki yaklaşık boyut — ve kalıcı silme.
 *
 * "logs" (sistem logları) TimescaleDB hypertable'ı, sıkıştırılmış saklanır (bkz. 001_core.sql);
 * sıkıştırılmış bir yığın birden çok tahtanın satırlarını birlikte tutar, bu yüzden tahta başına
 * GERÇEK disk boyutu ayrıştırılamaz. Boyut, tablonun toplam fiziksel boyutunun (Storage::relationBytes
 * — hypertable'da hypertable_size) satır sayısına ORANTILI PAYLAŞTIRILMASIYLA tahmin edilir — arayüzde
 * "~" ile işaretlenmeli.
 * "command_log" sıkıştırılmaz ve board_id sütunu olduğundan eşleme gerekmez, ama aynı tahmin
 * yöntemi (tutarlılık için) burada da kullanılır.
 */
final class LogStatsApi
{
    public function stats(Request $request): array
    {
        return $this->type($request) === 'command' ? $this->commandStats() : $this->systemStats();
    }

    /**
     * Kalıcı silme. Kapsam: type (system|command, zorunlu) + board (tahta id'si, "unmatched"
     * — tahtasız/eşleşmeyen kayıtlar — ya da boş bırakılırsa TÜM kayıtlar) + isteğe bağlı from/to
     * (ISO 8601; verilmezse tarih sınırı yok — o kapsamdaki HER ŞEY silinir). Geri alınamaz;
     * ne silindiği etkinlik denetim kaydına (audit_log) yazılır.
     */
    public function delete(Request $request, array $user): array
    {
        $type = $this->type($request);
        $board = $request->query('board'); // id (sayısal), "unmatched" ya da null (tüm tahtalar)
        $from = $request->query('from');
        $to = $request->query('to');

        $where = [];
        $params = [];
        if ($from !== null) {
            $where[] = ($type === 'command' ? 'time' : 'received_at') . ' >= ?::timestamptz';
            $params[] = $from;
        }
        if ($to !== null) {
            $where[] = ($type === 'command' ? 'time' : 'received_at') . ' <= ?::timestamptz';
            $params[] = $to;
        }

        if ($type === 'command') {
            if ($board === 'unmatched') {
                $where[] = 'board_id IS NULL';
            } elseif ($board !== null) {
                $where[] = 'board_id = ?';
                $params[] = (int) $board;
            }
            $sql = 'DELETE FROM command_log' . ($where ? ' WHERE ' . implode(' AND ', $where) : '');
        } else {
            if ($board === 'unmatched') {
                $where[] = 'NOT EXISTS (SELECT 1 FROM boards b WHERE lower(b.hostname) = lower(logs.host) OR host(b.ip) = logs.from_ip)';
            } elseif ($board !== null) {
                $b = Db::one('SELECT hostname, host(ip) AS ip FROM boards WHERE id = ?', [(int) $board])
                    ?? throw ApiError::notFound('Tahta bulunamadı.');
                $where[] = '(lower(host) = lower(?) OR from_ip = ?)';
                array_push($params, (string) $b['hostname'], (string) $b['ip']);
            }
            $sql = 'DELETE FROM logs' . ($where ? ' WHERE ' . implode(' AND ', $where) : '');
        }

        [$deleted] = Storage::delete([[$sql, $params]]);
        Audit::log($user, $request, 'logs.delete', $type, [
            'board' => $board, 'from' => $from, 'to' => $to, 'deleted' => $deleted,
        ]);
        return ['ok' => true, 'deleted' => $deleted];
    }

    private function type(Request $request): string
    {
        return $request->query('type') === 'command' ? 'command' : 'system';
    }

    private function systemStats(): array
    {
        $groups = Db::all(
            "SELECT host, from_ip, count(*) AS n,
                    (extract(epoch FROM min(received_at)) * 1000)::bigint AS first,
                    (extract(epoch FROM max(received_at)) * 1000)::bigint AS last
             FROM logs GROUP BY host, from_ip"
        );
        $boards = Db::all(
            "SELECT id, hostname, host(ip) AS ip, COALESCE(NULLIF(label,''), hostname, host(ip)) AS name FROM boards"
        );
        $bytesTotal = Storage::relationBytes('logs');

        $byBoard = [];
        $unmatched = ['n' => 0, 'first' => null, 'last' => null];
        $grandN = 0;
        foreach ($groups as $g) {
            $grandN += (int) $g['n'];
            $match = null;
            foreach ($boards as $b) {
                $hostMatch = $b['hostname'] !== null && $b['hostname'] !== '' && strcasecmp((string) $g['host'], (string) $b['hostname']) === 0;
                $ipMatch = $g['from_ip'] !== null && $g['from_ip'] === $b['ip'];
                if ($hostMatch || $ipMatch) {
                    $match = $b;
                    break;
                }
            }
            if ($match === null) {
                self::fold($unmatched, $g);
                continue;
            }
            $byBoard[$match['id']] ??= ['board_id' => $match['id'], 'name' => $match['name'], 'n' => 0, 'first' => null, 'last' => null];
            self::fold($byBoard[$match['id']], $g);
        }

        return $this->shape(array_values($byBoard), $unmatched, $grandN, $bytesTotal);
    }

    private function commandStats(): array
    {
        $groups = Db::all(
            "SELECT c.board_id, COALESCE(NULLIF(b.label,''), b.hostname, host(b.ip)) AS name, count(*) AS n,
                    (extract(epoch FROM min(c.time)) * 1000)::bigint AS first,
                    (extract(epoch FROM max(c.time)) * 1000)::bigint AS last
             FROM command_log c LEFT JOIN boards b ON b.id = c.board_id
             GROUP BY c.board_id, name"
        );
        $bytesTotal = Storage::relationBytes('command_log');

        $byBoard = [];
        $unmatched = ['n' => 0, 'first' => null, 'last' => null];
        $grandN = 0;
        foreach ($groups as $g) {
            $grandN += (int) $g['n'];
            if ($g['board_id'] === null) {
                self::fold($unmatched, $g);
                continue;
            }
            $byBoard[] = ['board_id' => (int) $g['board_id'], 'name' => $g['name'], 'n' => (int) $g['n'], 'first' => $g['first'], 'last' => $g['last']];
        }

        return $this->shape($byBoard, $unmatched, $grandN, $bytesTotal);
    }

    /** @param array<string,mixed> $acc birikimli {n, first, last}; $row aynı şekle sahip tek grup. */
    private static function fold(array &$acc, array $row): void
    {
        $acc['n'] += (int) $row['n'];
        if ($row['first'] !== null && ($acc['first'] === null || $row['first'] < $acc['first'])) {
            $acc['first'] = $row['first'];
        }
        if ($row['last'] !== null && ($acc['last'] === null || $row['last'] > $acc['last'])) {
            $acc['last'] = $row['last'];
        }
    }

    /** Oranlı boyut tahminini ekleyip tek bir yanıt şekline sokar. */
    private function shape(array $byBoard, array $unmatched, int $grandN, int $bytesTotal): array
    {
        $withBytes = fn(array $row) => $row + [
            'est_bytes' => Storage::share($bytesTotal, $row['n'], $grandN),
        ];
        usort($byBoard, fn($a, $b) => strcasecmp((string) $a['name'], (string) $b['name']));
        return [
            'boards' => array_map($withBytes, $byBoard),
            'unmatched' => $unmatched['n'] > 0 ? $withBytes($unmatched) : null,
            'total' => [
                'n' => $grandN,
                'first' => $byBoard || $unmatched['n'] > 0
                    ? min(array_filter(array_merge(array_column($byBoard, 'first'), [$unmatched['first']])))
                    : null,
                'last' => $byBoard || $unmatched['n'] > 0
                    ? max(array_filter(array_merge(array_column($byBoard, 'last'), [$unmatched['last']])))
                    : null,
                'bytes' => $bytesTotal,
            ],
            'disk' => Storage::diskSpace(),
        ];
    }
}
