<?php
/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\Db;
use Ankamon\Core\Request;

/**
 * "Ankamon logs" akışı (arayüzün alt çubuğu). `after` ile yalnız yeni kayıtlar istenir.
 * Kaynağı (source) olan kayıtlar Ankamon'un iç işleyişidir (servis hataları, traceback, SQL, darboğazlar —
 * bkz. worker/ankamon/logwatch): Sistem sayfası gibi yalnız yöneticiye. Diğer kullanıcılar yalnız kaynaksız
 * genel olayları (yeni tahta, ağ değişiklikleri …) görür.
 */
final class ActivityApi
{
    public function index(Request $request, array $user): array
    {
        $after = (int) ($request->query('after') ?? 0);
        $scope = $user['is_admin'] ? '' : " AND source = ''";
        $cols = "id, (extract(epoch FROM time) * 1000)::bigint AS ts, level, message, source, detail";
        if ($after > 0) {
            $rows = Db::all(
                "SELECT $cols FROM activity_log WHERE id > ?$scope ORDER BY id ASC LIMIT 200",
                [$after]
            );
        } else {
            // İlk yükleme: son 60 kayıt (eskiden yeniye).
            $rows = array_reverse(Db::all("SELECT $cols FROM activity_log WHERE true$scope ORDER BY id DESC LIMIT 60"));
        }
        $lastId = $rows ? (int) $rows[count($rows) - 1]['id'] : $after;
        return ['events' => $rows, 'last_id' => $lastId];
    }
}
