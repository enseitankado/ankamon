<?php
declare(strict_types=1);

namespace Tihamon\Api;

use Tihamon\Core\BoardSensors;
use Tihamon\Core\Db;
use Tihamon\Core\Request;

/** Tahta listesindeki anlık göstergeler. Zaman serisi grafikleri Grafana'dadır. */
final class MetricsApi
{
    public function latest(): array
    {
        $rows = Db::all(
            "SELECT board_id,
                    last(value, time) FILTER (WHERE name = 'node_load1') AS load1,
                    last(value, time) FILTER (WHERE name = 'node_memory_MemTotal_bytes') AS mem_total,
                    last(value, time) FILTER (WHERE name = 'node_memory_MemAvailable_bytes') AS mem_available,
                    last(value, time) FILTER (WHERE name = 'node_filesystem_size_bytes' AND mountpoint = '/') AS disk_size,
                    last(value, time) FILTER (WHERE name = 'node_filesystem_avail_bytes' AND mountpoint = '/') AS disk_available,
                    last(value, time) FILTER (WHERE name = 'node_boot_time_seconds') AS boot_time,
                    max(value) FILTER (WHERE name IN ('node_hwmon_temp_celsius', 'node_thermal_zone_temp')) AS temp_max,
                    extract(epoch FROM max(time))::bigint AS time
             FROM v_metrics
             WHERE time > now() - interval '5 minutes' AND board_id IS NOT NULL
             GROUP BY board_id"
        );
        // İşlemci kullanımı sayaçtan türetilir: boşta geçen sürenin pencere içindeki artış hızı.
        $cpu = Db::all(
            "SELECT board_id, 1 - avg(idle_rate) AS cpu
             FROM (SELECT board_id, cpu,
                          (max(value) - min(value)) / NULLIF(extract(epoch FROM max(time) - min(time)), 0) AS idle_rate
                   FROM v_metrics
                   WHERE time > now() - interval '5 minutes' AND name = 'node_cpu_seconds_total' AND mode = 'idle'
                   GROUP BY board_id, cpu) per_cpu
             GROUP BY board_id"
        );
        $cpuByBoard = array_column($cpu, 'cpu', 'board_id');
        // Ağ trafiği hızı sayaçtan türetilir (CPU ile aynı yöntem): her fiziksel arabirimin pencere
        // içi bayt artış hızı, tahta başına toplanır (B/sn). lo/veth/docker reshape.star'da elenir.
        $net = Db::all(
            "SELECT board_id,
                    sum(rate) FILTER (WHERE name = 'node_network_receive_bytes_total')  AS rx,
                    sum(rate) FILTER (WHERE name = 'node_network_transmit_bytes_total') AS tx
             FROM (SELECT board_id, name, device,
                          (max(value) - min(value)) / NULLIF(extract(epoch FROM max(time) - min(time)), 0) AS rate
                   FROM v_metrics
                   WHERE time > now() - interval '5 minutes'
                     AND name IN ('node_network_receive_bytes_total', 'node_network_transmit_bytes_total')
                   GROUP BY board_id, name, device) per_dev
             GROUP BY board_id"
        );
        $netByBoard = [];
        foreach ($net as $n) {
            $netByBoard[(int) $n['board_id']] = $n;
        }
        $sensors = BoardSensors::latestAll();

        $latest = [];
        foreach ($rows as $row) {
            $id = (int) $row['board_id'];
            $latest[$id] = [
                'time' => $row['time'],
                'load1' => self::num($row['load1'], 2),
                'cpu_percent' => isset($cpuByBoard[$id]) ? self::num(max(0, min(1, (float) $cpuByBoard[$id])) * 100, 1) : null,
                'mem_percent' => self::usedPercent($row['mem_total'], $row['mem_available']),
                'disk_percent' => self::usedPercent($row['disk_size'], $row['disk_available']),
                'temp_max' => self::num($row['temp_max'], 1),
                // Ayrık göstergeler (bkz. Core\BoardSensors). Kasa: anakart sensörü varsa o, yoksa ACPI.
                'cpu_temp' => self::num($sensors[$id]['cpu_temp'] ?? $row['temp_max'], 1),
                'case_temp' => self::num($sensors[$id]['board_temp'] ?? $sensors[$id]['acpi_temp'] ?? null, 1),
                'disk_temp' => self::num($sensors[$id]['disk_temp'] ?? null, 0),
                'fan_rpm' => self::num($sensors[$id]['fan_rpm'] ?? null, 0),
                'battery_v' => self::num($sensors[$id]['battery_v'] ?? null, 2),
                // Ağ trafiği (B/sn); sayaç sıfırlanması (yeniden başlatma) negatif üretmesin diye max(0).
                'net_rx' => isset($netByBoard[$id]) ? self::num(max(0, (float) $netByBoard[$id]['rx']), 0) : null,
                'net_tx' => isset($netByBoard[$id]) ? self::num(max(0, (float) $netByBoard[$id]['tx']), 0) : null,
                'uptime_seconds' => $row['boot_time'] ? max(0, time() - (int) $row['boot_time']) : null,
            ];
        }
        return ['latest' => $latest ?: new \stdClass()];
    }

    /** Bilgi kartı: tek tahtanın sensörleri, saklanan geçmişteki en düşük/en yüksek değerleriyle. */
    public function sensors(Request $request): array
    {
        return ['sensors' => BoardSensors::withRange((int) $request->arg('id')) ?: new \stdClass()];
    }

    private static function num(mixed $value, int $digits): ?float
    {
        return $value === null ? null : round((float) $value, $digits);
    }

    private static function usedPercent(mixed $total, mixed $available): ?float
    {
        return $total > 0 && $available !== null ? round((1 - (float) $available / (float) $total) * 100, 1) : null;
    }
}
