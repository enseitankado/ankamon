<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\ApiError;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

/**
 * Bakım ▸ Ahenk: tahtaların son "Ahenk kontrol" raporları (hazır işlem actions/ahenk-check; rapor
 * worker executor/ahenk.py tarafından ahenk_reports'a yazılır). Liste her tahtayı içerir — hiç
 * kontrol edilmemiş tahta da satır olarak görünür (summary boş).
 */
final class AhenkApi
{
    public function index(Request $request): array
    {
        $rows = Db::all(
            "SELECT b.id, COALESCE(NULLIF(b.label, ''), NULLIF(b.hostname, ''), host(b.ip)) AS name, host(b.ip) AS ip, b.online,
                    extract(epoch FROM r.checked_at)::bigint AS checked_at, r.exit_code, r.tool_commit, r.job_id,
                    COALESCE(r.summary, '{}'::jsonb) AS summary
             FROM boards b LEFT JOIN ahenk_reports r ON r.board_id = b.id
             ORDER BY name");
        foreach ($rows as &$row) {
            $row['summary'] = json_decode((string) $row['summary'], true) ?: new \stdClass();
        }
        unset($row);
        return ['boards' => $rows];
    }

    /** GET /api/ahenk/{id}: o tahtanın son ham raporu (ayrıntı penceresi). */
    public function show(Request $request): array
    {
        $row = Db::one(
            "SELECT extract(epoch FROM checked_at)::bigint AS checked_at, exit_code, tool_commit, report,
                    report_text
             FROM ahenk_reports WHERE board_id = ?", [(int) $request->arg('id')]);
        if ($row === null) {
            throw ApiError::notFound('Bu tahtada henüz Ahenk kontrolü yapılmadı.');
        }
        $row['report'] = json_decode((string) $row['report'], true) ?: new \stdClass();
        return $row;
    }
}
