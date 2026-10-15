<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\Auth;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

/** Genel bakış sayfasının özet verisi. */
final class DashboardApi
{
    public function summary(Request $request, array $user): array
    {
        // Log içeriği yalnız "logs" yetkisiyle; görev listesi yöneticide herkesinki, diğerlerinde
        // yalnız kendininki (JobsApi::index ile aynı kural) — "dashboard" tek başına bunları açmasın.
        $canLogs = Auth::can($user, 'logs');
        return [
            // "online" burada da BoardsApi ile aynı (yalnız b.online — board_status'ın yoklaması),
            // grid ile tutarsızlık olmasın.
            'boards' => Db::one(
                "SELECT count(*) AS total,
                        count(*) FILTER (WHERE b.online) AS online,
                        count(*) FILTER (WHERE b.exporter_ok) AS exporter_ok,
                        count(*) FILTER (WHERE b.last_log_at > now() - interval '24 hours') AS logging
                 FROM boards b"
            ),
            // Son 24 saat, saatlik: toplam ve hata düzeyi (severity ≤ 3) log sayıları.
            'log_histogram' => !$canLogs ? [] : Db::all(
                "SELECT extract(epoch FROM time_bucket(INTERVAL '1 hour', received_at))::bigint AS time,
                        count(*) AS total,
                        count(*) FILTER (WHERE severity <= 3) AS errors
                 FROM logs WHERE received_at > now() - interval '24 hours'
                 GROUP BY 1 ORDER BY 1"
            ),
            'recent_errors' => !$canLogs ? [] : Db::all(
                "SELECT (extract(epoch FROM received_at) * 1000)::bigint AS ts, host, bm.board_id, bm.board_label,
                        severity, program, ltrim(message) AS message
                 FROM logs l
                 LEFT JOIN LATERAL (SELECT b.id AS board_id, NULLIF(b.label, '') AS board_label FROM boards b
                     WHERE lower(b.hostname) = lower(l.host) OR host(b.ip) = l.from_ip LIMIT 1) bm ON true
                 WHERE received_at > now() - interval '24 hours' AND severity <= 3
                 ORDER BY received_at DESC LIMIT 15"
            ),
            // Hedef tahtalar ([{id, name}]): satır sağ menüsündeki "Hata loglarını göster" için.
            'recent_jobs' => array_map(
                fn($job) => ['targets' => json_decode((string) $job['targets'], true) ?: []] + $job,
                Db::all(
                    "SELECT j.id, j.title, j.status, j.summary, extract(epoch FROM j.created_at)::bigint AS created_at,
                            COALESCE((SELECT json_agg(json_build_object('id', b.id,
                                          'name', COALESCE(NULLIF(b.label, ''), b.hostname, host(b.ip))) ORDER BY b.label, b.hostname)
                                      FROM job_targets t JOIN boards b ON b.id = t.board_id WHERE t.job_id = j.id), '[]') AS targets
                     FROM jobs j WHERE ?::boolean OR j.created_by = ? ORDER BY j.id DESC LIMIT 8",
                    [(bool) $user['is_admin'], $user['id']]
                )
            ),
            'database_bytes' => (int) Db::value("SELECT pg_database_size('tihamon')"),
            // Sensör verisinin miktarı ve boyutu (worker.tihamon.tasks.telegraf_targets'ın
            // Telegraf'a sürekli yazdırdığı metrics hypertable'ı — bkz. db/migrations/001_core.sql).
            // Satır sayısı approximate_row_count ile alınır: büyük hypertable'larda tam count(*)
            // tam tablo taraması gerektirir, bu TimescaleDB fonksiyonu istatistiklerden anında döner.
            'metrics_rows' => (int) Db::value("SELECT approximate_row_count('metrics')"),
            'metrics_bytes' => (int) Db::value("SELECT hypertable_size('metrics'::regclass)"),
            'log_queue' => self::logQueue(),
            'backups' => self::backups(),
            'storage' => self::storage(),
        ];
    }

    /**
     * "Veri nerede saklanıyor" ağacı için (arayüzde kartların ipucu): tabloların güncel boyut/satır
     * sayısı ve TimescaleDB sıkıştırma/saklama politikaları. Hypertable'larda satır sayısı
     * approximate_row_count ile alınır (tam count(*) büyük tabloda pahalı); küçük tablolarda tam sayılır.
     */
    private static function storage(): array
    {
        $tables = [];
        foreach (['logs', 'metrics'] as $t) {
            $tables[$t] = [
                'bytes' => (int) Db::value("SELECT hypertable_size(?::regclass)", [$t]),
                'rows' => (int) Db::value("SELECT approximate_row_count(?::regclass)", [$t]),
            ];
        }
        foreach (['command_log', 'job_events', 'board_sessions', 'activity_log', 'audit_log'] as $t) {
            $tables[$t] = [
                'bytes' => (int) Db::value("SELECT pg_total_relation_size(?::regclass)", [$t]),
                'rows' => (int) Db::value("SELECT count(*) FROM $t"), // $t sabit listeden, kullanıcı girdisi değil
            ];
        }
        $policies = [];
        foreach (Db::all(
            "SELECT hypertable_name AS t, proc_name AS p,
                    COALESCE(config->>'drop_after', config->>'compress_after') AS after
             FROM timescaledb_information.jobs
             WHERE proc_name IN ('policy_retention', 'policy_compression')"
        ) as $row) {
            $policies[$row['t']][$row['p'] === 'policy_retention' ? 'drop_after' : 'compress_after'] = $row['after'];
        }
        return ['tables' => $tables, 'policies' => $policies];
    }

    /**
     * Yedek dosyaları özeti. Yedek dizini bilerek root'a özel (700 — dökümlerde parola özetleri var),
     * PHP (nobody) onu okuyamaz; bu yüzden yedek servisi her dakika ad/boyut/zaman listesini herkesin
     * okuyabileceği bir dosyaya yazar (bkz. docker/backup/backup.sh write_summary).
     */
    private static function backups(): ?array
    {
        $raw = @file_get_contents(self::BACKUP_SUMMARY);
        $data = $raw === false ? null : json_decode($raw, true);
        if (!is_array($data) || !isset($data['files'])) {
            return null;
        }
        $latest = [];
        $byKind = [];
        $total = 0;
        foreach ($data['files'] as $f) {
            $kind = strtok((string) $f['name'], '-'); // full | config | grafana
            $total += (int) $f['bytes'];
            $byKind[$kind]['files'] = ($byKind[$kind]['files'] ?? 0) + 1;
            $byKind[$kind]['bytes'] = ($byKind[$kind]['bytes'] ?? 0) + (int) $f['bytes'];
            if (!isset($latest[$kind]) || $f['mtime'] > $latest[$kind]['mtime']) {
                $latest[$kind] = ['name' => $f['name'], 'bytes' => (int) $f['bytes'], 'mtime' => (int) $f['mtime']];
            }
        }
        return [
            'dir' => $data['dir'] ?? '/data/backups',
            'files' => count($data['files']),
            'bytes' => $total,
            'kinds' => $byKind,
            'latest' => $latest,
            'keep_full' => (int) ($data['keep_full'] ?? 0),
            'keep_config' => (int) ($data['keep_config'] ?? 0),
            'full_at' => $data['full_at'] ?? null,
            'config_every_hours' => (int) ($data['config_every_hours'] ?? 0),
            'updated' => (int) ($data['updated'] ?? 0),
        ];
    }

    private const BACKUP_SUMMARY = '/run/tiha-mon/backups.json';

    /**
     * rsyslog'un disk kuyruğu (bkz. docker/rootfs/services/rsyslog.sh, SPOOL): veritabanı
     * yazamadığında gelen loglar burada birikir — büyüyorsa log akışı Postgres'e ulaşmıyor demektir.
     */
    private static function logQueue(): array
    {
        $bytes = 0;
        $files = 0;
        foreach (@scandir(self::LOG_QUEUE_DIR) ?: [] as $name) {
            $path = self::LOG_QUEUE_DIR . '/' . $name;
            if (is_file($path)) {
                $files++;
                $bytes += (int) @filesize($path);
            }
        }
        return ['bytes' => $bytes, 'files' => $files];
    }

    private const LOG_QUEUE_DIR = '/data/rsyslog';
}
