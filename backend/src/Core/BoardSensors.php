<?php
declare(strict_types=1);

namespace Ankamon\Core;

/**
 * Tahta sensörlerini (node_exporter hwmon + smartmon/nvme textfile) anlamlı göstergelere indirger:
 *   cpu_temp   işlemci (coretemp/k10temp)       board_temp  anakart (Super I/O temp1)
 *   acpi_temp  kasa içi (ACPI termal bölge)     disk_temp   disk (SMART 194/190, NVMe)
 *   fan_rpm    işlemci fanı (Super I/O)         battery_v   CMOS pili (Super I/O in8 = Vbat)
 * Super I/O değerleri tahtada sürücü yüklüyse gelir (bkz. actions/sensors-superio). Bir göstergeye
 * birden çok seri düşerse (ör. çekirdek başına sıcaklık, bağlı olmayan fan3 = 0) son değeri en yüksek
 * olan seçilir; en düşük/en yüksek değerler de o serinin kendisinden verilir.
 */
final class BoardSensors
{
    public const KEYS = ['cpu_temp', 'board_temp', 'acpi_temp', 'disk_temp', 'fan_rpm', 'battery_v'];

    private const NAMES = "'node_hwmon_temp_celsius', 'node_hwmon_fan_rpm', 'node_hwmon_in_volts',
        'smartmon_temperature_celsius_raw_value', 'smartmon_airflow_temperature_cel_raw_value', 'nvme_temperature_celsius'";

    private const SUPERIO = "(chip LIKE '%it87%' OR chip LIKE '%nct67%' OR chip LIKE '%f71%')";

    private const KEY_SQL = "CASE
        WHEN name = 'node_hwmon_temp_celsius' AND (chip LIKE '%coretemp%' OR chip LIKE '%k10temp%') THEN 'cpu_temp'
        WHEN name = 'node_hwmon_temp_celsius' AND sensor = 'temp1' AND " . self::SUPERIO . " THEN 'board_temp'
        WHEN name = 'node_hwmon_temp_celsius' AND chip LIKE 'thermal_thermal_zone%' THEN 'acpi_temp'
        WHEN name = 'node_hwmon_fan_rpm' THEN 'fan_rpm'
        WHEN name = 'node_hwmon_in_volts' THEN 'battery_v'
        WHEN name LIKE 'smartmon_%' OR name LIKE 'nvme_%' THEN 'disk_temp'
    END";

    /** Tüm tahtaların son 5 dakikadaki değerleri: [board_id => [key => değer]]. */
    public static function latestAll(): array
    {
        $rows = Db::all(
            "SELECT s.board_id, s.key, last(m.value, m.time) AS last
             FROM metrics m
             JOIN (SELECT tag_id, board_id, " . self::KEY_SQL . " AS key
                   FROM metrics_tag WHERE board_id <> '' AND name IN (" . self::NAMES . ")) s USING (tag_id)
             WHERE m.time > now() - interval '5 minutes' AND s.key IS NOT NULL
             GROUP BY s.board_id, s.key, m.tag_id"
        );
        $out = [];
        foreach ($rows as $row) {
            $id = (int) $row['board_id'];
            $key = $row['key'];
            $value = (float) $row['last'];
            if (!isset($out[$id][$key]) || $value > $out[$id][$key]) {
                $out[$id][$key] = $value;
            }
        }
        return $out;
    }

    /**
     * Tek tahta: son değer + saklanan tüm geçmişteki (metrics_1h özeti — ayrıntılı veri silinse de
     * kalır) en düşük/en yüksek değer ve zamanları. [key => {value, min, max, min_at, max_at, since}]
     */
    public static function withRange(int $boardId): array
    {
        $rows = Db::all(
            "WITH s AS (
                 SELECT tag_id, " . self::KEY_SQL . " AS key FROM metrics_tag WHERE board_id = ? AND name IN (" . self::NAMES . ")
             ), h AS (
                 SELECT m.tag_id, m.time, m.min, m.max FROM metrics_1h m JOIN s USING (tag_id) WHERE s.key IS NOT NULL
             ), cur AS (
                 SELECT m.tag_id, last(m.value, m.time) AS last FROM metrics m JOIN s USING (tag_id)
                 WHERE s.key IS NOT NULL AND m.time > now() - interval '5 minutes' GROUP BY m.tag_id
             )
             SELECT s.key, s.tag_id, cur.last,
                    (SELECT min(min) FROM h WHERE h.tag_id = s.tag_id) AS min,
                    (SELECT max(max) FROM h WHERE h.tag_id = s.tag_id) AS max,
                    (SELECT extract(epoch FROM time)::bigint FROM h WHERE h.tag_id = s.tag_id ORDER BY min, time DESC LIMIT 1) AS min_at,
                    (SELECT extract(epoch FROM time)::bigint FROM h WHERE h.tag_id = s.tag_id ORDER BY max DESC, time DESC LIMIT 1) AS max_at,
                    (SELECT extract(epoch FROM min(time))::bigint FROM h WHERE h.tag_id = s.tag_id) AS since
             FROM s LEFT JOIN cur USING (tag_id)
             WHERE s.key IS NOT NULL",
            [(string) $boardId]
        );
        $out = [];
        foreach ($rows as $row) {
            if ($row['max'] === null && $row['last'] === null) {
                continue;
            }
            $key = $row['key'];
            // Seri seçimi: son değeri olan önce, sonra en yüksek son değer (yoksa en yüksek tepe).
            $rank = $row['last'] !== null ? [1, (float) $row['last']] : [0, (float) $row['max']];
            if (isset($out[$key]) && $out[$key]['rank'] >= $rank) {
                continue;
            }
            $out[$key] = [
                'rank' => $rank,
                'value' => $row['last'] === null ? null : (float) $row['last'],
                'min' => $row['min'] === null ? null : (float) $row['min'],
                'max' => $row['max'] === null ? null : (float) $row['max'],
                'min_at' => $row['min_at'] === null ? null : (int) $row['min_at'],
                'max_at' => $row['max_at'] === null ? null : (int) $row['max_at'],
                'since' => $row['since'] === null ? null : (int) $row['since'],
            ];
        }
        foreach ($out as &$item) {
            unset($item['rank']);
        }
        return $out;
    }
}
