<?php
declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\Db;
use Ankamon\Core\Request;

final class AuditApi
{
    public function index(Request $request): array
    {
        $limit = $request->queryInt('limit', 200, 1, 1000);
        return ['entries' => Db::all(
            "SELECT extract(epoch FROM time)::bigint AS time, username, action, target, detail, ip
             FROM audit_log ORDER BY id DESC LIMIT $limit"
        )];
    }
}
