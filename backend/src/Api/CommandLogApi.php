<?php
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
        $params = [self::time($request->query('from'), '-7 days'), self::time($request->query('to'), 'now')];

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

    private static function time(?string $value, string $default): string
    {
        $time = strtotime($value ?? $default);
        if ($time === false) {
            throw ApiError::badRequest('Geçersiz tarih: ' . $value);
        }
        return date('c', $time);
    }
}
