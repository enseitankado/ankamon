<?php
declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Db;
use Ankamon\Core\Request;

/**
 * Loglar grid'inden dışlanan mesajlar (log_exclusions — bkz. göç 013). Dışlama kayıt SİLMEZ; yalnız
 * LogsApi::index'in sonucundan herkes için gizler (bkz. condition()). Eşleşme: mesaj `pattern`'i
 * içeriyorsa (birebir alt metin) ve `program` boşsa ya da kaydın programına eşitse.
 * Listeleme 'logs', ekleme/silme 'logs.exclude' yetkisi ister (bkz. routes.php).
 */
final class LogExclusionsApi
{
    /** Çok kısa bir metin önemli mesajları da gizleyebilir — en az bu kadar karakter. */
    private const MIN_LENGTH = 8;
    private const MAX_LENGTH = 500;

    /** LogsApi'nin WHERE'ine eklenen koşul: `logs` tablosunun satırı hiçbir dışlamaya uymuyor. */
    public static function condition(string $alias = 'logs'): string
    {
        return "NOT EXISTS (SELECT 1 FROM log_exclusions x WHERE (x.program IS NULL OR x.program = $alias.program)"
            . " AND strpos($alias.message, x.pattern) > 0)";
    }

    /** Dışlamalar + her birinin son 24 saatte gizlediği kayıt sayısı (pencerede bilgi için). */
    public function index(Request $request): array
    {
        $rows = Db::all(
            "SELECT x.id, x.pattern, x.program, x.created_by, (extract(epoch FROM x.created_at) * 1000)::bigint AS created_ts,
                    (SELECT count(*) FROM logs l WHERE l.received_at > now() - interval '24 hours'
                       AND (x.program IS NULL OR l.program = x.program) AND strpos(l.message, x.pattern) > 0) AS hits_24h
             FROM log_exclusions x ORDER BY x.created_at DESC"
        );
        return ['exclusions' => $rows];
    }

    /** Eklemeden önce uyarı için: bu dışlama son 24 saatte kaç kaydı, kaç farklı mesajı gizlerdi. */
    public function preview(Request $request): array
    {
        [$pattern, $program] = self::validated($request->query('pattern'), $request->query('program'));
        $row = Db::one(
            "SELECT count(*) AS hits, count(DISTINCT ltrim(message)) AS distinct_messages FROM logs
             WHERE received_at > now() - interval '24 hours' AND (?::text IS NULL OR program = ?::text) AND strpos(message, ?) > 0",
            [$program, $program, $pattern]
        );
        return ['hits_24h' => (int) $row['hits'], 'distinct_messages' => (int) $row['distinct_messages']];
    }

    public function create(Request $request, array $user): array
    {
        [$pattern, $program] = self::validated($request->input('pattern'), $request->input('program'));
        $id = Db::value(
            'INSERT INTO log_exclusions (pattern, program, created_by) VALUES (?, ?, ?)
             ON CONFLICT (pattern, program) DO NOTHING RETURNING id',
            [$pattern, $program, (string) ($user['username'] ?? '—')]
        );
        if (!$id) {
            throw ApiError::badRequest('Bu mesaj zaten dışlanmış.');
        }
        Audit::log($user, $request, 'logs.exclude', $pattern, ['id' => (int) $id, 'program' => $program]);
        return ['ok' => true, 'id' => (int) $id];
    }

    public function delete(Request $request, array $user): array
    {
        $ids = array_values(array_unique(array_map('intval', (array) $request->input('ids', []))));
        if (!$ids) {
            throw ApiError::badRequest('Silinecek dışlama seçilmedi.');
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $removed = Db::all("DELETE FROM log_exclusions WHERE id IN ($placeholders) RETURNING pattern, program", $ids);
        Audit::log($user, $request, 'logs.exclude.delete', '', ['count' => count($removed), 'removed' => $removed]);
        return ['ok' => true, 'deleted' => count($removed)];
    }

    /** @return array{0:string,1:?string} */
    private static function validated(mixed $pattern, mixed $program): array
    {
        $pattern = trim((string) $pattern);
        $program = trim((string) $program);
        if (mb_strlen($pattern) < self::MIN_LENGTH) {
            throw ApiError::badRequest('Dışlanacak metin en az ' . self::MIN_LENGTH . ' karakter olmalı (çok kısa bir metin önemli mesajları da gizleyebilir).');
        }
        if (mb_strlen($pattern) > self::MAX_LENGTH) {
            throw ApiError::badRequest('Dışlanacak metin en fazla ' . self::MAX_LENGTH . ' karakter olabilir.');
        }
        return [$pattern, $program === '' ? null : $program];
    }
}
