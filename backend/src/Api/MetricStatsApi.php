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

/**
 * Cihaz başına sensör verisi alanı (Disk kullanımı penceresinin "Sensör verileri" sekmesi) ve
 * kalıcı silme.
 *
 * Sensör verisi üç katmanda durur (bkz. 001_core.sql): ham ölçümler (metrics, ~METRICS_RAW_DAYS) ve
 * iki sürekli özet (metrics_5m, metrics_1h — ham veri silindikten sonra da kalır). Özetlerin verisi
 * TimescaleDB'nin iç "materialization" hypertable'larındadır; ham veriden silmek eski özetleri
 * SİLMEZ (yenileme politikası yalnız son birkaç saati yeniden hesaplar), bu yüzden silme üç katmanın
 * hepsine uygulanır. metrics_tag (seri tanımları) bilerek SİLİNMEZ: Telegraf tag_id'leri önbellekte
 * tutar, satır silinirse sonraki ölçümler etiketsiz (görünmez) kalır; tanımlar zaten çok küçüktür.
 * Boyutlar, katmanların gerçek boyutunun satır sayısına orantılı paylaştırılmasıyla tahmin edilir (~).
 */
final class MetricStatsApi
{
    public function stats(Request $request): array
    {
        $layers = $this->layers();
        $devices = [];
        foreach (Db::all("SELECT id::text AS id, COALESCE(NULLIF(label,''), hostname, host(ip)) AS name FROM devices") as $b) {
            $devices[$b['id']] = $b['name'];
        }

        $rows = [];
        $unmatched = self::emptyRow(null, '');
        $total = self::emptyRow(null, '');
        $add = function (?string $deviceId, string $field, array $g) use (&$rows, &$unmatched, &$total, $devices) {
            if ($deviceId !== null && $deviceId !== '' && isset($devices[$deviceId])) {
                $rows[$deviceId] ??= self::emptyRow((int) $deviceId, (string) $devices[$deviceId]);
                self::foldMetricDeviceBucket($rows[$deviceId], $field, $g);
            } else {
                self::foldMetricDeviceBucket($unmatched, $field, $g);
            }
            self::foldMetricDeviceBucket($total, $field, $g);
        };

        foreach (Db::all('SELECT device_id, count(*) AS n FROM metrics_tag GROUP BY device_id') as $g) {
            $add($g['device_id'], 'series', $g);
        }
        foreach ($layers as $field => $table) {
            $groups = Db::all(
                "SELECT t.device_id, count(*) AS n,
                        (extract(epoch FROM min(m.time)) * 1000)::bigint AS first,
                        (extract(epoch FROM max(m.time)) * 1000)::bigint AS last
                 FROM $table m JOIN metrics_tag t USING (tag_id) GROUP BY t.device_id"
            );
            foreach ($groups as $g) {
                $add($g['device_id'], $field, $g);
            }
        }

        $bytes = array_map(fn(string $table) => Storage::relationBytes($table), $layers);
        $bytes['series'] = Storage::relationBytes('metrics_tag');
        $estimate = function (array $row) use ($bytes, $total) {
            $est = 0;
            foreach ($bytes as $field => $b) {
                $est += Storage::share($b, $row[$field], $total[$field]);
            }
            return self::metricStatsRowShape($row) + ['est_bytes' => $est];
        };

        $rows = array_values($rows);
        usort($rows, fn($a, $b) => strcasecmp($a['name'], $b['name']));
        $hasUnmatched = $unmatched['series'] + $unmatched['raw'] + $unmatched['m5'] + $unmatched['h1'] > 0;
        return [
            'devices' => array_map($estimate, $rows),
            'unmatched' => $hasUnmatched ? $estimate($unmatched) : null,
            'total' => self::metricStatsRowShape($total) + ['bytes' => array_sum($bytes)],
            'disk' => Storage::diskSpace(),
        ];
    }

    /**
     * Kalıcı silme: device (cihaz id'si, "unmatched" — cihaza bağlanamayan seriler — ya da boş:
     * TÜM sensör verisi). Ham ölçümler + 5 dk/1 sa özetleri birlikte silinir. Geri alınamaz;
     * audit_log'a yazılır.
     */
    public function delete(Request $request, array $user): array
    {
        $device = $request->query('device');
        $where = '';
        $params = [];
        if ($device !== null) {
            $tagSql = $device === 'unmatched'
                ? "SELECT tag_id FROM metrics_tag t WHERE NULLIF(t.device_id, '') IS NULL
                     OR NOT EXISTS (SELECT 1 FROM devices b WHERE b.id::text = t.device_id)"
                : 'SELECT tag_id FROM metrics_tag WHERE device_id = ?';
            if ($device !== 'unmatched' && !Db::value('SELECT 1 FROM devices WHERE id = ?', [(int) $device])) {
                throw ApiError::notFound('Cihaz bulunamadı.');
            }
            $tags = array_column(Db::all($tagSql, $device === 'unmatched' ? [] : [(string) (int) $device]), 'tag_id');
            if (!$tags) {
                return ['ok' => true, 'deleted' => 0];
            }
            // Sabit dizi: tag_id sıkıştırmanın segmentby sütunu — TimescaleDB eşleşen sıkıştırılmış
            // yığınları açmadan bütün olarak silebilir (alt sorguda bu iyileştirme uygulanmaz).
            $where = ' WHERE tag_id = ANY(?::bigint[])';
            $params = ['{' . implode(',', array_map('intval', $tags)) . '}'];
        }

        $counts = Storage::delete(array_map(
            fn(string $table) => ["DELETE FROM $table$where", $params],
            array_values($this->layers())
        ));
        $deleted = array_sum($counts);
        Audit::log($user, $request, 'metrics.delete', (string) ($device ?? 'all'), [
            'raw' => $counts[0], 'aggregates' => $deleted - $counts[0],
        ]);
        return ['ok' => true, 'deleted' => $deleted];
    }

    /** @return array<string,string> alan => tablo: ham ölçümler ve iki özetin materialization tablosu. */
    private function layers(): array
    {
        $mat = [];
        foreach (Db::all(
            "SELECT view_name, format('%I.%I', materialization_hypertable_schema, materialization_hypertable_name) AS t
             FROM timescaledb_information.continuous_aggregates WHERE view_name IN ('metrics_5m', 'metrics_1h')"
        ) as $c) {
            $mat[$c['view_name']] = $c['t'];
        }
        if (count($mat) !== 2) {
            throw new \RuntimeException('metrics_5m / metrics_1h sürekli özetleri bulunamadı.');
        }
        return ['raw' => 'metrics', 'm5' => $mat['metrics_5m'], 'h1' => $mat['metrics_1h']];
    }

    private static function emptyRow(?int $id, string $name): array
    {
        return ['device_id' => $id, 'name' => $name, 'series' => 0, 'raw' => 0, 'm5' => 0, 'h1' => 0, 'first' => null, 'last' => null];
    }

    private static function foldMetricDeviceBucket(array &$acc, string $field, array $g): void
    {
        $acc[$field] += (int) $g['n'];
        if (isset($g['first']) && ($acc['first'] === null || $g['first'] < $acc['first'])) {
            $acc['first'] = $g['first'];
        }
        if (isset($g['last']) && ($acc['last'] === null || $g['last'] > $acc['last'])) {
            $acc['last'] = $g['last'];
        }
    }

    /** Arayüz biçimi: n = ham ölçüm, agg = 5 dk + 1 sa özet satırı. */
    private static function metricStatsRowShape(array $row): array
    {
        return [
            'device_id' => $row['device_id'], 'name' => $row['name'], 'series' => $row['series'],
            'n' => $row['raw'], 'agg' => $row['m5'] + $row['h1'],
            'first' => $row['first'] !== null ? (int) $row['first'] : null,
            'last' => $row['last'] !== null ? (int) $row['last'] : null,
        ];
    }
}
