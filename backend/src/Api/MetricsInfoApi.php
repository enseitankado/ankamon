<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\Db;
use Tihamon\Core\Storage;

/**
 * Sensör grafikleri sayfasının yardım penceresi: sensör verisinin nasıl toplandığı, ne toplandığı,
 * nasıl saklanıp özetlendiği — hepsi istek anında canlı sistemden okunur (sabit metin değil):
 * ortam değişkenleri, Telegraf/worker yapılandırma dosyaları, reshape.star süzgeci, veritabanındaki
 * seriler, TimescaleDB politikaları ve iş geçmişi, Telegraf sürecinin /proc ölçümleri.
 */
final class MetricsInfoApi
{
    private const TARGETS = '/data/telegraf/targets.conf';
    private const TELEGRAF_CONF = '/etc/tiha-mon/telegraf.conf';
    private const RESHAPE = '/etc/tiha-mon/reshape.star';
    private const BOARD_STATUS = '/opt/tiha-mon/worker/tihamon/tasks/board_status.py';
    private const DASHBOARDS = '/etc/tiha-mon/grafana/dashboards';

    public function info(): array
    {
        $boards = self::boards();
        $rows10 = array_sum(array_column($boards, 'rows_10m'));
        $layers = self::layers();
        $raw = $layers['raw'];
        // Sıkıştırılmamış (son ~2 gün) chunk'ların gerçek bayt/satırı; satır sayısı pg_class istatistiğinden
        // (tam count yerine — büyük kurulumda bu chunk'lar on milyonlarca satır olabilir).
        $open = Db::one(
            "SELECT sum(d.total_bytes)::bigint AS bytes, sum(pc.reltuples)::bigint AS rows
             FROM timescaledb_information.chunks c
             JOIN chunks_detailed_size('metrics') d ON d.chunk_schema = c.chunk_schema AND d.chunk_name = c.chunk_name
             JOIN pg_class pc ON pc.oid = format('%I.%I', c.chunk_schema, c.chunk_name)::regclass
             WHERE c.hypertable_name = 'metrics' AND NOT c.is_compressed"
        );
        $perRow = ($open['rows'] ?? 0) > 0 ? $open['bytes'] / $open['rows'] : null;
        $ratio = ($raw['before_compression'] ?? 0) > 0 ? $raw['after_compression'] / $raw['before_compression'] : null;
        $perDay = $rows10 * 144;
        return [
            'generated_at' => time(),
            'collection' => self::collection(),
            'filter' => self::filter(),
            'series' => Db::all(
                "SELECT t.name, count(*) AS series, count(DISTINCT t.board_id) AS boards
                 FROM metrics_tag t JOIN boards b ON b.id::text = t.board_id
                 GROUP BY t.name ORDER BY t.name"
            ),
            'boards' => $boards,
            'rate' => [
                'rows_10m' => $rows10,
                'rows_per_day' => $perDay,
                'bytes_per_row' => $perRow !== null ? round($perRow, 1) : null,
                'compression_ratio' => $ratio !== null ? round($ratio, 4) : null,
                'bytes_per_day' => $perRow !== null ? (int) round($perDay * $perRow) : null,
                'bytes_per_day_compressed' => $perRow !== null && $ratio !== null ? (int) round($perDay * $perRow * $ratio) : null,
            ],
            'layers' => $layers,
            'telegraf' => self::telegrafProcess(),
            'grafana' => self::grafanaUsage(),
            'disk' => Storage::diskSpace(),
        ];
    }

    /** Toplama ritmi: ortam değişkenleri + Telegraf/worker yapılandırmasından. */
    private static function collection(): array
    {
        $conf = (string) @file_get_contents(self::TELEGRAF_CONF);
        $targets = (string) @file_get_contents(self::TARGETS);
        $status = (string) @file_get_contents(self::BOARD_STATUS);
        preg_match_all('/board_id = "(\d+)"/', $targets, $ids);
        $agent = fn(string $key) => preg_match('/^\s*' . $key . '\s*=\s*"?([^"\n]+)"?/m', $conf, $m) ? trim($m[1]) : null;
        $py = fn(string $key) => preg_match('/^' . $key . '\s*=\s*([\d.]+)/m', $status, $m) ? (float) $m[1] : null;
        $timeout = preg_match('/timeout = "([^"]+)"/', $targets, $m) ? $m[1] : null;
        return [
            'scrape_interval' => getenv('SCRAPE_INTERVAL') ?: '60s',
            'collection_jitter' => $agent('collection_jitter'),
            'flush_interval' => $agent('flush_interval'),
            'metric_buffer_limit' => ($v = $agent('metric_buffer_limit')) !== null ? (int) $v : null,
            'scrape_timeout' => $timeout,
            'status_tick' => (int) (getenv('WORKER_STATUS_TICK_SECONDS') ?: 10),
            'worker_tick' => (int) (getenv('WORKER_TICK_SECONDS') ?: 60),
            'probe_timeout' => $py('TIMEOUT'),
            'fails_before_offline' => ($v = $py('FAILS_BEFORE_OFFLINE')) !== null ? (int) $v : null,
            'targets' => array_map('intval', $ids[1]),
            'targets_mtime' => @filemtime(self::TARGETS) ?: null,
        ];
    }

    /** reshape.star'daki süzgeç listeleri (Telegraf'ın gerçekte kullandığı dosya). */
    private static function filter(): array
    {
        $src = (string) @file_get_contents(self::RESHAPE);
        $list = function (string $name) use ($src): array {
            if (!preg_match('/^' . $name . '\s*=\s*\[(.*?)\]/ms', $src, $m)) {
                return [];
            }
            preg_match_all('/"([^"]+)"/', $m[1], $items);
            return $items[1];
        };
        preg_match('/^KEEP\s*=\s*\{(.*?)\}/ms', $src, $keep);
        preg_match_all('/"([a-zA-Z0-9_]+)"\s*:\s*True/', $keep[1] ?? '', $names);
        return [
            'keep' => $names[1],
            'keep_tags' => $list('KEEP_TAGS'),
            'cpu_modes' => $list('CPU_MODES'),
            'skip_fstypes' => $list('SKIP_FSTYPES'),
            'skip_dev_prefixes' => $list('SKIP_DEV_PREFIXES'),
        ];
    }

    /** Tahta başına: durum, seri sayısı ve son 10 dakikada gerçekten yazılan satır (ölçülen). */
    private static function boards(): array
    {
        $recent = [];
        foreach (Db::all(
            "SELECT t.board_id, count(*) AS n, extract(epoch FROM max(m.time))::bigint AS last
             FROM metrics m JOIN metrics_tag t USING (tag_id)
             WHERE m.time > now() - interval '10 minutes' GROUP BY t.board_id"
        ) as $r) {
            $recent[$r['board_id']] = $r;
        }
        $series = array_column(Db::all('SELECT board_id, count(*) AS n FROM metrics_tag GROUP BY board_id'), 'n', 'board_id');
        $out = [];
        foreach (Db::all(
            "SELECT id, COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name, host(ip) AS ip, exporter_port,
                    online, exporter_ok, monitor_enabled
             FROM boards ORDER BY name"
        ) as $b) {
            $key = (string) $b['id'];
            $out[] = $b + [
                'series' => (int) ($series[$key] ?? 0),
                'rows_10m' => (int) ($recent[$key]['n'] ?? 0),
                'last' => isset($recent[$key]) ? (int) $recent[$key]['last'] : null,
            ];
        }
        return $out;
    }

    /** Üç katman: boyut, satır, zaman aralığı, sıkıştırma ve politikalar (son/sonraki çalışma ile). */
    private static function layers(): array
    {
        $mat = [];
        foreach (Db::all(
            "SELECT view_name, format('%I.%I', materialization_hypertable_schema, materialization_hypertable_name) AS t
             FROM timescaledb_information.continuous_aggregates WHERE view_name IN ('metrics_5m', 'metrics_1h')"
        ) as $r) {
            $mat[$r['view_name']] = $r['t'];
        }
        $jobs = [];
        foreach (Db::all(
            "SELECT j.hypertable_name AS t, j.proc_name AS proc, j.schedule_interval::text AS every, j.config,
                    extract(epoch FROM s.last_run_started_at)::bigint AS last_run, s.last_run_status AS status,
                    extract(epoch FROM s.next_start)::bigint AS next_run
             FROM timescaledb_information.jobs j
             LEFT JOIN timescaledb_information.job_stats s USING (job_id)
             WHERE j.proc_name LIKE 'policy_%' AND j.hypertable_name IN ('metrics', 'metrics_5m', 'metrics_1h')"
        ) as $r) {
            $r['config'] = json_decode((string) $r['config'], true) ?: [];
            $jobs[$r['t']][$r['proc']] = $r;
        }

        $out = [];
        foreach (['raw' => ['metrics', 'metrics'], '5m' => ['metrics_5m', $mat['metrics_5m'] ?? null],
                  '1h' => ['metrics_1h', $mat['metrics_1h'] ?? null]] as $key => [$name, $table]) {
            if ($table === null) {
                continue;
            }
            $range = Db::one("SELECT extract(epoch FROM min(time))::bigint AS first,
                                     extract(epoch FROM max(time))::bigint AS last FROM $table");
            $chunks = Db::one(
                "SELECT count(*) AS total, count(*) FILTER (WHERE c.is_compressed) AS compressed
                 FROM timescaledb_information.chunks c
                 WHERE format('%I.%I', c.hypertable_schema, c.hypertable_name)::regclass = ?::regclass",
                [$table]
            );
            $comp = Db::one(
                'SELECT sum(before_compression_total_bytes)::bigint AS before,
                        sum(after_compression_total_bytes)::bigint AS after
                 FROM chunk_compression_stats(?::regclass)',
                [$table]
            );
            $out[$key] = [
                'name' => $name,
                'bytes' => Storage::relationBytes($table),
                'rows' => (int) Db::value('SELECT approximate_row_count(?::regclass)', [$table]),
                'first' => $range['first'] !== null ? (int) $range['first'] : null,
                'last' => $range['last'] !== null ? (int) $range['last'] : null,
                'chunks' => (int) $chunks['total'],
                'compressed_chunks' => (int) $chunks['compressed'],
                'before_compression' => $comp['before'] !== null ? (int) $comp['before'] : null,
                'after_compression' => $comp['after'] !== null ? (int) $comp['after'] : null,
                'jobs' => array_values($jobs[$name] ?? []),
            ];
        }
        return $out;
    }

    /** Telegraf sürecinin başlangıçtan beri ortalama CPU'su ve belleği (/proc'tan, ölçülen). */
    private static function telegrafProcess(): ?array
    {
        foreach (@scandir('/proc') ?: [] as $pid) {
            if (!ctype_digit($pid) || trim((string) @file_get_contents("/proc/$pid/comm")) !== 'telegraf') {
                continue;
            }
            $stat = (string) @file_get_contents("/proc/$pid/stat");
            // comm alanı parantez içinde boşluk içerebilir: alanlar son ')' sonrasından sayılır.
            $f = explode(' ', trim(substr($stat, strrpos($stat, ')') + 2)));
            $hz = 100; // Linux'ta USER_HZ
            $cpu = ((int) $f[11] + (int) $f[12]) / $hz;          // utime + stime (alan 14, 15)
            $uptime = (float) explode(' ', (string) @file_get_contents('/proc/uptime'))[0];
            $elapsed = $uptime - ((int) $f[19]) / $hz;          // starttime (alan 22)
            $rss = preg_match('/VmRSS:\s+(\d+)/', (string) @file_get_contents("/proc/$pid/status"), $m) ? (int) $m[1] * 1024 : null;
            return [
                'pid' => (int) $pid,
                'uptime' => (int) $elapsed,
                'cpu_seconds' => round($cpu, 2),
                'cpu_percent' => $elapsed > 0 ? round($cpu / $elapsed * 100, 3) : null,
                'rss_bytes' => $rss,
                'cores' => (int) (preg_match_all('/^processor/m', (string) @file_get_contents('/proc/cpuinfo')) ?: 0),
            ];
        }
        return null;
    }

    /** Grafana panolarının hangi katmanı sorguladığı (pano JSON'larından). */
    private static function grafanaUsage(): array
    {
        $uses = ['raw' => false, '5m' => false, '1h' => false];
        foreach (glob(self::DASHBOARDS . '/*.json') ?: [] as $file) {
            $json = (string) @file_get_contents($file);
            $uses['5m'] = $uses['5m'] || str_contains($json, 'metrics_5m');
            $uses['1h'] = $uses['1h'] || str_contains($json, 'metrics_1h');
            $uses['raw'] = $uses['raw'] || preg_match('/v_metrics(?!_)/', $json) === 1;
        }
        return $uses;
    }
}
