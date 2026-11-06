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
use Ankamon\Core\Audit;
use Ankamon\Core\Db;
use Ankamon\Core\Request;
use Ankamon\Core\Settings;

/**
 * Sorun tespiti raporları (frontend page/Diagnose.js). Taramalar "diagnose" türündeki görevlerdir —
 * elle ("Şimdi tara", bkz. JobsApi all_online) ya da worker'ın otomatik zamanlayıcısıyla (bkz.
 * worker/ankamon/tasks/diagnose_schedule.py; created_by boş) açılır. JobsApi::index yalnız kullanıcının
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
                    (SELECT count(*) FROM job_targets t WHERE t.job_id = j.id) AS targets,
                    (SELECT count(*) FROM job_targets t WHERE t.job_id = j.id
                       AND t.status NOT IN ('ok', 'queued', 'running')) AS failed,
                    -- Küçük taramalarda (otomatik tarama çoğu kez 1-2 tahtalık) seçicide tahta adları da yazılsın.
                    (SELECT string_agg(COALESCE(NULLIF(b.label, ''), b.hostname, host(b.ip)), ', ')
                       FROM (SELECT * FROM job_targets t WHERE t.job_id = j.id LIMIT 4) t
                       JOIN boards b ON b.id = t.board_id) AS names
             FROM jobs j LEFT JOIN users u ON u.id = j.created_by
             WHERE j.type = 'diagnose' ORDER BY j.id DESC LIMIT 400"
        );
        return ['runs' => self::collapseRepeats($runs, 30), 'schedule' => self::schedule()];
    }

    /**
     * Art arda gelen, aynı tahta(lar)da tümüyle başarısız biten otomatik taramaları tek seçenekte toplar
     * (repeat: kaç tarama, first_at: ilkinin zamanı; id en yenisinin). Eskiden denetlenemeyen tahta her dakika
     * yeniden taranıyordu (bkz. worker diagnose_schedule RETRY_SECONDS) — o kayıtlar silinmeden seçici dolmasın.
     */
    private static function collapseRepeats(array $runs, int $limit): array
    {
        $out = [];
        foreach ($runs as $r) {
            $r['repeat'] = 1;
            $r['first_at'] = $r['created_at'];
            $failedAll = $r['auto'] && (int) $r['targets'] > 0 && (int) $r['failed'] === (int) $r['targets']
                && !in_array($r['status'], ['queued', 'running'], true);
            $last = $out ? count($out) - 1 : -1;
            if ($failedAll && $last >= 0 && !empty($out[$last]['_failedAll']) && $out[$last]['names'] === $r['names']
                && $out[$last]['targets'] === $r['targets']) {
                $out[$last]['repeat']++;
                $out[$last]['first_at'] = $r['created_at'];
                continue;
            }
            if (count($out) >= $limit) {
                break;
            }
            $r['_failedAll'] = $failedAll;
            $out[] = $r;
        }
        return array_map(function ($r) {
            unset($r['_failedAll']);
            return $r;
        }, $out);
    }

    /**
     * "Son durum": her tahtanın EN SON biten denetimi tek raporda (hangi taramada yapıldığından bağımsız).
     * Otomatik zamanlayıcı yalnız vadesi gelen tahtaları tarar — tek bir otomatik tarama çoğu kez 1-2 tahtalıktır;
     * sayfa açılışında o taramayı göstermek "yalnız bu tahta mı taranıyor?" karışıklığı yaratıyordu. Şu an
     * kayıtlı olmayan tahtalar ve sürmekte olan denetimler (queued/running) katılmaz. Biçim show() ile aynı;
     * tahta satırında ek olarak hangi taramadan geldiği (run_id, run_auto, run_by).
     */
    public function latest(): array
    {
        $targets = Db::all(
            "SELECT DISTINCT ON (t.board_id) t.board_id, COALESCE(NULLIF(b.label, ''), b.hostname, host(b.ip)) AS board,
                    host(b.ip) AS ip, t.status, t.output, extract(epoch FROM t.finished_at)::bigint AS finished_at,
                    j.id AS run_id, COALESCE((j.params->>'auto')::boolean, false) AS run_auto, u.username AS run_by
             FROM job_targets t
             JOIN jobs j ON j.id = t.job_id AND j.type = 'diagnose'
             JOIN boards b ON b.id = t.board_id
             LEFT JOIN users u ON u.id = j.created_by
             WHERE t.status NOT IN ('queued', 'running')
             ORDER BY t.board_id, t.finished_at DESC NULLS LAST, j.id DESC"
        );
        return ['job' => ['id' => 'latest', 'status' => 'done', 'latest' => true, 'auto' => false, 'created_by' => null,
            'targets' => $targets, 'boards' => (int) Db::value('SELECT count(*) FROM boards')]];
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
        $days = self::intervalDays();
        $rows = Db::all(
            "SELECT b.id, extract(epoch FROM max(j.created_at))::bigint AS last
             FROM boards b
             LEFT JOIN job_targets t ON t.board_id = b.id AND t.status = 'ok'
             LEFT JOIN jobs j ON j.id = t.job_id AND j.type = 'diagnose'
             GROUP BY b.id"
        );
        $lasts = array_map(fn($r) => $r['last'] === null ? null : (int) $r['last'], $rows);
        // Son denemesi başarısız olan tahtalar (bağlanılamadı, parola reddedildi…): zamanlayıcı bunları
        // DIAGNOSE_RETRY_HOURS'ta bir yeniden dener (bkz. worker diagnose_schedule RETRY_SECONDS).
        $failing = Db::all(
            "SELECT board FROM (
                SELECT DISTINCT ON (t.board_id) COALESCE(NULLIF(b.label, ''), b.hostname, host(b.ip)) AS board, t.status
                FROM job_targets t JOIN jobs j ON j.id = t.job_id AND j.type = 'diagnose' JOIN boards b ON b.id = t.board_id
                WHERE t.status NOT IN ('queued', 'running')
                ORDER BY t.board_id, t.finished_at DESC NULLS LAST, j.id DESC) x
             WHERE status <> 'ok' ORDER BY board"
        );
        $never = count(array_filter($lasts, fn($l) => $l === null));
        $known = array_filter($lasts, fn($l) => $l !== null);
        return [
            'interval_days' => $days,
            'interval_default' => self::envIntervalDays(),
            'boards' => count($rows),
            'retry_hours' => (float) (getenv('DIAGNOSE_RETRY_HOURS') ?: 6),
            'failing' => array_column($failing, 'board'),
            'never_scanned' => $never,
            // En eski denetimli tahtanın "uygun an aranır" ve "en geç" zamanları.
            'next_from' => $known ? (int) (min($known) + $days * 86400 * 0.85) : null,
            'next_by' => $known ? (int) (min($known) + $days * 86400) : null,
        ];
    }

    /** Otomatik SSH denetimi aralığı (gün): yöneticinin ayarı (settings.diagnose_interval_days), yoksa ortam değişkeni. */
    public static function intervalDays(): float
    {
        $set = Settings::get('diagnose_interval_days');
        return is_numeric($set) && (float) $set > 0 ? (float) $set : self::envIntervalDays();
    }

    private static function envIntervalDays(): float
    {
        return (float) (getenv('DIAGNOSE_INTERVAL_DAYS') ?: 7);
    }

    /** Yönetici: {days: 1..60 | null (varsayılan)} — Yardım ▸ Denetim türleri penceresinden (SSH denetimi satırları). */
    public function setInterval(Request $request, array $user): array
    {
        $days = $request->input('days');
        if ($days === null || $days === '') {
            Settings::set('diagnose_interval_days', null);
        } else {
            $days = (float) $days;
            if ($days < 1 || $days > 60) {
                throw ApiError::badRequest('Aralık 1 ile 60 gün arasında olmalı.');
            }
            Settings::set('diagnose_interval_days', $days);
        }
        Audit::log($user, $request, 'diagnose.interval', (string) ($days ?? 'varsayılan'));
        return ['ok' => true, 'interval_days' => self::intervalDays()];
    }
}
