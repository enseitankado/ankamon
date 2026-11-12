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

use Ankamon\Core\DeviceSensors;
use Ankamon\Core\Db;
use Ankamon\Core\Request;

/** Cihaz listesindeki anlık göstergeler. Zaman serisi grafikleri Grafana'dadır. */
final class MetricsApi
{
    /**
     * GET /api/metrics/coverage — Bakım ▸ Sensörler bilgilendirmesi: cihaz başına son 7 günde sensör verisi
     * (metrik izleme / node_exporter) gelmiş mi, fan ya da anakart (Super I/O) sensörü var mı. Verisi hiç
     * olmayan cihazlarda sayfa "Metrik izlemeyi kur" hazır komutunu önerir. superio_done: anakart sensörü
     * (Super I/O) adımı bu cihazda başarıyla denenmiş mi — "Metrik izlemeyi kur" (actions/node-exporter)
     * çıktısında "[Super I/O]" satırı olan başarılı iş ya da eski ayrı "Fan/pil/anakart sensörlerini
     * etkinleştir" (sensors-superio, artık node-exporter'ın içinde) işi. Yonga desteklenmiyorsa sensör hiç
     * gelmez; bu cihaza aynı komut yeniden önerilmez.
     */
    public function coverage(): array
    {
        $rows = Db::all(
            "SELECT b.id, COALESCE(NULLIF(b.label, ''), NULLIF(b.hostname, ''), host(b.ip)) AS name, b.online,
                    EXISTS (SELECT 1 FROM metrics m JOIN metrics_tag t USING (tag_id)
                            WHERE t.device_id = b.id::text AND m.time > now() - interval '7 days') AS has_data,
                    EXISTS (SELECT 1 FROM metrics_tag t WHERE t.device_id = b.id::text
                            AND (t.name = 'node_hwmon_fan_rpm' OR t.chip ~ '(it87|nct6|f71)')) AS has_device_sensors,
                    EXISTS (SELECT 1 FROM job_targets jt JOIN jobs j ON j.id = jt.job_id
                            WHERE jt.device_id = b.id AND jt.status = 'ok' AND j.type = 'action'
                              AND (j.params->>'action' = 'sensors-superio'
                                   OR (j.params->>'action' = 'node-exporter'
                                       AND jt.output LIKE '%[Super I/O]%'))) AS superio_done
             FROM devices b ORDER BY name");
        return ['devices' => $rows];
    }

    public function latest(): array
    {
        $rows = Db::all(
            "SELECT device_id,
                    last(value, time) FILTER (WHERE name = 'node_load1') AS load1,
                    last(value, time) FILTER (WHERE name = 'node_memory_MemTotal_bytes') AS mem_total,
                    last(value, time) FILTER (WHERE name = 'node_memory_MemAvailable_bytes') AS mem_available,
                    last(value, time) FILTER (WHERE name = 'node_filesystem_size_bytes' AND mountpoint = '/') AS disk_size,
                    last(value, time) FILTER (WHERE name = 'node_filesystem_avail_bytes' AND mountpoint = '/') AS disk_available,
                    last(value, time) FILTER (WHERE name = 'node_boot_time_seconds') AS boot_time,
                    max(value) FILTER (WHERE name IN ('node_hwmon_temp_celsius', 'node_thermal_zone_temp')) AS temp_max,
                    extract(epoch FROM max(time))::bigint AS time
             FROM v_metrics
             WHERE time > now() - interval '5 minutes' AND device_id IS NOT NULL
             GROUP BY device_id"
        );
        // İşlemci kullanımı sayaçtan türetilir: boşta geçen sürenin pencere içindeki artış hızı.
        $cpu = Db::all(
            "SELECT device_id, 1 - avg(idle_rate) AS cpu
             FROM (SELECT device_id, cpu,
                          (max(value) - min(value)) / NULLIF(extract(epoch FROM max(time) - min(time)), 0) AS idle_rate
                   FROM v_metrics
                   WHERE time > now() - interval '5 minutes' AND name = 'node_cpu_seconds_total' AND mode = 'idle'
                   GROUP BY device_id, cpu) per_cpu
             GROUP BY device_id"
        );
        $cpuByDevice = array_column($cpu, 'cpu', 'device_id');
        // Ağ trafiği: arayüz başına SON iki örnek arasındaki bayt artışı (tarama aralığı, varsayılan 60 sn),
        // tüm fiziksel arayüzlerin (kablolu + Wi-Fi; lo/docker vb. reshape.star'da elenir) toplamı.
        // Sayaç sıfırlanmışsa (yeniden başlatma) o aralık eksi çıkar ve sayılmaz.
        $net = Db::all(
            "SELECT device_id,
                    sum(rate) FILTER (WHERE name = 'node_network_receive_bytes_total') * 8 / 1e6 AS rx_mbit,
                    sum(rate) FILTER (WHERE name = 'node_network_transmit_bytes_total') * 8 / 1e6 AS tx_mbit
             FROM (SELECT DISTINCT ON (device_id, name, device) device_id, name,
                          (value - prev_value) / NULLIF(extract(epoch FROM time - prev_time), 0) AS rate
                   FROM (SELECT device_id, name, device, time, value,
                                lag(value) OVER w AS prev_value, lag(time) OVER w AS prev_time
                         FROM v_metrics
                         WHERE time > now() - interval '5 minutes'
                           AND name IN ('node_network_receive_bytes_total', 'node_network_transmit_bytes_total')
                         WINDOW w AS (PARTITION BY device_id, name, device ORDER BY time)) samples
                   WHERE prev_value IS NOT NULL
                   ORDER BY device_id, name, device, time DESC) last_interval
             WHERE rate >= 0
             GROUP BY device_id"
        );
        $netByDevice = array_column($net, null, 'device_id');
        $sensors = DeviceSensors::latestAll();

        $latest = [];
        foreach ($rows as $row) {
            $id = (int) $row['device_id'];
            $latest[$id] = [
                'time' => $row['time'],
                'load1' => self::num($row['load1'], 2),
                'cpu_percent' => isset($cpuByDevice[$id]) ? self::num(max(0, min(1, (float) $cpuByDevice[$id])) * 100, 1) : null,
                'mem_percent' => self::usedPercent($row['mem_total'], $row['mem_available']),
                'disk_percent' => self::usedPercent($row['disk_size'], $row['disk_available']),
                'net_rx_mbit' => self::num($netByDevice[$id]['rx_mbit'] ?? null, 3),
                'net_tx_mbit' => self::num($netByDevice[$id]['tx_mbit'] ?? null, 3),
                'temp_max' => self::num($row['temp_max'], 1),
                // Ayrık göstergeler (bkz. Core\DeviceSensors). Kasa: anakart sensörü varsa o, yoksa ACPI.
                'cpu_temp' => self::num($sensors[$id]['cpu_temp'] ?? $row['temp_max'], 1),
                'case_temp' => self::num($sensors[$id]['device_temp'] ?? $sensors[$id]['acpi_temp'] ?? null, 1),
                'disk_temp' => self::num($sensors[$id]['disk_temp'] ?? null, 0),
                'fan_rpm' => self::num($sensors[$id]['fan_rpm'] ?? null, 0),
                'battery_v' => self::num($sensors[$id]['battery_v'] ?? null, 2),
                'uptime_seconds' => $row['boot_time'] ? max(0, time() - (int) $row['boot_time']) : null,
            ];
        }
        return ['latest' => $latest ?: new \stdClass()];
    }

    /** Bilgi kartı: tek cihazın sensörleri, saklanan geçmişteki en düşük/en yüksek değerleriyle. */
    public function sensors(Request $request): array
    {
        return ['sensors' => DeviceSensors::withRange((int) $request->arg('id')) ?: new \stdClass()];
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
