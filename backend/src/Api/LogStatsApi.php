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
 * Cihaz/tür bazında log alanı: kayıt sayısı, tarih aralığı, diskteki yaklaşık boyut — ve kalıcı silme.
 *
 * "logs" (sistem logları) TimescaleDB hypertable'ı, sıkıştırılmış saklanır (bkz. 001_core.sql);
 * sıkıştırılmış bir yığın birden çok cihazın satırlarını birlikte tutar, bu yüzden cihaz başına
 * GERÇEK disk boyutu ayrıştırılamaz. Boyut, tablonun toplam fiziksel boyutunun (Storage::relationBytes
 * — hypertable'da hypertable_size) satır sayısına ORANTILI PAYLAŞTIRILMASIYLA tahmin edilir — arayüzde
 * "~" ile işaretlenmeli.
 * "command_log" sıkıştırılmaz ve device_id sütunu olduğundan eşleme gerekmez, ama aynı tahmin
 * yöntemi (tutarlılık için) burada da kullanılır.
 */
final class LogStatsApi
{
    public function stats(Request $request): array
    {
        return $this->type($request) === 'command' ? $this->commandStats() : $this->systemStats();
    }

    /**
     * Kalıcı silme. Kapsam: type (system|command, zorunlu) + device (cihaz id'si, "unmatched"
     * — cihazsız/eşleşmeyen kayıtlar — ya da boş bırakılırsa TÜM kayıtlar) + isteğe bağlı from/to
     * (ISO 8601; verilmezse tarih sınırı yok — o kapsamdaki HER ŞEY silinir). Geri alınamaz;
     * ne silindiği etkinlik denetim kaydına (audit_log) yazılır.
     */
    public function delete(Request $request, array $user): array
    {
        $type = $this->type($request);
        $device = $request->query('device'); // id (sayısal), "unmatched" ya da null (tüm cihazlar)
        $from = $request->query('from');
        $to = $request->query('to');

        $where = [];
        $params = [];
        if ($from !== null) {
            $where[] = ($type === 'command' ? 'time' : 'received_at') . ' >= ?::timestamptz';
            $params[] = $from;
        }
        if ($to !== null) {
            $where[] = ($type === 'command' ? 'time' : 'received_at') . ' <= ?::timestamptz';
            $params[] = $to;
        }

        if ($type === 'command') {
            if ($device === 'unmatched') {
                $where[] = 'device_id IS NULL';
            } elseif ($device !== null) {
                $where[] = 'device_id = ?';
                $params[] = (int) $device;
            }
            $sql = 'DELETE FROM command_log' . ($where ? ' WHERE ' . implode(' AND ', $where) : '');
        } else {
            if ($device === 'unmatched') {
                $where[] = 'NOT EXISTS (SELECT 1 FROM devices b WHERE lower(b.hostname) = lower(logs.host) OR host(b.ip) = logs.from_ip)';
            } elseif ($device !== null) {
                $b = Db::one('SELECT hostname, host(ip) AS ip FROM devices WHERE id = ?', [(int) $device])
                    ?? throw ApiError::notFound('Cihaz bulunamadı.');
                $where[] = '(lower(host) = lower(?) OR from_ip = ?)';
                array_push($params, (string) $b['hostname'], (string) $b['ip']);
            }
            $sql = 'DELETE FROM logs' . ($where ? ' WHERE ' . implode(' AND ', $where) : '');
        }

        [$deleted] = Storage::delete([[$sql, $params]]);
        Audit::log($user, $request, 'logs.delete', $type, [
            'device' => $device, 'from' => $from, 'to' => $to, 'deleted' => $deleted,
        ]);
        return ['ok' => true, 'deleted' => $deleted];
    }

    private function type(Request $request): string
    {
        return $request->query('type') === 'command' ? 'command' : 'system';
    }

    private function systemStats(): array
    {
        $groups = Db::all(
            "SELECT host, from_ip, count(*) AS n,
                    (extract(epoch FROM min(received_at)) * 1000)::bigint AS first,
                    (extract(epoch FROM max(received_at)) * 1000)::bigint AS last
             FROM logs GROUP BY host, from_ip"
        );
        $devices = Db::all(
            "SELECT id, hostname, host(ip) AS ip, COALESCE(NULLIF(label,''), hostname, host(ip)) AS name FROM devices"
        );
        $bytesTotal = Storage::relationBytes('logs');

        $byDevice = [];
        $unmatched = ['n' => 0, 'first' => null, 'last' => null];
        $grandN = 0;
        foreach ($groups as $g) {
            $grandN += (int) $g['n'];
            $match = null;
            foreach ($devices as $b) {
                $hostMatch = $b['hostname'] !== null && $b['hostname'] !== '' && strcasecmp((string) $g['host'], (string) $b['hostname']) === 0;
                $ipMatch = $g['from_ip'] !== null && $g['from_ip'] === $b['ip'];
                if ($hostMatch || $ipMatch) {
                    $match = $b;
                    break;
                }
            }
            if ($match === null) {
                self::foldLogDeviceBucket($unmatched, $g);
                continue;
            }
            $byDevice[$match['id']] ??= ['device_id' => $match['id'], 'name' => $match['name'], 'n' => 0, 'first' => null, 'last' => null];
            self::foldLogDeviceBucket($byDevice[$match['id']], $g);
        }

        return $this->logStatsResponseShape(array_values($byDevice), $unmatched, $grandN, $bytesTotal);
    }

    private function commandStats(): array
    {
        $groups = Db::all(
            "SELECT c.device_id, COALESCE(NULLIF(b.label,''), b.hostname, host(b.ip)) AS name, count(*) AS n,
                    (extract(epoch FROM min(c.time)) * 1000)::bigint AS first,
                    (extract(epoch FROM max(c.time)) * 1000)::bigint AS last
             FROM command_log c LEFT JOIN devices b ON b.id = c.device_id
             GROUP BY c.device_id, name"
        );
        $bytesTotal = Storage::relationBytes('command_log');

        $byDevice = [];
        $unmatched = ['n' => 0, 'first' => null, 'last' => null];
        $grandN = 0;
        foreach ($groups as $g) {
            $grandN += (int) $g['n'];
            if ($g['device_id'] === null) {
                self::foldLogDeviceBucket($unmatched, $g);
                continue;
            }
            $byDevice[] = ['device_id' => (int) $g['device_id'], 'name' => $g['name'], 'n' => (int) $g['n'], 'first' => $g['first'], 'last' => $g['last']];
        }

        return $this->logStatsResponseShape($byDevice, $unmatched, $grandN, $bytesTotal);
    }

    /** @param array<string,mixed> $acc birikimli {n, first, last}; $row aynı şekle sahip tek grup. */
    private static function foldLogDeviceBucket(array &$acc, array $row): void
    {
        $acc['n'] += (int) $row['n'];
        if ($row['first'] !== null && ($acc['first'] === null || $row['first'] < $acc['first'])) {
            $acc['first'] = $row['first'];
        }
        if ($row['last'] !== null && ($acc['last'] === null || $row['last'] > $acc['last'])) {
            $acc['last'] = $row['last'];
        }
    }

    /** Oranlı boyut tahminini ekleyip tek bir yanıt şekline sokar. */
    private function logStatsResponseShape(array $byDevice, array $unmatched, int $grandN, int $bytesTotal): array
    {
        $withBytes = fn(array $row) => $row + [
            'est_bytes' => Storage::share($bytesTotal, $row['n'], $grandN),
        ];
        usort($byDevice, fn($a, $b) => strcasecmp((string) $a['name'], (string) $b['name']));
        return [
            'devices' => array_map($withBytes, $byDevice),
            'unmatched' => $unmatched['n'] > 0 ? $withBytes($unmatched) : null,
            'total' => [
                'n' => $grandN,
                'first' => $byDevice || $unmatched['n'] > 0
                    ? min(array_filter(array_merge(array_column($byDevice, 'first'), [$unmatched['first']])))
                    : null,
                'last' => $byDevice || $unmatched['n'] > 0
                    ? max(array_filter(array_merge(array_column($byDevice, 'last'), [$unmatched['last']])))
                    : null,
                'bytes' => $bytesTotal,
            ],
            'disk' => Storage::diskSpace(),
        ];
    }
}
