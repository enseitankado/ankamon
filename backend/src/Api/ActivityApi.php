<?php
declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\Db;
use Ankamon\Core\Request;

/** Arka plan etkinlik akışı (durum çubuğu). `after` ile yalnız yeni kayıtlar istenir. */
final class ActivityApi
{
    public function index(Request $request): array
    {
        $after = (int) ($request->query('after') ?? 0);
        if ($after > 0) {
            $rows = Db::all(
                'SELECT id, (extract(epoch FROM time) * 1000)::bigint AS ts, level, message
                 FROM activity_log WHERE id > ? ORDER BY id ASC LIMIT 200',
                [$after]
            );
        } else {
            // İlk yükleme: son 30 kayıt (eskiden yeniye).
            $rows = array_reverse(Db::all(
                'SELECT id, (extract(epoch FROM time) * 1000)::bigint AS ts, level, message
                 FROM activity_log ORDER BY id DESC LIMIT 30'
            ));
        }
        $lastId = $rows ? (int) $rows[count($rows) - 1]['id'] : $after;
        return ['events' => $rows, 'last_id' => $lastId];
    }
}
