<?php
declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Db;
use Ankamon\Core\Request;
use Ankamon\Core\Storage;

/**
 * Görev kuyruğu kayıtlarının alanı (Disk kullanımı penceresinin "Görev kuyruğu" sekmesi) ve kalıcı
 * silme. Bir görev üç tabloda iz bırakır: jobs, job_targets (tahta başına sonuç/çıktı) ve
 * job_events (canlı çıktı zaman çizelgesi — en büyüğü); son ikisi ON DELETE CASCADE ile görevle
 * birlikte silinir. Görev başına boyut, üç tablonun gerçek toplam boyutunun satırların
 * pg_column_size ağırlığına orantılı paylaştırılmasıyla tahmin edilir (~).
 *
 * Yalnız BİTMİŞ (done/failed) görevler silinir: kuyrukta bekleyen/çalışan görevin satırı silinirse
 * runner yarım işin sonucunu yazacak yer bulamaz.
 *
 * Sorun tespiti taramaları ("diagnose" türü görevler) penceredeki AYRI "Sorun tespiti" sekmesinde
 * gösterilir (diagnoseStats/diagnoseDelete); "Görev kuyruğu" sekmesi onları saymaz ve silmez.
 * Boyut paylaştırması iki sekmede de TÜM görevler üzerinden yapılır, toplamlar tutarlı kalır.
 */
final class JobStatsApi
{
    private const FINISHED = "('done', 'failed')";
    private const DIAGNOSE = "type = 'diagnose'";
    private const NOT_DIAGNOSE = "type <> 'diagnose'";

    public function stats(Request $request): array
    {
        return $this->collect(false);
    }

    /** "Sorun tespiti" sekmesi: yalnız tarama raporları (bkz. DiagnoseApi). */
    public function diagnoseStats(Request $request): array
    {
        return $this->collect(true);
    }

    public function delete(Request $request, array $user): array
    {
        return $this->remove($request, $user, self::NOT_DIAGNOSE, 'jobs.delete');
    }

    /**
     * Tarama raporlarının silinmesi. Not: otomatik tarama zamanlayıcısı tahtanın son başarılı
     * taramasını bu kayıtlardan okur — silinen tahtalar bir sonraki uygun anda yeniden taranır.
     */
    public function diagnoseDelete(Request $request, array $user): array
    {
        return $this->remove($request, $user, self::DIAGNOSE, 'diagnose.delete');
    }

    /** @param $diagnose true: yalnız sorun tespiti taramaları, false: onlar HARİÇ tüm görevler */
    private function collect(bool $diagnose): array
    {
        $jobs = Db::all(
            "SELECT j.id, j.type, j.title, j.status, u.username AS created_by,
                    COALESCE((j.params->>'auto')::boolean, false) AS auto,
                    (extract(epoch FROM j.created_at) * 1000)::bigint AS created_at,
                    (extract(epoch FROM j.finished_at) * 1000)::bigint AS finished_at,
                    t.n AS targets, t.names, COALESCE(e.n, 0) AS events,
                    pg_column_size(j.*) + COALESCE(t.bytes, 0) + COALESCE(e.bytes, 0) AS weight
             FROM jobs j
             LEFT JOIN users u ON u.id = j.created_by
             LEFT JOIN LATERAL (
                 SELECT count(*) AS n, sum(pg_column_size(jt.*)) AS bytes,
                        array_to_json((array_agg(COALESCE(NULLIF(b.label, ''), b.hostname, host(b.ip)) ORDER BY b.id)
                            FILTER (WHERE b.id IS NOT NULL))[1:3]) AS names
                 FROM job_targets jt LEFT JOIN boards b ON b.id = jt.board_id WHERE jt.job_id = j.id
             ) t ON true
             LEFT JOIN LATERAL (
                 SELECT count(*) AS n, sum(pg_column_size(ev.*)) AS bytes FROM job_events ev WHERE ev.job_id = j.id
             ) e ON true
             ORDER BY j.id DESC"
        );
        $bytes = Storage::relationBytes('jobs') + Storage::relationBytes('job_targets') + Storage::relationBytes('job_events');
        $weightTotal = array_sum(array_map(fn($j) => (int) $j['weight'], $jobs));

        $jobs = array_values(array_filter($jobs, fn($j) => ($j['type'] === 'diagnose') === $diagnose));
        $finished = ['n' => 0, 'est_bytes' => 0];
        $out = array_map(function (array $j) use ($bytes, $weightTotal, &$finished) {
            $est = Storage::share($bytes, (int) $j['weight'], $weightTotal);
            $names = $j['names'] === null ? [] : (array) json_decode((string) $j['names'], true);
            $deletable = in_array($j['status'], ['done', 'failed'], true);
            if ($deletable) {
                $finished['n']++;
                $finished['est_bytes'] += $est;
            }
            return [
                'id' => (int) $j['id'], 'type' => $j['type'], 'title' => $j['title'], 'status' => $j['status'],
                'created_by' => $j['created_by'], 'created_at' => $j['created_at'] !== null ? (int) $j['created_at'] : null,
                'finished_at' => $j['finished_at'] !== null ? (int) $j['finished_at'] : null,
                'auto' => (bool) $j['auto'], 'targets' => (int) $j['targets'], 'target_names' => $names, 'events' => (int) $j['events'],
                'est_bytes' => $est, 'deletable' => $deletable,
            ];
        }, $jobs);

        return [
            'jobs' => $out,
            'finished' => $finished,
            // Tüm görev tablolarının gerçek boyutu bu sekmenin görevleri arasında değil, HER İKİ sekme
            // arasında paylaştırıldığından buradaki toplam da tahmindir (~).
            'total' => ['n' => count($out), 'bytes' => array_sum(array_column($out, 'est_bytes')), 'all_jobs_bytes' => $bytes],
            'disk' => Storage::diskSpace(),
        ];
    }

    /**
     * Kalıcı silme: ids (virgüllü görev numaraları) ya da all=1 (sekmenin bitmiş TÜM görevleri).
     * Bekleyen/çalışan görevler her iki durumda da atlanır. Geri alınamaz; audit_log'a yazılır.
     * @param $scope self::DIAGNOSE | self::NOT_DIAGNOSE — sekme dışındaki görevlere dokunulmaz
     */
    private function remove(Request $request, array $user, string $scope, string $auditAction): array
    {
        if ($request->query('all') === '1') {
            [$deleted] = Storage::delete([["DELETE FROM jobs WHERE $scope AND status IN " . self::FINISHED, []]]);
            $ids = 'all';
        } else {
            $ids = array_values(array_unique(array_filter(array_map('intval', explode(',', (string) $request->query('ids', ''))))));
            if (!$ids) {
                throw ApiError::badRequest('Silinecek görev seçilmedi.');
            }
            [$deleted] = Storage::delete([[
                "DELETE FROM jobs WHERE $scope AND status IN " . self::FINISHED . ' AND id = ANY(?::bigint[])',
                ['{' . implode(',', $ids) . '}'],
            ]]);
        }
        Audit::log($user, $request, $auditAction, '', ['ids' => $ids, 'deleted' => $deleted]);
        return ['ok' => true, 'deleted' => $deleted];
    }
}
