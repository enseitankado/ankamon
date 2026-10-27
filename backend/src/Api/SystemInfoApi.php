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
use Ankamon\Core\Storage;
use Ankamon\Core\Supervisor;

/**
 * Sistem sayfası (yalnız yönetici): Genel / Zamanlanmış işler / Veritabanı / Yapılandırma sekmeleri.
 * Servisler ayrı: ServicesApi. Hepsi salt-okunurdur; tek yazma, bir TimescaleDB politikasını
 * "şimdi çalıştır"maktır (runJob).
 */
final class SystemInfoApi
{
    // Sürümü gösterilecek bileşenler: Alpine paket adı → görünen ad.
    private const PACKAGES = [
        'postgresql17' => 'PostgreSQL', 'grafana' => 'Grafana', 'telegraf' => 'Telegraf', 'rsyslog' => 'rsyslog',
        'nginx' => 'nginx', 'php84' => 'PHP', 'python3' => 'Python', 'ansible-core' => 'Ansible',
        'supervisor' => 'supervisord', 'openssh-client-default' => 'OpenSSH istemcisi', 'sshpass' => 'sshpass',
        'alpine-release' => 'Alpine Linux',
    ];

    // .env yapılandırması (bkz. .env.example): [grup, anahtar, açıklama, gizli mi].
    private const CONFIG = [
        ['Saklama süreleri', 'LOG_DAYS', 'Sistem logları kaç gün tutulur', false],
        ['Saklama süreleri', 'METRICS_RAW_DAYS', 'Ham sensör ölçümleri kaç gün tutulur', false],
        ['Saklama süreleri', 'METRICS_5M_DAYS', '5 dakikalık sensör özetleri kaç gün tutulur', false],
        ['Saklama süreleri', 'METRICS_1H_DAYS', 'Saatlik sensör özetleri kaç gün tutulur', false],
        ['Saklama süreleri', 'HOME_BACKUP_KEEP_HOURS', '"Yedekle" ev dizini arşivleri kaç saat tutulur (vars. 72)', false],
        ['Veri toplama', 'SCRAPE_INTERVAL', 'Sensör verisi okuma aralığı (Telegraf)', false],
        ['Veri toplama', 'WORKER_TICK_SECONDS', 'Arka plan görevlerinin tur aralığı, sn (vars. 60)', false],
        ['Veri toplama', 'RUNNER_JOB_THREADS', 'Aynı anda çalışabilen görev sayısı (vars. 8)', false],
        ['Yedekleme', 'BACKUP_CONFIG_EVERY_HOURS', 'Yapılandırma yedeği kaç saatte bir', false],
        ['Yedekleme', 'BACKUP_FULL_AT', 'Tam yedeğin günlük saati', false],
        ['Yedekleme', 'BACKUP_KEEP_CONFIG', 'Saklanan yapılandırma yedeği sayısı', false],
        ['Yedekleme', 'BACKUP_KEEP_FULL', 'Saklanan tam yedek sayısı', false],
        ['Ağ', 'HTTP_PORT', 'Web arayüzü HTTP portu', false],
        ['Ağ', 'HTTPS_PORT', 'Web arayüzü HTTPS portu', false],
        ['Ağ', 'SYSLOG_PORT', 'Tahtaların log gönderdiği port (tcp+udp)', false],
        ['Ağ', 'CAST_RTSP_PORT', 'Ekran yansıtma RTSP portu', false],
        ['Ağ', 'CAST_ICE_PORT', 'Ekran yansıtma ICE portu', false],
        ['Genel', 'TZ', 'Saat dilimi', false],
        ['Tahta erişimi', 'BOARD_SSH_USER', 'Tahtalara SSH kullanıcısı (ilk değer; Ayarlar\'dan değişir)', false],
        ['Tahta erişimi', 'BOARD_SSH_PASSWORD', 'Tahtalara SSH parolası (ilk değer)', true],
        ['Tahta erişimi', 'BOARD_SMB_USER', 'Samba kullanıcısı (ilk değer)', false],
        ['Tahta erişimi', 'BOARD_SMB_PASSWORD', 'Samba parolası (ilk değer)', true],
        ['Parolalar', 'POSTGRES_PASSWORD', 'Veritabanı parolası', true],
        ['Parolalar', 'GRAFANA_ADMIN_PASSWORD', 'Grafana yönetici parolası', true],
        ['Parolalar', 'ETAPADMIN_PASSWORD', 'etapadmin ilk parolası', true],
    ];

    private const BACKUP_SUMMARY = '/run/ankamon/backups.json';

    public function overview(Request $request): array
    {
        $versions = $this->packageVersions();
        $versions[] = ['name' => 'TimescaleDB', 'version' => (string) Db::value("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'")];
        try {
            $versions[] = ['name' => 'supervisord (çalışan)', 'version' => Supervisor::version()];
        } catch (ApiError) {
            // soket erişilemezse sürüm satırı atlanır; Servisler sekmesi hatayı ayrıca gösterir
        }
        usort($versions, fn($a, $b) => strcasecmp($a['name'], $b['name']));

        $mem = [];
        foreach (@file('/proc/meminfo') ?: [] as $line) {
            if (preg_match('/^(MemTotal|MemAvailable):\s+(\d+)/', $line, $m)) {
                $mem[$m[1]] = (int) $m[2] * 1024;
            }
        }
        $started = @filemtime('/proc/1');
        $built = @filemtime('/var/www/ankamon/ankamon/index.js');
        return [
            'hostname' => gethostname(),
            'container_started_at' => $started ? $started * 1000 : null,
            'build_at' => $built ? $built * 1000 : null,
            'cpus' => count(preg_grep('/^processor\s*:/', @file('/proc/cpuinfo') ?: [])) ?: null,
            'load' => sys_getloadavg() ?: null,
            'mem_total' => $mem['MemTotal'] ?? null,
            'mem_available' => $mem['MemAvailable'] ?? null,
            'disk' => Storage::diskSpace(),
            'db_size' => (int) Db::value('SELECT pg_database_size(current_database())'),
            'versions' => $versions,
        ];
    }

    public function jobs(Request $request): array
    {
        $policies = Db::all(
            "SELECT j.job_id, j.application_name, j.proc_name, COALESCE(j.hypertable_name, '') AS hypertable,
                    j.schedule_interval::text AS schedule, j.config::text AS config, j.scheduled,
                    (extract(epoch FROM s.last_run_started_at) * 1000)::bigint AS last_run,
                    (extract(epoch FROM s.last_successful_finish) * 1000)::bigint AS last_success,
                    s.last_run_status, s.job_status, (extract(epoch FROM s.next_start) * 1000)::bigint AS next_start,
                    s.total_runs, s.total_failures
             FROM timescaledb_information.jobs j
             LEFT JOIN timescaledb_information.job_stats s USING (job_id)
             ORDER BY j.job_id"
        );
        $policies = array_map(function (array $p) {
            $p['config'] = json_decode((string) $p['config'], true) ?: null;
            $p['kind'] = self::policyKind((string) $p['proc_name']);
            $p['runnable'] = (int) $p['job_id'] >= 1000; // <1000: TimescaleDB'nin iç işleri (telemetri vb.)
            return $p;
        }, $policies);

        $raw = @file_get_contents(self::BACKUP_SUMMARY);
        $backup = $raw === false ? null : json_decode($raw, true);
        $latest = [];
        foreach (($backup['files'] ?? []) as $f) {
            $kind = strtok((string) $f['name'], '-');
            if (!isset($latest[$kind]) || $f['mtime'] > $latest[$kind]['mtime']) {
                $latest[$kind] = ['name' => $f['name'], 'bytes' => (int) $f['bytes'], 'mtime' => (int) $f['mtime'] * 1000];
            }
        }

        return [
            'policies' => $policies,
            'backup' => $backup === null ? null : [
                'updated' => (int) ($backup['updated'] ?? 0) * 1000,
                'config_every_hours' => (int) ($backup['config_every_hours'] ?? 0),
                'full_at' => $backup['full_at'] ?? null,
                'keep_config' => (int) ($backup['keep_config'] ?? 0),
                'keep_full' => (int) ($backup['keep_full'] ?? 0),
                'latest' => $latest,
            ],
            'cursors' => Db::all(
                "SELECT name, (extract(epoch FROM value) * 1000)::bigint AS value,
                        (extract(epoch FROM updated_at) * 1000)::bigint AS updated_at
                 FROM task_cursors ORDER BY name"
            ),
            'last_activity' => Db::one(
                "SELECT (extract(epoch FROM time) * 1000)::bigint AS time, level, message FROM activity_log ORDER BY id DESC LIMIT 1"
            ),
        ];
    }

    /** POST /api/system/jobs/run {job_id}: bir TimescaleDB politikasını hemen çalıştırır. */
    public function runJob(Request $request, array $user): array
    {
        $id = (int) $request->input('job_id', 0);
        if ($id < 1000 || !Db::value('SELECT 1 FROM timescaledb_information.jobs WHERE job_id = ?', [$id])) {
            throw ApiError::badRequest('Bu iş elle çalıştırılamaz.');
        }
        set_time_limit(300);
        $started = microtime(true);
        Db::exec('CALL run_job(?)', [$id]);
        Audit::log($user, $request, 'system.run_job', (string) $id);
        return ['ok' => true, 'seconds' => round(microtime(true) - $started, 1)];
    }

    public function database(Request $request): array
    {
        $hyper = Db::all(
            "SELECT h.hypertable_name AS name, format('%I.%I', h.hypertable_schema, h.hypertable_name) AS qname,
                    h.num_chunks AS chunks, h.compression_enabled AS compression,
                    hypertable_size(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass) AS bytes
             FROM timescaledb_information.hypertables h ORDER BY bytes DESC"
        );
        foreach ($hyper as &$h) {
            $h['bytes'] = (int) $h['bytes'];
            $h['before'] = $h['after'] = null;
            if ($h['compression']) {
                $c = Db::one('SELECT before_compression_total_bytes AS b, after_compression_total_bytes AS a
                              FROM hypertable_compression_stats(?::regclass)', [$h['qname']]);
                $h['before'] = $c && $c['b'] !== null ? (int) $c['b'] : null;
                $h['after'] = $c && $c['a'] !== null ? (int) $c['a'] : null;
            }
        }
        unset($h);
        $caggs = array_column(Db::all('SELECT view_name, materialization_hypertable_name AS m FROM timescaledb_information.continuous_aggregates'), 'view_name', 'm');
        foreach ($hyper as &$h) {
            if (isset($caggs[$h['name']])) {
                $h['name'] = $caggs[$h['name']] . ' (özet)';
            }
        }
        unset($h);
        $hyper = array_map(fn($h) => array_diff_key($h, ['qname' => 1]), $hyper);

        return [
            'version' => (string) Db::value('SHOW server_version'),
            'size' => (int) Db::value('SELECT pg_database_size(current_database())'),
            'hypertables' => $hyper,
            'tables' => array_map(fn($t) => ['name' => $t['name'], 'rows' => (int) $t['rows'], 'bytes' => (int) $t['bytes']], Db::all(
                "SELECT relname AS name, n_live_tup AS rows, pg_total_relation_size(relid) AS bytes
                 FROM pg_stat_user_tables WHERE schemaname = 'public'
                   AND relname NOT IN (SELECT hypertable_name FROM timescaledb_information.hypertables)
                 ORDER BY bytes DESC LIMIT 20"
            )),
            'connections' => Db::all(
                "SELECT COALESCE(NULLIF(usename, ''), '—') AS user, COALESCE(NULLIF(application_name, ''), '—') AS application,
                        COALESCE(state, '—') AS state, count(*) AS n
                 FROM pg_stat_activity WHERE datname IS NOT NULL GROUP BY 1, 2, 3 ORDER BY n DESC"
            ),
            'max_connections' => (int) Db::value('SHOW max_connections'),
        ];
    }

    public function config(Request $request): array
    {
        $rows = array_map(function (array $c) {
            [$group, $key, $desc, $secret] = $c;
            $value = getenv($key);
            return [
                'group' => $group, 'key' => $key, 'description' => $desc, 'secret' => $secret,
                'value' => $secret ? ($value !== false && $value !== '' ? 'tanımlı' : 'tanımsız') : ($value === false ? null : $value),
            ];
        }, self::CONFIG);

        // Veritabanında gerçekten etkin saklama/sıkıştırma politikaları (env'den açılışta uygulanır — dbinit).
        $effective = Db::all(
            "SELECT COALESCE(hypertable_name, '') AS hypertable, proc_name, config::text AS config
             FROM timescaledb_information.jobs WHERE proc_name IN ('policy_retention', 'policy_compression')"
        );
        $caggs = array_column(Db::all('SELECT view_name, materialization_hypertable_name AS m FROM timescaledb_information.continuous_aggregates'), 'view_name', 'm');
        return [
            'env' => $rows,
            'policies' => array_map(fn($p) => [
                'table' => $caggs[$p['hypertable']] ?? $p['hypertable'],
                'kind' => self::policyKind((string) $p['proc_name']),
                'config' => json_decode((string) $p['config'], true),
            ], $effective),
        ];
    }

    private static function policyKind(string $proc): string
    {
        return match ($proc) {
            'policy_retention' => 'Saklama (eski veriyi sil)',
            'policy_compression' => 'Sıkıştırma',
            'policy_refresh_continuous_aggregate' => 'Özet yenileme',
            'policy_job_stat_history_retention' => 'İş geçmişi temizliği',
            'policy_telemetry' => 'Telemetri',
            default => $proc,
        };
    }

    /** /lib/apk/db/installed (Alpine paket veritabanı): "P:" ad, "V:" sürüm. */
    private function packageVersions(): array
    {
        $out = [];
        $name = null;
        foreach (@file('/lib/apk/db/installed', FILE_IGNORE_NEW_LINES) ?: [] as $line) {
            if (str_starts_with($line, 'P:')) {
                $name = substr($line, 2);
            } elseif (str_starts_with($line, 'V:') && $name !== null && isset(self::PACKAGES[$name])) {
                $out[] = ['name' => self::PACKAGES[$name], 'version' => substr($line, 2)];
                $name = null;
            }
        }
        return $out;
    }
}
