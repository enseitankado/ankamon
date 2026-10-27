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

use Ankamon\Core\Db;
use Ankamon\Core\Request;
use Ankamon\Core\Storage;

/**
 * Disk kullanımı sekmelerinin "?" yardım penceresi için CANLI saklama bilgisi (bkz. frontend
 * ui.DiskUsageHelp): .env saklama/yedekleme ayarlarının o anki değerleri, TimescaleDB politikalarının
 * (saklama, sıkıştırma, özet tazeleme) gerçek yapılandırması ve son çalışma durumu, rsyslog disk
 * kuyruğunun sınırları ve /data diski. Salt-okunur.
 */
final class StoragePolicyApi
{
    private const ENV = [
        'LOG_DAYS', 'METRICS_RAW_DAYS', 'METRICS_5M_DAYS', 'METRICS_1H_DAYS', 'SCRAPE_INTERVAL',
        'BACKUP_CONFIG_EVERY_HOURS', 'BACKUP_FULL_AT', 'BACKUP_KEEP_CONFIG', 'BACKUP_KEEP_FULL', 'DIAGNOSE_INTERVAL_DAYS',
    ];

    // Şablon (parolasız) — çalışan kopya /run/ankamon/rsyslog.conf'a yalnız sunucu adı/dizin işlenir.
    private const RSYSLOG_CONF = '/etc/ankamon/rsyslog.conf';

    public function policy(Request $request): array
    {
        $env = [];
        foreach (self::ENV as $key) {
            $value = getenv($key);
            $env[$key] = $value === false || $value === '' ? null : $value;
        }
        $policies = array_map(fn(array $r) => [
            'table' => $r['hypertable_name'],
            'kind' => $r['proc_name'],
            'config' => json_decode((string) $r['config'], true) ?: new \stdClass(),
            'every' => $r['every'],
            'status' => $r['last_run_status'],
            'last_ok' => $r['last_ok'] !== null ? (int) $r['last_ok'] * 1000 : null,
            'next' => $r['next_start'] !== null ? (int) $r['next_start'] * 1000 : null,
        ], Db::all(
            "SELECT j.hypertable_name, j.proc_name, j.config::text AS config, j.schedule_interval::text AS every,
                    s.last_run_status, extract(epoch FROM s.last_successful_finish)::bigint AS last_ok,
                    extract(epoch FROM s.next_start)::bigint AS next_start
             FROM timescaledb_information.jobs j
             LEFT JOIN timescaledb_information.job_stats s USING (job_id)
             WHERE j.proc_name IN ('policy_retention', 'policy_compression', 'policy_refresh_continuous_aggregate')
             ORDER BY j.hypertable_name, j.proc_name"
        ));
        return [
            'env' => $env,
            'policies' => $policies,
            'queue' => self::queueLimits(),
            'disk' => Storage::diskSpace(),
        ];
    }

    /** rsyslog veritabanı eyleminin disk kuyruğu ayarları (queue.maxDiskSpace, queue.timeoutEnqueue…). */
    private static function queueLimits(): array
    {
        $conf = (string) @file_get_contents(self::RSYSLOG_CONF);
        $out = [];
        foreach (['maxDiskSpace', 'size', 'timeoutEnqueue'] as $key) {
            $out[$key] = preg_match('/^\s*queue\.' . $key . '="([^"]+)"/m', $conf, $m) ? $m[1] : null;
        }
        return $out;
    }
}
