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

/**
 * Cihazların açık olduğu aralıklar (Oturumlar > Kullanıcılar zaman çizelgesi; aralıkların tümleyeni
 * "kapalı" gölgesi olarak çizilir). Veri worker'ın loglardan önceden hesapladığı device_uptime
 * tablosundan gelir (bkz. db/migrations/014_device_uptime.sql) — istek başına log taranmaz.
 *
 * Yanıt: {"devices":[{"device_id", "host", "since", "up":[[başlangıç, bitiş|null], …]}], "computed_until"}
 * (epoch saniye, artan sırada; bitiş null = cihaz hâlâ açık). device_id silinmiş cihazda null olabilir.
 */
final class UptimeApi
{
    /** worker/ankamon/tasks/device_uptime.py GAP ile aynı: son log bundan yeniyse aralık "sürüyor". */
    private const GAP_SECONDS = 900;

    public function index(Request $request): array
    {
        $now = time();
        $to = $request->queryInt('to', $now, 0, $now + 86400);
        $from = $request->queryInt('from', $to - 7 * 86400, 0, $to);
        $computed = Db::value("SELECT extract(epoch FROM value)::bigint FROM task_cursors WHERE name = 'device_uptime.watermark'");

        $rows = Db::all(
            "SELECT u.host, b.id AS device_id,
                    extract(epoch FROM u.started_at)::bigint AS started_at,
                    extract(epoch FROM u.last_at)::bigint AS last_at
             FROM device_uptime u
             LEFT JOIN LATERAL (SELECT id FROM devices WHERE lower(hostname) = lower(u.host) LIMIT 1) b ON true
             WHERE u.last_at >= to_timestamp(?) AND u.started_at <= to_timestamp(?)
             ORDER BY u.host, u.started_at",
            [$from - self::GAP_SECONDS, $to]
        );

        // since: o host hakkında bilginin başladığı an (tablodaki en erken aralık) — öncesi "bilinmiyor",
        // istemci onu kapalı diye taramaz. Aralıkta hiç açık olmamış ama daha önceden bilinen cihazlar da
        // (up boş = tüm aralık boyunca kapalı) listelenir.
        $devices = [];
        foreach (Db::all(
            "SELECT u.host, b.id AS device_id, extract(epoch FROM min(u.started_at))::bigint AS since
             FROM device_uptime u
             LEFT JOIN LATERAL (SELECT id FROM devices WHERE lower(hostname) = lower(u.host) LIMIT 1) b ON true
             GROUP BY u.host, b.id HAVING min(u.started_at) <= to_timestamp(?)
             ORDER BY u.host",
            [$to]
        ) as $row) {
            $devices[$row['host']] = ['device_id' => $row['device_id'], 'host' => $row['host'], 'since' => (int) $row['since'], 'up' => []];
        }
        foreach ($rows as $row) {
            $devices[$row['host']]['up'][] = [(int) $row['started_at'], (int) $row['last_at']];
        }
        // Yalnız her host'un SON aralığı "sürüyor" (bitiş null) olabilir: son logu, işlenmiş en yeni
        // log zamanından GAP'ten yakınsa ve hesap güncelse (worker geride kalmamışsa).
        $fresh = $computed !== null && $now - (int) $computed <= self::GAP_SECONDS;
        foreach ($devices as &$device) {
            $last = count($device['up']) - 1;
            if ($last >= 0 && $fresh && (int) $computed - $device['up'][$last][1] <= self::GAP_SECONDS) {
                $device['up'][$last][1] = null;
            }
        }
        unset($device);
        return ['devices' => array_values($devices), 'computed_until' => $computed === null ? null : (int) $computed];
    }
}
