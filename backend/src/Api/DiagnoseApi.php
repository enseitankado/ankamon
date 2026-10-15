<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\ApiError;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

/**
 * Sorun tespiti raporları (frontend page/Diagnose.js). Taramalar "diagnose" türündeki görevlerdir —
 * elle ("Şimdi tara", bkz. JobsApi all_online) ya da worker'ın otomatik zamanlayıcısıyla (bkz.
 * worker/tihamon/tasks/diagnose_schedule.py; created_by boş) açılır. JobsApi::index yalnız kullanıcının
 * kendi görevlerini gösterdiğinden (yönetici hariç), raporlar 'diagnose' yetkisi olan HERKESE buradan sunulur.
 */
final class DiagnoseApi
{
    /** Son taramalar (rapor seçici) + otomatik tarama takvimi. */
    public function runs(): array
    {
        $runs = Db::all(
            "SELECT j.id, j.status, extract(epoch FROM j.created_at)::bigint AS created_at,
                    extract(epoch FROM j.finished_at)::bigint AS finished_at,
                    COALESCE((j.params->>'auto')::boolean, false) AS auto, u.username AS created_by,
                    (SELECT count(*) FROM job_targets t WHERE t.job_id = j.id) AS targets
             FROM jobs j LEFT JOIN users u ON u.id = j.created_by
             WHERE j.type = 'diagnose' ORDER BY j.id DESC LIMIT 30"
        );
        return ['runs' => $runs, 'schedule' => self::schedule()];
    }

    public function show(Request $request): array
    {
        $job = Db::one(
            "SELECT j.id, j.status, j.summary, j.params, extract(epoch FROM j.created_at)::bigint AS created_at,
                    extract(epoch FROM j.finished_at)::bigint AS finished_at, u.username AS created_by
             FROM jobs j LEFT JOIN users u ON u.id = j.created_by WHERE j.id = ? AND j.type = 'diagnose'",
            [$request->arg('id')]
        ) ?? throw ApiError::notFound();
        $params = json_decode((string) $job['params'], true) ?: [];
        unset($job['params']);
        $job['auto'] = !empty($params['auto']);
        $job['targets'] = Db::all(
            "SELECT t.board_id, COALESCE(NULLIF(b.label, ''), b.hostname, host(b.ip)) AS board, host(b.ip) AS ip,
                    t.status, t.output, extract(epoch FROM t.finished_at)::bigint AS finished_at
             FROM job_targets t JOIN boards b ON b.id = t.board_id
             WHERE t.job_id = ? ORDER BY board",
            [$job['id']]
        );
        return ['job' => $job];
    }

    /**
     * Otomatik tarama takvimi: her tahtanın son BAŞARILI denetimi + aralık. Zamanlayıcı aralığın %85'i
     * dolunca kaynaklar müsait olan ilk anda tarar; aralık dolduğunda eşikleri gevşetir (bkz. worker).
     */
    private static function schedule(): array
    {
        $days = (float) (getenv('DIAGNOSE_INTERVAL_DAYS') ?: 7);
        $rows = Db::all(
            "SELECT b.id, extract(epoch FROM max(j.created_at))::bigint AS last
             FROM boards b
             LEFT JOIN job_targets t ON t.board_id = b.id AND t.status = 'ok'
             LEFT JOIN jobs j ON j.id = t.job_id AND j.type = 'diagnose'
             GROUP BY b.id"
        );
        $lasts = array_map(fn($r) => $r['last'] === null ? null : (int) $r['last'], $rows);
        $never = count(array_filter($lasts, fn($l) => $l === null));
        $known = array_filter($lasts, fn($l) => $l !== null);
        return [
            'interval_days' => $days,
            'boards' => count($rows),
            'never_scanned' => $never,
            // En eski denetimli tahtanın "uygun an aranır" ve "en geç" zamanları.
            'next_from' => $known ? (int) (min($known) + $days * 86400 * 0.85) : null,
            'next_by' => $known ? (int) (min($known) + $days * 86400) : null,
        ];
    }
}
